import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { env } from '../env';
import { verifyAuditChain } from './audit';
import { createPrismaClient, type Db } from './prisma';
import { s3 } from './s3';
import { ZipFileReader, ZipReadError } from './zip-file-reader';

/**
 * Restauracao de um backup em ZIP (revisao de novembro, item 1.2). Tres modos:
 *
 *   check      abre o ZIP (com a senha), confere cada arquivo com o SHA-256 do manifesto e
 *              nao muda nada;
 *   rehearsal  o ensaio: restaura num banco e num bucket temporarios, compara as contagens
 *              com as do manifesto e apaga os dois. Prova que o backup volta, sem tocar na
 *              instalacao;
 *   restore    restaura no banco e no bucket da instalacao (com o DeepLook parado).
 *
 * Nos dois ultimos, a conferencia inteira roda ANTES de qualquer escrita: ZIP adulterado,
 * truncado ou com a senha errada falha sem tocar em nada. O banco e restaurado numa transacao
 * unica (pg_restore --single-transaction): se falhar no meio, fica como estava.
 */

export type RestoreMode = 'check' | 'rehearsal' | 'restore';

export type RestoreOptions = {
  file: string;
  password: string | null;
  mode: RestoreMode;
  /** restore: aceita sobrescrever uma instalacao que ja tem amostras. */
  force?: boolean;
  log?: (message: string) => void;
};

type Manifest = {
  app: string;
  version: string;
  createdAt: string;
  includeSamples: boolean;
  database: { file: string; size: number };
  /** A ponta da cadeia da auditoria no momento do backup (ausente nos backups antigos). */
  audit?: { seq: number; hash: string } | null;
  counts: { entries: number; reports: number; users: number; cases: number; objects: number };
  files: { path: string; size: number; sha256: string }[];
};

export type RestoreResult = {
  mode: RestoreMode;
  manifest: { version: string; createdAt: string; includeSamples: boolean };
  /** Arquivos conferidos com o manifesto. */
  verified: number;
  /** Objetos devolvidos ao bucket (0 no modo check). */
  objects: number;
  /** Contagens do banco restaurado ao lado das do manifesto (null no modo check). */
  counts: Record<
    'entries' | 'reports' | 'users' | 'cases',
    { backup: number; restored: number }
  > | null;
  database: string | null;
  bucket: string | null;
};

export class RestoreError extends Error {}

/** Para os testes: outro comando do pg_restore (ex.: docker exec) e outra conexao. */
type PgConnection = { host?: string; port?: string; user: string; password?: string };
let restoreConfig: { command: string[]; connection?: PgConnection } = {
  command: [process.env.RESTORE_PG_RESTORE || 'pg_restore'],
};
export function configureRestore(config: { command: string[]; connection?: PgConnection }): void {
  restoreConfig = config;
}

const OBJECTS = 'objects/';
const MANIFEST = 'manifest.json';
const README = 'LEIA-ME-RESTAURACAO.txt';

function connectionOf(url: string): PgConnection & { database: string } {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

function databaseUrl(database: string): string {
  const u = new URL(env.DATABASE_URL);
  u.pathname = `/${database}`;
  return u.toString();
}

/** pg_restore lendo o dump pela entrada padrao; rejeita com a saida de erro se falhar. */
function pgRestore(database: string, clean: boolean, source: AsyncIterable<Buffer>): Promise<void> {
  const [bin, ...prefix] = restoreConfig.command;
  const conn = restoreConfig.connection ?? connectionOf(env.DATABASE_URL);
  const args = [
    ...prefix,
    ...(conn.host ? ['-h', conn.host, '-p', conn.port ?? '5432'] : []),
    '-U',
    conn.user,
    '-d',
    database,
    '--no-owner',
    '--single-transaction',
    '--exit-on-error',
    ...(clean ? ['--clean', '--if-exists'] : []),
  ];
  return new Promise((resolve, reject) => {
    // A senha vai pelo ambiente, nao pela linha de comando (que qualquer processo do
    // container le em /proc).
    const child = spawn(bin, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, ...(conn.password ? { PGPASSWORD: conn.password } : {}) },
    });
    const errors: Buffer[] = [];
    let failed: Error | null = null;
    child.stderr.on('data', (d: Buffer) => errors.push(d));
    child.on('error', (err) => reject(new RestoreError(`pg_restore não executou: ${err.message}`)));
    child.on('close', (code) => {
      if (failed) return reject(failed);
      if (code === 0) return resolve();
      const msg = Buffer.concat(errors).toString('utf8').trim().slice(-600);
      reject(new RestoreError(`pg_restore falhou (${code}): ${msg || 'sem detalhes'}`));
    });
    // Se o pg_restore sair antes de ler tudo, a escrita falha com EPIPE: quem explica e o `close`.
    child.stdin.on('error', () => undefined);
    const input = Readable.from(source);
    input.on('error', (err) => {
      // ZIP que falha na leitura (integridade): o pg_restore morre e a transacao nao fecha.
      failed = err;
      child.kill('SIGKILL');
    });
    input.pipe(child.stdin);
  });
}

