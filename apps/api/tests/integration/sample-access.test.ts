import { PutObjectCommand } from '@aws-sdk/client-s3';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { extractZipEntry, listZip } from '../../src/lib/zip';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { iocRoutes } from '../../src/routes/iocs';
import { relatedRoutes } from '../../src/routes/related';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  await ensureBucket(3, 500);
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes, iocRoutes, relatedRoutes]) await app.register(r);
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['dono@x.io', 'USER'],
    ['outro@x.io', 'USER'],
    ['ana@x.io', 'ANALYST'],
    ['adm@x.io', 'ADMIN'],
  ] as const) {
    const u = await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        apiAccess: true,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
    ids[email] = u.id;
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
  const [cDono, cOutro, cAna, cAdm] = await Promise.all(
    ['dono@x.io', 'outro@x.io', 'ana@x.io', 'adm@x.io'].map(login),
  );
  const get = (url: string, c: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: c } });

  const storageKey = `samples/${Date.now()}-acesso`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey, Body: 'MZ-teste' }));
  const SHA = 'c'.repeat(64);
  const entry = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.exe',
      ownerId: ids['dono@x.io'],
      storageKey,
      bucket: env.S3_BUCKET,
      originalFilename: 'fatura.exe',
      fileSize: 8,
      sha256: SHA,
      // O tipo que o navegador de quem enviou declarou: nao pode chegar a quem baixa.
      mimeType: 'text/html',
    },
  });
  const url = `/api/entries/${entry.id}/download`;
  const audits = () => prisma.auditEvent.findMany({ where: { action: 'ENTRY_DOWNLOADED' } });

  // 1. Quem baixa (item 122).
  const denied = await get(url, cOutro);
  ok('outro usuário não baixa', denied.statusCode === 403, denied.json());
  ok('recusa não audita', (await audits()).length === 0);
  const own = await get(url, cDono);
  ok('quem enviou baixa', own.statusCode === 200 && own.body === 'MZ-teste', own.statusCode);
  ok(
    'download sai como octet-stream, sem sniff e em sandbox (não como o tipo declarado)',
    own.headers['content-type'] === 'application/octet-stream' &&
      own.headers['x-content-type-options'] === 'nosniff' &&
      /\bsandbox\b/.test(String(own.headers['content-security-policy'])),
    own.headers,
  );
  ok('analista baixa', (await get(url, cAna)).statusCode === 200);
  ok('admin baixa', (await get(url, cAdm)).statusCode === 200);

  // 2. Sempre auditado, com quem, o que e de quem.
  const rows = await audits();
  ok('cada download na auditoria', rows.length === 3, rows.length);
  const byAna = rows.find((r) => r.actorId === ids['ana@x.io']);
  ok(
    'auditoria com amostra e hash',
    byAna?.targetLabel === 'fatura.exe' &&
      byAna.targetUserId === ids['dono@x.io'] &&
      byAna.detail === `SHA-256 ${SHA} · arquivo original`,
    byAna,
  );

  // 2b. ZIP com a senha "infected" (plano pos-revisao, item 2.1).
  const zipped = await get(`${url}?format=zip`, cDono);
  ok('ZIP: 200', zipped.statusCode === 200, zipped.statusCode);
  ok(
    'ZIP: tipo, nome .zip, senha no cabeçalho e o mesmo isolamento do arquivo cru',
    zipped.headers['content-type'] === 'application/zip' &&
      zipped.headers['content-disposition'] === 'attachment; filename="fatura.exe.zip"' &&
      zipped.headers['x-deeplook-zip-password'] === 'infected' &&
      zipped.headers['x-content-type-options'] === 'nosniff' &&
      /\bsandbox\b/.test(String(zipped.headers['content-security-policy'])),
    zipped.headers,
  );
  ok(
    'ZIP: Content-Length calculado antes confere com o corpo',
    Number(zipped.headers['content-length']) === zipped.rawPayload.length,
    [zipped.headers['content-length'], zipped.rawPayload.length],
  );
  const [inside] = listZip(zipped.rawPayload);
  ok(
    'ZIP: uma entrada cifrada com o nome original e o conteúdo da amostra',
    listZip(zipped.rawPayload).length === 1 &&
      inside.encrypted &&
      inside.name === 'fatura.exe' &&
      extractZipEntry(zipped.rawPayload, inside, 'infected', 1024).toString() === 'MZ-teste',
    inside,
  );
  ok('ZIP: o conteúdo não sai em claro', !zipped.rawPayload.includes('MZ-teste'));
  const lastZip = (await audits()).find((r) => r.detail?.includes('ZIP'));
  ok(
    'ZIP: a auditoria registra o formato',
    lastZip?.detail === `SHA-256 ${SHA} · ZIP com senha (infected)`,
    lastZip,
  );
  ok(
    'ZIP: outro usuário continua 403',
    (await get(`${url}?format=zip`, cOutro)).statusCode === 403,
  );
  const badFormat = await get(`${url}?format=exe`, cDono);
  ok('formato desconhecido = 400', badFormat.statusCode === 400, badFormat.json());
  ok('ZIP e formato inválido: só o ZIP entrou na auditoria', (await audits()).length === 4);

  // 3. Arquivo inexistente nao audita nem revela nada a quem nao pode.
  await prisma.entry.update({ where: { id: entry.id }, data: { filePurgedAt: new Date() } });
  ok('expurgado: outro usuário continua 403', (await get(url, cOutro)).statusCode === 403);
  ok('expurgado: quem enviou recebe 410', (await get(url, cDono)).statusCode === 410);
  ok('expurgado não audita', (await audits()).length === 4);
  ok(
    'amostra inexistente = 404',
    (await get('/api/entries/nada/download', cAna)).statusCode === 404,
  );

  // 4. Token de API continua sem baixar.
  const secret = newTokenSecret();
  await prisma.apiToken.create({
    data: {
      userId: ids['dono@x.io'],
      name: 'ci',
      prefix: secret.slice(0, 12),
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  ok(
    'token não baixa',
    (await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${secret}` } }))
      .statusCode === 403,
  );

  // 5. E-mail de quem enviou (item 123), em todas as respostas com amostra.
  const report = await prisma.report.create({
    data: {
      entryId: entry.id,
      analystId: ids['ana@x.io'],
      summary: 's',
      status: 'PUBLISHED',
    },
  });
  await prisma.reportIoc.create({
    data: { reportId: report.id, entryId: entry.id, kind: 'DOMAIN', value: 'evil.top' },
  });
  const twin = await prisma.entry.create({
    data: { type: 'FILE', title: 'gemea.exe', ownerId: ids['outro@x.io'], sha256: SHA },
  });
  const views: [string, string, (b: any) => { id: string; email?: string } | undefined][] = [
    ['lista', '/api/entries?limit=50', (b) => b.items.find((e: any) => e.id === entry.id)?.owner],
    ['ficha', `/api/entries/${entry.id}`, (b) => b.entry.owner],
    [
      'ficha do indicador',
      '/api/iocs/domain/evil.top',
      (b) => b.items.find((i: any) => i.entry.id === entry.id)?.entry.owner,
    ],
    [
      'relacionadas',
      `/api/entries/${twin.id}/related`,
      (b) => b.items.find((i: any) => i.entry.id === entry.id)?.entry.owner,
    ],
  ];
  for (const [name, path, pick] of views) {
    const owner = async (c: string) => {
      const res = await get(path, c);
      return pick(res.json());
    };
    const other = await owner(cOutro);
    ok(
      `${name}: usuário comum só com o nome`,
      other?.id === ids['dono@x.io'] && !('email' in other),
      other,
    );
    ok(`${name}: analista vê o e-mail`, (await owner(cAna))?.email === 'dono@x.io');
    ok(`${name}: admin vê o e-mail`, (await owner(cAdm))?.email === 'dono@x.io');
    ok(`${name}: a própria pessoa vê o e-mail`, (await owner(cDono))?.email === 'dono@x.io');
  }
  const csv = await get('/api/entries/export.csv', cOutro);
  ok(
    'CSV sem e-mail para usuário comum',
    csv.statusCode === 200 && !csv.body.includes('dono@x.io'),
  );
  ok(
    'nome continua visível',
    JSON.stringify(
      (await get(`/api/entries/${entry.id}`, cOutro)).json().entry.owner.displayName,
    ) === '"dono"',
  );

  // 6. Arquivo fora do bucket (backup restaurado sem as amostras, item 106).
  const lost = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'sumiu.exe',
      ownerId: ids['dono@x.io'],
      storageKey: `samples/${Date.now()}-nao-existe`,
      bucket: env.S3_BUCKET,
    },
  });
  const auditsBefore = (await audits()).length;
  const missing = await get(`/api/entries/${lost.id}/download`, cDono);
  ok(
    'arquivo fora do bucket explica',
    missing.statusCode === 404 && missing.json().error.includes('não está no armazenamento'),
    missing.body,
  );
  ok('arquivo fora do bucket não audita', (await audits()).length === auditsBefore);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
