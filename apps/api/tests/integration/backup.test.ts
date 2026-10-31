import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { configureDump, startBackups } from '../../src/lib/backup';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { authRoutes } from '../../src/routes/auth';
import * as routes from '../../src/routes/backups';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const OUT = process.env.TEST_TMP!;
const DB = new URL(env.DATABASE_URL).pathname.slice(1);
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' });

async function main() {
  await ensureBucket(3, 500);
  configureDump({
    command: ['docker', 'exec', '-i', 'dl-shadow-pg', 'pg_dump'],
    databaseUrl: `postgresql://postgres:pg@localhost:5432/${DB}`,
  });
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, routes.backupRoutes]) await app.register(r);
  await app.ready();
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
  ] as const) {
    await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
  }
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const [cAdm, cAna] = await Promise.all(['adm@x.io', 'ana@x.io'].map(login));
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  const run = DB; // objetos com o nome do banco, para nao misturar execucoes
  const put = (Key: string, body: string) =>
    s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body: body }));
  await put(`evidence/${run}/print.png`, 'png-de-mentira');
  await put(`captures/${run}/pagina.html.txt`, '<html>ok</html>');
  await put(`samples/${run}/malware.exe`, 'MZ-perigoso');
  await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'para restaurar',
      url: 'http://x.top',
      ownerId: (await prisma.user.findFirstOrThrow()).id,
    },
  });

  // 1. Permissao e um por vez.
  ok('analista não gera', (await req('POST', '/api/admin/backups', cAna, {})).statusCode === 403);
  let r = await req('POST', '/api/admin/backups', cAdm, {});
  ok('gera em segundo plano', r.statusCode === 202 && r.json().item.status === 'RUNNING', r.json());
  const first = r.json().item.id as string;
  ok(
    'um por vez = 409',
    (await req('POST', '/api/admin/backups', cAdm, { includeSamples: true })).statusCode === 409,
  );
  await routes.lastRun;
  let list = (await req('GET', '/api/admin/backups', cAdm)).json();
  let b = list.items.find((x: { id: string }) => x.id === first);
  ok(
    'pronto com tamanho e validade',
    b.status === 'READY' &&
      b.progress === 100 &&
      b.size > 0 &&
      list.retentionDays === 7 &&
      new Date(b.expiresAt).getTime() > Date.now() + 6 * 86400000,
    b,
  );
  ok(
    'manifesto sem as amostras',
    b.manifest.includeSamples === false &&
      b.manifest.containsMalware === false &&
      b.manifest.counts.entries === 1 &&
      !b.manifest.counts.objectsByFolder.samples,
    b.manifest,
  );

  // 2. Baixar: auditado; o ZIP confere com o manifesto.
  r = await req('GET', `/api/admin/backups/${first}/download`, cAdm);
  ok(
    'baixa o ZIP',
    r.statusCode === 200 &&
      r.headers['content-type'] === 'application/zip' &&
      String(r.headers['content-disposition']).includes('deeplook-backup-'),
    r.headers,
  );
  ok(
    'analista não baixa',
    (await req('GET', `/api/admin/backups/${first}/download`, cAna)).statusCode === 403,
  );
  ok(
    'download na auditoria',
    (await prisma.auditEvent.count({ where: { action: 'BACKUP_DOWNLOADED' } })) === 1,
  );
  writeFileSync(`${OUT}/b1.zip`, r.rawPayload);
  const py = `
import zipfile, json, hashlib
z = zipfile.ZipFile('/z/b1.zip')
assert z.testzip() is None
m = json.loads(z.read('manifest.json'))
names = z.namelist()
bad = [f['path'] for f in m['files'] if hashlib.sha256(z.read(f['path'])).hexdigest() != f['sha256']]
print(json.dumps({'names': names, 'bad': bad, 'files': len(m['files'])}))
`;
  const check = JSON.parse(
    docker('run', '--rm', '-v', `${OUT}:/z`, 'python:3.12-alpine', 'python', '-c', py).trim(),
  );
  ok('SHA-256 do manifesto conferem', check.bad.length === 0 && check.files >= 3, check);
  ok(
    'banco, objetos, leia-me e manifesto',
    [
      'db/deeplook.dump',
      `objects/evidence/${run}/print.png`,
      `objects/captures/${run}/pagina.html.txt`,
      'LEIA-ME-RESTAURACAO.txt',
      'manifest.json',
    ].every((n) => check.names.includes(n)),
    check.names,
  );
  ok('sem as amostras', !check.names.some((n: string) => n.startsWith('objects/samples/')));
  ok('sem os próprios backups', !check.names.some((n: string) => n.startsWith('objects/backups/')));

  // 3. Restauracao de verdade: pg_restore num banco novo e as contagens batem.
  docker(
    'run',
    '--rm',
    '-v',
    `${OUT}:/z`,
    'alpine:3.20',
    'sh',
    '-c',
    'apk add -q unzip >/dev/null && unzip -o -q /z/b1.zip db/deeplook.dump -d /z/x',
  );
  const restored = `${DB}_rest`;
  docker('exec', 'dl-shadow-pg', 'createdb', '-U', 'postgres', restored);
  docker('cp', `${OUT}/x/db/deeplook.dump`, 'dl-shadow-pg:/tmp/r.dump');
  docker(
    'exec',
    'dl-shadow-pg',
    'pg_restore',
    '-U',
    'postgres',
    '-d',
    restored,
    '--no-owner',
    '/tmp/r.dump',
  );
  const count = (table: string) =>
    docker(
      'exec',
      'dl-shadow-pg',
      'psql',
      '-U',
      'postgres',
      '-d',
      restored,
      '-tAc',
      `select count(*) from "${table}"`,
    ).trim();
  ok(
    'restauração: usuários e amostras batem',
    count('User') === '2' && count('Entry') === '1' && count('_prisma_migrations') !== '0',
    [count('User'), count('Entry')],
  );

  // 4. Com as amostras.
  r = await req('POST', '/api/admin/backups', cAdm, { includeSamples: true });
  await routes.lastRun;
  b = (await req('GET', '/api/admin/backups', cAdm))
    .json()
    .items.find((x: { id: string }) => x.id === r.json().item.id);
  ok(
    'com as amostras: avisa malware',
    b.status === 'READY' &&
      b.includeSamples &&
      b.manifest.containsMalware === true &&
      b.manifest.counts.objectsByFolder.samples >= 1,
    b.manifest,
  );
  ok(
    'geração na auditoria',
    (await prisma.auditEvent.count({ where: { action: 'BACKUP_CREATED' } })) === 2,
  );

  // 5. Falha do pg_dump vira FAILED com o motivo.
  configureDump({
    command: ['docker', 'exec', '-i', 'dl-shadow-pg', 'pg_dump'],
    databaseUrl: 'postgresql://postgres:pg@localhost:5432/nao_existe',
  });
  r = await req('POST', '/api/admin/backups', cAdm, {});
  await routes.lastRun;
  b = await prisma.backup.findUniqueOrThrow({ where: { id: r.json().item.id } });
  ok(
    'falha com o motivo',
    b.status === 'FAILED' &&
      (b.error ?? '').includes('pg_dump falhou') &&
      b.error!.includes('nao_existe'),
    b.error,
  );

  // 6. Vencido: sai do bucket e fica EXPIRED; nao baixa.
  const firstRow = await prisma.backup.findUniqueOrThrow({ where: { id: first } });
  await prisma.backup.update({
    where: { id: first },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  list = (await req('GET', '/api/admin/backups', cAdm)).json();
  ok(
    'vencido fica EXPIRED',
    list.items.find((x: { id: string }) => x.id === first).status === 'EXPIRED',
  );
  let gone = false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: firstRow.key! }));
  } catch {
    gone = true;
  }
  ok('ZIP vencido sai do bucket', gone);
  ok(
    'vencido não baixa',
    (await req('GET', `/api/admin/backups/${first}/download`, cAdm)).statusCode === 404,
  );

  // 7. Excluir.
  const second = list.items.find((x: { status: string }) => x.status === 'READY');
  ok(
    'excluir',
    (await req('DELETE', `/api/admin/backups/${second.id}`, cAdm)).statusCode === 200 &&
      !(await prisma.backup.findUnique({ where: { id: second.id } })),
  );
  ok(
    'exclusão na auditoria',
    (await prisma.auditEvent.count({ where: { action: 'BACKUP_DELETED' } })) === 1,
  );

  // 8. Na subida, o que estava em andamento vira FAILED.
  const stuck = await prisma.backup.create({ data: { status: 'RUNNING', step: 'Copiando...' } });
  startBackups({ error: () => undefined });
  await new Promise((res) => setTimeout(res, 500));
  const after = await prisma.backup.findUniqueOrThrow({ where: { id: stuck.id } });
  ok(
    'interrompido na subida',
    after.status === 'FAILED' && after.error === 'Interrompido: a API reiniciou.',
  );

  docker('exec', 'dl-shadow-pg', 'dropdb', '-U', 'postgres', restored);
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
