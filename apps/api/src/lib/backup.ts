import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { FastifyRequest } from 'fastify';

import { env } from '../env';
import { audit } from './audit';
import { log } from './log';
import { advisoryLock, prisma } from './prisma';
import { s3 } from './s3';
import { ZipWriter } from './zip-writer';

/** Pasta dos backups no bucket (fica fora do proprio backup). */
export const BACKUP_PREFIX = 'backups/';
/** Partes do envio ao MinIO (o S3 aceita ate 10 mil partes de ate 5 GB). */
const PART_SIZE = 64 * 1024 * 1024;

/**
 * Pasta de backup (item 6.13). Com BACKUP_DIR, o ZIP vai para uma pasta que quem configura o
 * ambiente aponta para fora do disco dos dados (disco externo, NAS); levar dali para outro lugar
 * e responsabilidade dele. A marca abaixo precisa ter sido criada por ele na pasta: com o disco
 * desmontado, o ponto de montagem vira uma pasta vazia NO DISCO DOS DADOS, e sem a marca o
 * backup seria gravado ali sem ninguem perceber.
 */
export const BACKUP_DIR_MARKER = '.deeplook-backups';

/** O ZIP esta no bucket (antes do 6.13, ou sem BACKUP_DIR) ou na pasta? */
export function inBucket(key: string): boolean {
  return key.startsWith(BACKUP_PREFIX);
}

/** Caminho de um backup na pasta (so o nome guardado na linha, sem subir de pasta). */
export function backupFilePath(key: string): string {
  return join(env.BACKUP_DIR, basename(key));
}

/** A pasta de backup esta pronta? Devolve o espaco livre ou o motivo de nao estar. */
export async function checkBackupDir(
  dir = env.BACKUP_DIR,
): Promise<{ ok: true; free: number } | { ok: false; error: string }> {
  try {
    if (!(await stat(dir)).isDirectory()) {
      return { ok: false, error: `${dir} não é uma pasta.` };
    }
  } catch {
    return { ok: false, error: `A pasta de backup ${dir} não existe.` };
  }
  try {
    await access(join(dir, BACKUP_DIR_MARKER));
  } catch {
    return {
      ok: false,
      error:
        `A pasta de backup não tem o arquivo ${BACKUP_DIR_MARKER}: o disco pode não estar ` +
        `montado. Crie o arquivo na pasta de destino (touch ${BACKUP_DIR_MARKER}).`,
    };
  }
  try {
    await access(dir, constants.W_OK);
  } catch {
    return {
      ok: false,
      error: `Sem permissão de escrita na pasta de backup para o usuário da API (uid ${process.getuid?.() ?? '?'}).`,
    };
  }
  const fs = await statfs(dir);
  return { ok: true, free: fs.bavail * fs.bsize };
}

/** SHA-256 de um arquivo inteiro (o do ZIP, para o arquivo .sha256 ao lado dele). */
async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Para os testes: outro comando/endereco do pg_dump (ex.: docker exec). */
let dumpConfig: { command: string[]; databaseUrl?: string } = { command: [env.BACKUP_PG_DUMP] };
export function configureDump(config: { command: string[]; databaseUrl?: string }): void {
  dumpConfig = config;
}

export const RESTORE_README = `DeepLook — backup
==================

Conteúdo
- manifest.json: versão, data, contagens e SHA-256 de cada arquivo deste ZIP.
- db/deeplook.dump: banco PostgreSQL (pg_dump, formato custom).
- objects/: arquivos guardados no MinIO (evidências, capturas e, se marcado, os
  arquivos das amostras), com o mesmo caminho do bucket.

Se o ZIP foi gerado com senha, ela não fica guardada: sem ela, o backup não abre.

ATENÇÃO: com os arquivos das amostras (objects/samples/), este ZIP contém MALWARE
real. Guarde-o como as amostras: fora de máquinas de uso comum e sem abrir os arquivos.

Restauração (com o DeepLook parado, na mesma versão ou mais nova)
1. Confira os SHA-256 do manifest.json (sha256sum).
2. Banco: crie um banco vazio e restaure
     createdb -U postgres deeplook
     pg_restore -U postgres -d deeplook --no-owner --clean --if-exists db/deeplook.dump
3. Arquivos: copie a pasta objects/ para o bucket (S3_BUCKET), mantendo os caminhos
     mc cp --recursive objects/ local/deeplook-samples/
4. Use a mesma chave de dados da instalação de origem: o DATA_KEY do .env ou, se ela não o
   tinha, o SESSION_SECRET. Com outra, os 2FA ativados param de funcionar (só os códigos de
   recuperação valem, até reconfigurar).
5. Suba o DeepLook: as migrações novas, se houver, rodam sozinhas.

Sem objects/samples/ (backup sem as amostras), as fichas voltam, mas os arquivos das
amostras não: baixar responde "arquivo não está no armazenamento", e a análise que já foi
feita continua na ficha.
`;

