import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import {
  BACKUP_DIR_MARKER,
  checkBackupDir,
  configureDump,
  ensureFreeSpace,
  expireBackups,
  RESTORE_README,
  startBackups,
} from '../../src/lib/backup';
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
  ok(
    'analista não gera',
    (await req('POST', '/api/admin/backups', cAna, { noPassword: true })).statusCode === 403,
  );
  let r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
  ok('gera em segundo plano', r.statusCode === 202 && r.json().item.status === 'RUNNING', r.json());
  const first = r.json().item.id as string;
  ok(
    'um por vez = 409',
    (await req('POST', '/api/admin/backups', cAdm, { includeSamples: true, noPassword: true }))
      .statusCode === 409,
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
  r = await req('POST', '/api/admin/backups', cAdm, { includeSamples: true, noPassword: true });
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
  r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
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

  // 9. Pedidos simultaneos: um so (item 111).
  await prisma.backup.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED' } });
  configureDump({
    command: ['docker', 'exec', '-i', 'dl-shadow-pg', 'pg_dump'],
    databaseUrl: `postgresql://postgres:pg@localhost:5432/${DB}`,
  });
  const many = await Promise.all(
    [1, 2, 3, 4].map(() => req('POST', '/api/admin/backups', cAdm, { noPassword: true })),
  );
  ok(
    'um por vez também em simultâneo',
    many.filter((m) => m.statusCode === 202).length === 1 &&
      many.filter((m) => m.statusCode === 409).length === 3,
    many.map((m) => m.statusCode),
  );
  await routes.lastRun;

  // 11. Senha do ZIP (item 116).
  const bad = async (body: object) =>
    (await req('POST', '/api/admin/backups', cAdm, body)).statusCode;
  ok('sem senha e sem escolher: 400', (await bad({})) === 400);
  ok('senha curta: 400', (await bad({ password: 'curta' })) === 400);
  ok(
    'senha e "sem senha" juntos: 400',
    (await bad({ password: 'Senha-Do-Zip-123', noPassword: true })) === 400,
  );
  const PASS = 'Senha-Do-Zip-123';
  const started = await req('POST', '/api/admin/backups', cAdm, { password: PASS });
  ok(
    'gera com senha',
    started.statusCode === 202 && started.json().item.encrypted === true,
    started.body,
  );
  ok('resposta não devolve a senha', !started.body.includes(PASS));
  await routes.lastRun;
  const sealed = await prisma.backup.findUniqueOrThrow({ where: { id: started.json().item.id } });
  ok('pronto e marcado com senha', sealed.status === 'READY' && sealed.encrypted, sealed.error);
  ok('senha fora do banco', !JSON.stringify(sealed.manifest).includes(PASS));
  const audited = await prisma.auditEvent.findFirst({
    where: { action: 'BACKUP_CREATED', targetLabel: sealed.id },
  });
  ok(
    'auditoria diz "com senha" sem a senha',
    audited?.detail?.includes('com senha') && !audited.detail.includes(PASS),
    audited?.detail,
  );
  const file = await req('GET', `/api/admin/backups/${sealed.id}/download`, cAdm);
  writeFileSync(`${OUT}/sealed.zip`, file.rawPayload);
  const seven = (pw: string, command: string, member = '') =>
    spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${OUT}:/z`,
        'alpine:3.20',
        'sh',
        '-c',
        `apk add -q 7zip >/dev/null 2>&1; 7z ${command} -p'${pw}' /z/sealed.zip ${member}`,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  ok(
    'senha certa abre no 7-Zip',
    seven(PASS, 't').status === 0,
    seven(PASS, 't').stdout.slice(-300),
  );
  ok('senha errada não abre', seven('Outra-Senha-Errada', 't').status !== 0);
  ok('sem a senha, nem o manifesto em claro', !file.rawPayload.includes('"includeSamples"'));
  const inner = JSON.parse(seven(PASS, 'x -so', 'manifest.json').stdout);
  ok(
    'manifesto diz que tem senha',
    inner.encrypted === true && inner.files.length >= 1,
    inner.encrypted,
  );

  // 12. Disco cheio falha antes de montar o ZIP.
  let refused = '';
  try {
    await ensureFreeSpace(OUT, 2 ** 60);
  } catch (err) {
    refused = (err as Error).message;
  }
  ok('sem espaço: recusa com o motivo', refused.includes('Espaço insuficiente'), refused);
  await ensureFreeSpace(OUT, 1024);
  ok('com espaço: segue', true);

  // 13. Pasta de backup (item 6.13): o ZIP vai para BACKUP_DIR, que quem configura aponta para
  // fora do disco dos dados. Sem a marca, um disco desmontado deixaria o backup no disco principal.
  const legacy = await prisma.backup.findFirstOrThrow({
    where: { status: 'READY', key: { startsWith: 'backups/' } },
  });
  const dir = join(OUT, `pasta-backup-${run}`);
  mkdirSync(dir, { recursive: true });
  env.BACKUP_DIR = dir;
  list = (await req('GET', '/api/admin/backups', cAdm)).json();
  ok(
    'pasta sem a marca: a tela mostra o motivo',
    list.destination === 'dir' && String(list.destinationProblem).includes(BACKUP_DIR_MARKER),
    list.destinationProblem,
  );
  r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
  await routes.lastRun;
  b = await prisma.backup.findUniqueOrThrow({ where: { id: r.json().item.id } });
  ok(
    'pasta sem a marca: recusa gravar, com o motivo, e não deixa nada nela',
    b.status === 'FAILED' &&
      (b.error ?? '').includes('disco pode não estar montado') &&
      readdirSync(dir).length === 0,
    { error: b.error, files: readdirSync(dir) },
  );

  writeFileSync(join(dir, BACKUP_DIR_MARKER), '');
  ok('com a marca: pasta pronta', (await checkBackupDir()).ok === true);
  r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
  await routes.lastRun;
  const inDir = await prisma.backup.findUniqueOrThrow({ where: { id: r.json().item.id } });
  const zipName = inDir.key ?? '';
  const zipPath = join(dir, zipName);
  ok(
    'gravado na pasta, com data e id no nome',
    inDir.status === 'READY' &&
      zipName === `deeplook-backup-${inDir.createdAt.toISOString().slice(0, 10)}-${inDir.id}.zip` &&
      existsSync(zipPath) &&
      statSync(zipPath).size === Number(inDir.size),
    { status: inDir.status, error: inDir.error, key: zipName },
  );
  let inBucketToo = true;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: `backups/${inDir.id}.zip` }));
  } catch {
    inBucketToo = false;
  }
  ok('não vai para o bucket', !inBucketToo);
  const zipBytes = readFileSync(zipPath);
  const sha = createHash('sha256').update(zipBytes).digest('hex');
  ok(
    '.sha256 ao lado, no formato do sha256sum',
    readFileSync(`${zipPath}.sha256`, 'utf8') === `${sha}  ${zipName}\n`,
  );
  ok(
    'só o dono lê o ZIP e o .sha256',
    (statSync(zipPath).mode & 0o777) === 0o600 &&
      (statSync(`${zipPath}.sha256`).mode & 0o777) === 0o600,
  );
  ok(
    'nenhum ZIP pela metade fica na pasta',
    !readdirSync(dir).some((f) => f.endsWith('.partial')),
    readdirSync(dir),
  );
  r = await req('GET', `/api/admin/backups/${inDir.id}/download`, cAdm);
  ok(
    'baixa da pasta, os mesmos bytes',
    r.statusCode === 200 && Buffer.compare(r.rawPayload, zipBytes) === 0,
    r.statusCode,
  );
  ok(
    'o backup antigo, no bucket, continua baixando',
    (await req('GET', `/api/admin/backups/${legacy.id}/download`, cAdm)).statusCode === 200,
  );

  // Disco desmontado (ou arquivo levado embora): resposta clara, e nada quebra.
  renameSync(zipPath, `${zipPath}.fora`);
  r = await req('GET', `/api/admin/backups/${inDir.id}/download`, cAdm);
  ok(
    'arquivo fora da pasta: 404 dizendo o que pode ser',
    r.statusCode === 404 && r.json().error.includes('desmontado'),
    r.body,
  );
  renameSync(`${zipPath}.fora`, zipPath);

  // Falha no meio da montagem do ZIP: o provisorio sai da pasta.
  const realSend = s3.send.bind(s3);
  (s3 as unknown as { send: unknown }).send = (command: unknown) =>
    command instanceof GetObjectCommand
      ? Promise.reject(new Error('falha simulada ao ler o MinIO'))
      : realSend(command as never);
  r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
  await routes.lastRun;
  (s3 as unknown as { send: unknown }).send = realSend;
  b = await prisma.backup.findUniqueOrThrow({ where: { id: r.json().item.id } });
  ok(
    'falha no meio: FAILED, e nem o provisório nem o .sha256 ficam',
    b.status === 'FAILED' &&
      (b.error ?? '').includes('falha simulada') &&
      readdirSync(dir).filter((f) => f.includes(b.id)).length === 0,
    { error: b.error, files: readdirSync(dir) },
  );

  // Vencido e excluido: o ZIP e o .sha256 saem da pasta; o resto da pasta fica.
  writeFileSync(join(dir, 'copia-de-outra-pessoa.txt'), 'nao e da API');
  await prisma.backup.update({
    where: { id: inDir.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expireBackups();
  ok(
    'vencido: ZIP e .sha256 saem da pasta, o resto fica',
    !existsSync(zipPath) &&
      !existsSync(`${zipPath}.sha256`) &&
      existsSync(join(dir, 'copia-de-outra-pessoa.txt')) &&
      existsSync(join(dir, BACKUP_DIR_MARKER)),
    readdirSync(dir),
  );
  r = await req('POST', '/api/admin/backups', cAdm, { noPassword: true });
  await routes.lastRun;
  const toDelete = await prisma.backup.findUniqueOrThrow({ where: { id: r.json().item.id } });
  await req('DELETE', `/api/admin/backups/${toDelete.id}`, cAdm);
  ok(
    'excluído: ZIP e .sha256 saem da pasta',
    toDelete.status === 'READY' &&
      !existsSync(join(dir, toDelete.key ?? 'x')) &&
      !existsSync(join(dir, `${toDelete.key}.sha256`)),
    readdirSync(dir),
  );

  // Pasta sem escrita para o usuario da API (como root, tudo e gravavel: nao da para provar).
  if (process.getuid?.() !== 0) {
    chmodSync(dir, 0o555);
    const locked = await checkBackupDir();
    chmodSync(dir, 0o755);
    ok(
      'pasta sem escrita: o motivo diz o uid',
      !locked.ok && locked.error.includes('Sem permissão de escrita'),
      locked,
    );
  }
  env.BACKUP_DIR = '';
  rmSync(dir, { recursive: true, force: true });

  // 10. LEIA-ME avisa o que a restauracao precisa (itens 105 e 106).
  ok('LEIA-ME cita o SESSION_SECRET', RESTORE_README.includes('SESSION_SECRET'));
  ok('LEIA-ME cita o backup sem as amostras', RESTORE_README.includes('Sem objects/samples/'));

  docker('exec', 'dl-shadow-pg', 'dropdb', '-U', 'postgres', restored);
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
