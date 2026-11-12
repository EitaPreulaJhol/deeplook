import { execFileSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { env } from '../../src/env';
import { backupInFlight, configureDump, createBackup } from '../../src/lib/backup';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { configureRestore, RestoreError, runRestore } from '../../src/lib/restore';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { ZipFileReader } from '../../src/lib/zip-file-reader';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const OUT = process.env.TEST_TMP!;
const DB = new URL(env.DATABASE_URL).pathname.slice(1);
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' });
const PASSWORD = 'senha-do-zip-de-teste';

/** A mensagem do RestoreError, ou '' se nao falhou (ou falhou de outro jeito). */
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (err: unknown) => (err instanceof RestoreError ? err.message : `outro erro: ${String(err)}`),
  );

// Restauracao (revisao de novembro, item 1.2): o ZIP que a API gera volta, e o que nao esta
// integro e recusado antes de qualquer escrita.
async function main() {
  await ensureBucket(3, 500);
  configureDump({
    command: ['docker', 'exec', '-i', 'dl-shadow-pg', 'pg_dump'],
    databaseUrl: `postgresql://postgres:pg@localhost:5432/${DB}`,
  });
  configureRestore({
    command: ['docker', 'exec', '-i', 'dl-shadow-pg', 'pg_restore'],
    connection: { user: 'postgres' },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'adm@x.io',
      displayName: 'adm',
      role: 'ADMIN',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const put = (Key: string, body: string) =>
    s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body: body }));
  const text = async (Key: string) =>
    s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key })).then(
      (res) => res.Body!.transformToString(),
      () => null,
    );
  const sample = `samples/${DB}/malware.exe`;
  await put(sample, 'MZ-conteudo-original');
  await put(`evidence/${DB}/print.png`, 'png-de-mentira');
  for (const title of ['primeira', 'segunda', 'na lixeira']) {
    await prisma.entry.create({
      data: {
        type: 'URL',
        title,
        url: `http://${title.replace(/\s/g, '-')}.top`,
        ownerId: admin.id,
        deletedAt: title === 'na lixeira' ? new Date() : null,
      },
    });
  }

  const makeZip = async (password: string | null, name: string) => {
    const id = await createBackup({
      includeSamples: true,
      password,
      createdById: admin.id,
      scheduled: false,
      req: null,
    });
    await backupInFlight();
    const row = await prisma.backup.findUniqueOrThrow({ where: { id: id! } });
    if (row.status !== 'READY') throw new Error(`backup falhou: ${row.error}`);
    const file = join(OUT, name);
    const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row.key! }));
    await pipeline(res.Body as Readable, createWriteStream(file));
    return file;
  };
  const sealed = await makeZip(PASSWORD, `restore-${DB}-senha.zip`);
  const plain = await makeZip(null, `restore-${DB}-aberto.zip`);

  // ------------------------------------------------------------ 1. leitor do ZIP
  const zip = await ZipFileReader.open(sealed);
  const names = zip.entries.map((e) => e.name);
  ok(
    'o leitor lista o que o gravador pôs',
    names.includes('manifest.json') &&
      names.includes('db/deeplook.dump') &&
      names.includes(`objects/${sample}`),
    names,
  );
  const body = (await zip.readAll(zip.find(`objects/${sample}`)!, PASSWORD)).toString();
  ok('conteúdo cifrado volta igual', body === 'MZ-conteudo-original', body);
  await zip.close();

  // ------------------------------------------------------------ 2. conferencia (--check)
  const checked = await runRestore({ file: sealed, password: PASSWORD, mode: 'check' });
  ok(
    'check: confere tudo e não restaura nada',
    checked.verified >= 3 && checked.objects === 0 && checked.counts === null,
    checked,
  );
  const open = await runRestore({ file: plain, password: null, mode: 'check' });
  ok('check: ZIP sem senha (CRC) também confere', open.verified === checked.verified, open);
  const wrong = await refusal(runRestore({ file: sealed, password: 'outra-senha', mode: 'check' }));
  ok('senha errada: recusado com o motivo', wrong.includes('Senha do backup'), wrong);
  const none = await refusal(runRestore({ file: sealed, password: null, mode: 'check' }));
  ok('ZIP com senha sem informá-la: recusado', none.includes('senha'), none);
  const notZip = join(OUT, `restore-${DB}-lixo.zip`);
  writeFileSync(notZip, 'isto não é um zip, mas tem mais de vinte e dois bytes');
  ok(
    'arquivo que não é ZIP: recusado',
    (await refusal(runRestore({ file: notZip, password: null, mode: 'check' }))).includes('ZIP'),
  );

  // Um byte trocado no meio do conteudo: com senha o HMAC pega, sem senha o CRC e o SHA-256.
  const tamper = (source: string, name: string) => {
    const bytes = readFileSync(source);
    const at =
      bytes.indexOf(Buffer.from('PGDMP')) >= 0 ? bytes.indexOf(Buffer.from('PGDMP')) + 40 : 200;
    bytes[at] ^= 0xff;
    const file = join(OUT, name);
    writeFileSync(file, bytes);
    return file;
  };
  const brokenPlain = tamper(plain, `restore-${DB}-aberto-adulterado.zip`);
  const brokenSealed = tamper(sealed, `restore-${DB}-senha-adulterado.zip`);
  const before = await prisma.entry.count();
  const tamperedPlain = await refusal(
    runRestore({ file: brokenPlain, password: null, mode: 'restore', force: true }),
  );
  ok('ZIP adulterado (sem senha): recusado', tamperedPlain !== '', tamperedPlain);
  const tamperedSealed = await refusal(
    runRestore({ file: brokenSealed, password: PASSWORD, mode: 'restore', force: true }),
  );
  ok('ZIP adulterado (com senha): recusado', tamperedSealed !== '', tamperedSealed);
  ok('adulterado: nada foi restaurado', (await prisma.entry.count()) === before);

  // ------------------------------------------------------------ 3. ensaio (--rehearsal)
  const rehearsal = await runRestore({ file: sealed, password: PASSWORD, mode: 'rehearsal' });
  ok(
    'ensaio: as contagens do banco restaurado batem com o manifesto',
    rehearsal.counts?.entries.restored === 2 &&
      rehearsal.counts.entries.backup === 2 &&
      rehearsal.counts.users.restored === 1,
    rehearsal.counts,
  );
  ok(
    'ensaio: objetos devolvidos a um bucket próprio',
    rehearsal.objects >= 2 && rehearsal.bucket !== env.S3_BUCKET,
    rehearsal,
  );
  const databases = docker(
    'exec',
    'dl-shadow-pg',
    'psql',
    '-U',
    'postgres',
    '-Atc',
    'select datname from pg_database',
  );
  ok('ensaio: o banco temporário foi apagado', !databases.includes('deeplook_ensaio_'), databases);
  const bucketGone = await s3.send(new HeadBucketCommand({ Bucket: rehearsal.bucket! })).then(
    () => false,
    () => true,
  );
  ok('ensaio: o bucket temporário foi apagado', bucketGone);
  ok('ensaio: a instalação não foi tocada', (await prisma.entry.count()) === before);

  // ------------------------------------------------------------ 4. restauracao de verdade
  const guarded = await refusal(runRestore({ file: sealed, password: PASSWORD, mode: 'restore' }));
  ok('instalação com amostras: recusa sem --force', guarded.includes('--force'), guarded);

  // O estrago: uma amostra some, um usuario aparece, um objeto e apagado e outro e trocado.
  await prisma.entry.deleteMany({ where: { title: 'primeira' } });
  await prisma.user.create({
    data: { email: 'intruso@x.io', displayName: 'x', passwordHash: 'x' },
  });
  await s3.send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: `evidence/${DB}/print.png` }),
  );
  await put(sample, 'conteudo-trocado');
  const restored = await runRestore({
    file: sealed,
    password: PASSWORD,
    mode: 'restore',
    force: true,
  });
  ok(
    'restauração: contagens do manifesto de volta',
    restored.counts?.entries.restored === 2 && restored.counts.users.restored === 1,
    restored.counts,
  );
  const titles = (await prisma.entry.findMany({ select: { title: true } })).map((e) => e.title);
  ok('restauração: a amostra apagada voltou', titles.includes('primeira'), titles);
  ok(
    'restauração: a lixeira volta como lixeira',
    (await prisma.entry.count({ where: { deletedAt: { not: null } } })) === 1,
  );
  ok(
    'restauração: o usuário de depois do backup saiu',
    !(await prisma.user.findUnique({ where: { email: 'intruso@x.io' } })),
  );
  ok(
    'restauração: objeto apagado de volta',
    (await text(`evidence/${DB}/print.png`)) === 'png-de-mentira',
  );
  ok(
    'restauração: objeto trocado volta ao original',
    (await text(sample)) === 'MZ-conteudo-original',
  );

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