/** Remove `?schema=` e outros parametros que o pg_dump nao entende. */
function pgUrl(url: string): string {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}

/** O ZIP e montado em disco antes de ir ao bucket: falha logo se nao couber (item 116). */
export async function ensureFreeSpace(dir: string, needed: number): Promise<void> {
  const fs = await statfs(dir);
  const free = fs.bavail * fs.bsize;
  // Folga para cabecalhos, LEIA-ME e manifesto.
  if (free < needed * 1.05 + 10 * 1024 * 1024) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    throw new Error(
      `Espaço insuficiente: o backup precisa de ${gb(needed)} GB e há ${gb(free)} GB livres.`,
    );
  }
}

/** Roda o pg_dump para um arquivo; rejeita com a saida de erro se falhar. */
function dumpDatabase(file: string): Promise<void> {
  const [bin, ...prefix] = dumpConfig.command;
  const url = pgUrl(dumpConfig.databaseUrl ?? env.DATABASE_URL);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...prefix, '--format=custom', '--no-owner', `--dbname=${url}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const errors: Buffer[] = [];
    child.stderr.on('data', (d: Buffer) => errors.push(d));
    const out = createWriteStream(file);
    child.stdout.pipe(out);
    child.on('error', (err) => reject(new Error(`pg_dump não executou: ${err.message}`)));
    child.on('close', (code) => {
      out.close(() => {
        if (code === 0) return resolve();
        const msg = Buffer.concat(errors).toString('utf8').trim().slice(0, 300);
        reject(new Error(`pg_dump falhou (${code}): ${msg || 'sem detalhes'}`));
      });
    });
  });
}

/** Objetos do bucket (paginado), sem os backups e, se pedido, sem as amostras. */
async function listObjects(includeSamples: boolean) {
  const items: { key: string; size: number; modified: Date }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.S3_BUCKET, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) {
      if (!o.Key || o.Key.startsWith(BACKUP_PREFIX)) continue;
      if (!includeSamples && o.Key.startsWith('samples/')) continue;
      items.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified ?? new Date() });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return items;
}

/** SHA-256 calculado enquanto os bytes passam para o ZIP. */
async function* hashing(source: AsyncIterable<Buffer>, hash: ReturnType<typeof createHash>) {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

/** Envia o ZIP ao bucket em partes (sem limite de 5 GB do envio unico). */
async function upload(
  file: string,
  key: string,
  size: number,
  onPart: (sent: number) => Promise<unknown>,
) {
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: 'application/zip',
    }),
  );
  try {
    const parts: { ETag: string; PartNumber: number }[] = [];
    for (let start = 0, n = 1; start < size; start += PART_SIZE, n++) {
      const end = Math.min(size, start + PART_SIZE);
      const { ETag } = await s3.send(
        new UploadPartCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          UploadId,
          PartNumber: n,
          ContentLength: end - start,
          Body: createReadStream(file, { start, end: end - 1 }),
        }),
      );
      parts.push({ ETag: ETag!, PartNumber: n });
      await onPart(end);
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        UploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (err) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: key, UploadId }))
      .catch(() => undefined);
    throw err;
  }
}

async function appVersion(): Promise<string> {
  try {
    return (
      JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    ).version;
  } catch {
    return 'desconhecida';
  }
}

/**
 * Monta o backup (em segundo plano): dump do banco, objetos do MinIO, manifesto
 * e LEIA-ME num ZIP temporario, que vai para backups/<id>.zip. A etapa e o
 * progresso ficam na linha do backup para a tela acompanhar.
 */
export async function runBackup(id: string, password: string | null = null): Promise<void> {
  const backup = await prisma.backup.findUniqueOrThrow({
    where: { id },
    include: { createdBy: { select: { displayName: true, email: true } } },
  });
  const dir = await mkdtemp(join(tmpdir(), 'deeplook-backup-'));
  // Progresso e so informativo: falha ao grava-lo nao derruba o backup nem a API.
  const setStep = (step: string, progress: number) =>
    prisma.backup
      .update({ where: { id }, data: { step, progress: Math.round(progress) } })
      .catch((err: unknown) => log.error({ err }, '[backup] falha ao gravar o progresso'));
  let zip: ZipWriter | null = null;
  // Com BACKUP_DIR, o ZIP e montado direto na pasta, com nome provisorio: quem sincroniza a
  // pasta nunca ve um ZIP pela metade, e nao e preciso espaco para duas copias.
  const toDir = Boolean(env.BACKUP_DIR);
  const name = `deeplook-backup-${backup.createdAt.toISOString().slice(0, 10)}-${id}.zip`;
  const partial = toDir ? join(env.BACKUP_DIR, `.${name}.partial`) : null;
  try {
    if (toDir) {
      // Antes do pg_dump: pasta errada falha logo, com o motivo.
      const ready = await checkBackupDir();
      if (!ready.ok) throw new Error(ready.error);
    }
    await setStep('Exportando o banco...', 2);
    const dumpFile = join(dir, 'deeplook.dump');
    await dumpDatabase(dumpFile);
    const dumpSize = (await stat(dumpFile)).size;

    await setStep('Listando os arquivos...', 10);
    const objects = await listObjects(backup.includeSamples);
    const objectBytes = objects.reduce((sum, o) => sum + o.size, 0);
    const totalBytes = dumpSize + objectBytes || 1;
    let doneBytes = 0;
    const files: { path: string; size: number; sha256: string }[] = [];

    const zipFile = partial ?? join(dir, 'backup.zip');
    await ensureFreeSpace(toDir ? env.BACKUP_DIR : dir, dumpSize + objectBytes);
    zip = await ZipWriter.create(zipFile, { password });
    if (partial) await chmod(partial, 0o600);
    const add = async (path: string, size: number, source: AsyncIterable<Buffer>, mtime?: Date) => {
      const hash = createHash('sha256');
      await zip!.add(path, size, hashing(source, hash) as unknown as Readable, mtime);
      files.push({ path, size, sha256: hash.digest('hex') });
      doneBytes += size;
    };

    await setStep('Copiando o banco...', 12);
    await add('db/deeplook.dump', dumpSize, createReadStream(dumpFile));
    let lastUpdate = Date.now();
    for (const [i, o] of objects.entries()) {
      const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: o.key }));
      await add(`objects/${o.key}`, o.size, res.Body as AsyncIterable<Buffer>, o.modified);
      if (Date.now() - lastUpdate > 1500) {
        lastUpdate = Date.now();
        await setStep(
          `Copiando os arquivos (${i + 1} de ${objects.length})...`,
          12 + (doneBytes / totalBytes) * 76,
        );
      }
    }

    const byPrefix: Record<string, number> = {};
    for (const o of objects) {
      const prefix = o.key.split('/')[0];
      byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
    }
    const [entries, reports, users, cases] = await Promise.all([
      prisma.entry.count(),
      prisma.report.count(),
      prisma.user.count(),
      prisma.case.count(),
    ]);
    const manifest = {
      app: 'DeepLook',
      version: await appVersion(),
      createdAt: new Date().toISOString(),
      createdBy: backup.createdBy?.email ?? null,
      includeSamples: backup.includeSamples,
      encrypted: Boolean(password),
      containsMalware: backup.includeSamples && (byPrefix.samples ?? 0) > 0,
      database: { file: 'db/deeplook.dump', format: 'pg_dump custom', size: dumpSize },
      counts: {
        entries,
        reports,
        users,
        cases,
        objects: objects.length,
        objectsByFolder: byPrefix,
      },
      files,
    };
    const readme = Buffer.from(RESTORE_README, 'utf8');
    await zip.add('LEIA-ME-RESTAURACAO.txt', readme.length, readme);
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    await zip.add('manifest.json', manifestBuf.length, manifestBuf);
    const size = await zip.finish();
    zip = null;

    let key: string;
    if (partial) {
      // O .sha256 ao lado deixa conferir a copia levada para fora (sha256sum -c) sem abrir o
      // ZIP. So o dono le: o ZIP tem o banco e, se marcado, malware.
      await setStep('Conferindo o ZIP na pasta de backup...', 92);
      const sha256 = await fileSha256(partial);
      const sidecar = join(env.BACKUP_DIR, `${name}.sha256`);
      await writeFile(sidecar, `${sha256}  ${name}\n`, { mode: 0o600 });
      await rename(partial, join(env.BACKUP_DIR, name));
      key = name;
    } else {
      await setStep('Guardando o ZIP...', 90);
      key = `${BACKUP_PREFIX}${id}.zip`;
      await upload(zipFile, key, size, (sent) =>
        setStep('Guardando o ZIP...', 90 + (sent / size) * 9),
      );
    }
    await prisma.backup.update({
      where: { id },
      data: {
        status: 'READY',
        step: null,
        progress: 100,
        key,
        size: BigInt(size),
        manifest: { ...manifest, files: undefined, fileCount: files.length },
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 86400000),
      },
    });
  } catch (err) {
    await zip?.abort();
    // ZIP pela metade nao fica na pasta (nem o .sha256, se a falha veio depois dele).
    if (partial) {
      await rm(partial, { force: true });
      await rm(join(env.BACKUP_DIR, `${name}.sha256`), { force: true });
    }
    await prisma.backup.update({
      where: { id },
      data: {
        status: 'FAILED',
        step: null,
        error: (err as Error).message.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BACKUP_LOCK = 880_002;
let inFlight: Promise<void> = Promise.resolve();

/** O backup que esta sendo montado agora (para os testes esperarem). */
export function backupInFlight(): Promise<void> {
  return inFlight;
}

/**
 * Cria a linha do backup e comeca a monta-lo em segundo plano: um por vez, com a trava no banco
 * (item 111), pela tela ou pelo agendamento (item 6.13). Devolve o id, ou null se ja ha um em
 * andamento. Auditado aqui; a senha nunca vai para a auditoria nem para a linha.
 */
export async function createBackup(input: {
  includeSamples: boolean;
  password: string | null;
  createdById: string | null;
  scheduled: boolean;
  req: FastifyRequest | null;
}): Promise<string | null> {
  const id = await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, BACKUP_LOCK);
    if (await tx.backup.count({ where: { status: 'RUNNING' } })) return null;
    const created = await tx.backup.create({
      data: {
        includeSamples: input.includeSamples,
        encrypted: Boolean(input.password),
        scheduled: input.scheduled,
        step: 'Na fila...',
        createdById: input.createdById,
      },
      select: { id: true },
    });
    await audit(tx, input.req, {
      action: 'BACKUP_CREATED',
      actorId: input.createdById,
      targetLabel: created.id,
      detail: [
        ...(input.scheduled ? ['agendado'] : []),
        input.includeSamples ? 'com os arquivos das amostras' : 'sem as amostras',
        input.password ? 'com senha' : 'sem senha',
      ].join(' · '),
    });
    return created.id;
  });
  if (!id) return null;
  inFlight = runBackup(id, input.password).catch((err: unknown) =>
    log.error({ err }, '[backup] falha inesperada'),
  );
  return id;
}

/**
 * Apaga o ZIP (vencido ou excluido): do bucket, ou da pasta junto com o .sha256. So o que a
 * propria API gravou, pelo nome guardado; copias levadas para outro lugar nao sao tocadas.
 */
export async function deleteBackupObject(key: string | null): Promise<void> {
  if (!key) return;
  if (inBucket(key)) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
      .catch(() => undefined);
    return;
  }
  if (!env.BACKUP_DIR) return;
  const file = backupFilePath(key);
  await rm(file, { force: true }).catch(() => undefined);
  await rm(`${file}.sha256`, { force: true }).catch(() => undefined);
}

/** Vencidos: o ZIP sai do bucket e a linha fica como EXPIRED (historico). */
export async function expireBackups(): Promise<number> {
  const due = await prisma.backup.findMany({
    where: { status: 'READY', expiresAt: { lte: new Date() } },
    select: { id: true, key: true },
  });
  for (const b of due) {
    await deleteBackupObject(b.key);
    await prisma.backup.update({ where: { id: b.id }, data: { status: 'EXPIRED' } });
  }
  return due.length;
}

/** Na subida: o que estava em andamento morreu com a API; e de hora em hora, os vencidos. */
/**
 * Pastas temporarias que um backup ou um ISO do sandbox deixam quando a API cai no meio. Na
 * subida nada esta em andamento, entao todas sobram: sem isto elas se acumulam no /tmp, que e um
 * volume em disco desde a revisao (item 4) e sobrevive a recriacao do container.
 */
export async function cleanStaleWorkDirs(dir = tmpdir()): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const stale = names.filter((n) => /^deeplook-(backup|iso)-/.test(n));
  await Promise.all(stale.map((n) => rm(join(dir, n), { recursive: true, force: true })));
  return stale.length;
}

export function startBackups(log: { error: (obj: object, msg: string) => void }) {
  void cleanStaleWorkDirs().catch((err: unknown) =>
    log.error({ err }, '[backup] falha ao limpar temporarios'),
  );
  void prisma.backup
    .updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        step: null,
        error: 'Interrompido: a API reiniciou.',
        finishedAt: new Date(),
      },
    })
    .catch((err: unknown) => log.error({ err }, '[backup] falha ao marcar interrompidos'));
  const run = () =>
    void expireBackups().catch((err: unknown) => log.error({ err }, '[backup] falha ao expirar'));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