async function readManifest(zip: ZipFileReader, password: string | null): Promise<Manifest> {
  const entry = zip.find(MANIFEST);
  if (!entry) throw new RestoreError('O ZIP não tem manifest.json: não é um backup do DeepLook.');
  if (entry.encrypted && !password) {
    throw new RestoreError('Este backup tem senha: informe-a (RESTORE_PASSWORD).');
  }
  const manifest = JSON.parse((await zip.readAll(entry, password)).toString('utf8')) as Manifest;
  if (manifest.app !== 'DeepLook' || !Array.isArray(manifest.files) || !manifest.database?.file) {
    throw new RestoreError('manifest.json inesperado: não é um backup do DeepLook.');
  }
  return manifest;
}

/** Confere cada arquivo do manifesto (tamanho e SHA-256) e que o ZIP nao traz nada a mais. */
async function verify(
  zip: ZipFileReader,
  manifest: Manifest,
  password: string | null,
  log: (message: string) => void,
): Promise<number> {
  const listed = new Set(manifest.files.map((f) => f.path));
  const extra = zip.entries
    .map((e) => e.name)
    .filter((name) => name !== MANIFEST && name !== README && !listed.has(name));
  if (extra.length) {
    throw new RestoreError(
      `O ZIP tem ${extra.length} arquivo(s) fora do manifesto (ex.: ${extra[0]}).`,
    );
  }
  if (!listed.has(manifest.database.file)) {
    throw new RestoreError('O manifesto não lista o dump do banco.');
  }
  let done = 0;
  let last = Date.now();
  for (const item of manifest.files) {
    const entry = zip.find(item.path);
    if (!entry) throw new RestoreError(`Falta no ZIP: ${item.path}`);
    if (entry.size !== item.size) {
      throw new RestoreError(`${item.path}: ${entry.size} bytes, o manifesto diz ${item.size}.`);
    }
    const hash = createHash('sha256');
    for await (const chunk of zip.read(entry, password)) hash.update(chunk);
    if (hash.digest('hex') !== item.sha256) {
      throw new RestoreError(`${item.path}: o SHA-256 não confere com o manifesto.`);
    }
    done += 1;
    if (Date.now() - last > 5000) {
      last = Date.now();
      log(`conferindo: ${done} de ${manifest.files.length} arquivo(s)`);
    }
  }
  return done;
}

async function ensureEmptyBucket(bucket: string): Promise<void> {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}

async function bucketExists(bucket: string): Promise<boolean> {
  return s3.send(new HeadBucketCommand({ Bucket: bucket })).then(
    () => true,
    () => false,
  );
}

async function listBucket(bucket: string): Promise<{ key: string; size: number }[]> {
  const items: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) if (o.Key) items.push({ key: o.Key, size: o.Size ?? 0 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return items;
}

async function dropBucket(bucket: string): Promise<void> {
  for (const { key } of await listBucket(bucket)) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}

/** Contagens do banco restaurado, como o backup as contou (amostras fora da lixeira). */
async function countsOf(database: string) {
  const client = createPrismaClient(databaseUrl(database));
  try {
    const [entries, reports, users, cases] = await Promise.all([
      client.entry.count({ where: { deletedAt: null } }),
      client.report.count(),
      client.user.count(),
      client.case.count(),
    ]);
    return { entries, reports, users, cases };
  } finally {
    await client.$disconnect();
  }
}

/** A cadeia da auditoria do banco restaurado, conferida contra a ponta anotada no manifesto. */
async function auditOf(database: string, expect: { seq: number; hash: string }) {
  const client = createPrismaClient(databaseUrl(database));
  try {
    return await verifyAuditChain({ db: client as unknown as Db, expect });
  } finally {
    await client.$disconnect();
  }
}

/** Amostras na instalacao de destino (0 se o banco ainda nao tem as tabelas). */
async function liveEntries(database: string): Promise<number> {
  const client = createPrismaClient(databaseUrl(database));
  try {
    return await client.entry.count();
  } catch {
    return 0;
  } finally {
    await client.$disconnect();
  }
}

async function adminSql(sql: string): Promise<void> {
  const client = createPrismaClient(databaseUrl(connectionOf(env.DATABASE_URL).database));
  try {
    await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

export async function runRestore(options: RestoreOptions): Promise<RestoreResult> {
  const log = options.log ?? (() => undefined);
  const { password, mode } = options;
  let zip: ZipFileReader;
  try {
    zip = await ZipFileReader.open(options.file);
  } catch (err) {
    throw new RestoreError(`Não foi possível abrir o ZIP: ${(err as Error).message}`);
  }
  try {
    const manifest = await readManifest(zip, password);
    log(
      `backup de ${manifest.createdAt} (versão ${manifest.version}, ` +
        `${manifest.includeSamples ? 'com' : 'sem'} as amostras): ${manifest.files.length} arquivo(s)`,
    );
    const verified = await verify(zip, manifest, password, log);
    log(`conferência: ${verified} arquivo(s) batem com o manifesto`);
    const base = {
      mode,
      manifest: {
        version: manifest.version,
        createdAt: manifest.createdAt,
        includeSamples: manifest.includeSamples,
      },
      verified,
    };
    if (mode === 'check')
      return { ...base, objects: 0, counts: null, database: null, bucket: null };

    const main = connectionOf(env.DATABASE_URL).database;
    const stamp = Date.now().toString(36);
    const rehearsal = mode === 'rehearsal';
    // Nomes fixos pelo proprio codigo (letras, digitos e sublinhado): nada de fora entra no SQL.
    const database = rehearsal ? `deeplook_ensaio_${stamp}` : main;
    const bucket = rehearsal ? `deeplook-ensaio-${stamp}` : env.S3_BUCKET;

    if (!rehearsal && !options.force) {
      const existing = await liveEntries(main);
      if (existing > 0) {
        throw new RestoreError(
          `O banco ${main} já tem ${existing} amostra(s): restaurar apaga tudo o que está nele. ` +
            'Para ensaiar sem tocar na instalação, use --rehearsal; para sobrescrever, --force.',
        );
      }
    }

    if (rehearsal) {
      await adminSql(`CREATE DATABASE "${database}"`);
      await ensureEmptyBucket(bucket);
    } else if (!(await bucketExists(bucket))) {
      await ensureEmptyBucket(bucket);
    }
    try {
      log(`banco: restaurando em ${database}`);
      await pgRestore(database, !rehearsal, zip.read(zip.find(manifest.database.file)!, password));

      const objects = manifest.files.filter((f) => f.path.startsWith(OBJECTS));
      log(`arquivos: devolvendo ${objects.length} objeto(s) ao bucket ${bucket}`);
      let last = Date.now();
      for (const [i, item] of objects.entries()) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: item.path.slice(OBJECTS.length),
            Body: Readable.from(zip.read(zip.find(item.path)!, password)),
            ContentLength: item.size,
          }),
        );
        if (Date.now() - last > 5000) {
          last = Date.now();
          log(`arquivos: ${i + 1} de ${objects.length}`);
        }
      }

      const restored = await countsOf(database);
      const counts = Object.fromEntries(
        (['entries', 'reports', 'users', 'cases'] as const).map((key) => [
          key,
          { backup: manifest.counts[key], restored: restored[key] },
        ]),
      ) as NonNullable<RestoreResult['counts']>;
      const wrong = Object.entries(counts).filter(([, c]) => c.backup !== c.restored);
      if (wrong.length) {
        throw new RestoreError(
          'As contagens do banco restaurado divergem do manifesto: ' +
            wrong.map(([k, c]) => `${k} ${c.restored} (backup: ${c.backup})`).join(', '),
        );
      }
      if (manifest.audit) {
        const chain = await auditOf(database, manifest.audit);
        if (!chain.ok) {
          throw new RestoreError(
            `A auditoria do banco restaurado não confere com a ponta do manifesto: ${chain.problem?.reason}.`,
          );
        }
        log(`auditoria: cadeia íntegra até o evento ${manifest.audit.seq} do manifesto`);
      }
      if (rehearsal) {
        // No bucket do ensaio so ha o que veio do ZIP: quantidade e bytes tem de bater.
        const stored = await listBucket(bucket);
        const bytes = (list: { size: number }[]) => list.reduce((sum, o) => sum + o.size, 0);
        if (stored.length !== objects.length || bytes(stored) !== bytes(objects)) {
          throw new RestoreError(
            `O bucket do ensaio ficou com ${stored.length} objeto(s); o backup tem ${objects.length}.`,
          );
        }
      }
      return { ...base, objects: objects.length, counts, database, bucket };
    } finally {
      if (rehearsal) {
        await dropBucket(bucket).catch((err: unknown) =>
          log(`não foi possível apagar o bucket do ensaio ${bucket}: ${(err as Error).message}`),
        );
        await adminSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch((err: unknown) =>
          log(`não foi possível apagar o banco do ensaio ${database}: ${(err as Error).message}`),
        );
      }
    }
  } catch (err) {
    if (err instanceof ZipReadError) {
      throw new RestoreError(
        err.code === 'BAD_PASSWORD' || err.code === 'NEEDS_PASSWORD'
          ? `Senha do backup: ${err.message}.`
          : `ZIP danificado ou adulterado: ${err.message}.`,
      );
    }
    throw err;
  } finally {
    await zip.close().catch(() => undefined);
  }
}
