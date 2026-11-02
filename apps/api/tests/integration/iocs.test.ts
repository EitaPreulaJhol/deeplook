import { Writable } from 'node:stream';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { requestLogSerializer } from '../../src/lib/request-log';
import { ensureBucket } from '../../src/lib/s3';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes, URL_MAX } from '../../src/routes/entries';
import { iocRoutes } from '../../src/routes/iocs';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes, iocRoutes]) await app.register(r);
  await app.ready();

  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
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
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  // 1. Lista de permitidos na ficha do indicador (item 163): so analistas, como a lista.
  await prisma.allowedIndicator.create({
    data: { kind: 'DOMAIN', value: 'fornecedor.com.br', reason: 'contrato 2026 com o jurídico' },
  });
  const page = async (c: string) =>
    (await req('GET', '/api/iocs/domain/fornecedor.com.br', c)).json();
  const forAna = await page(cAna);
  ok(
    'analista vê o motivo da permissão',
    forAna.allowed?.reason === 'contrato 2026 com o jurídico',
    forAna,
  );
  const forBob = await page(cBob);
  ok('usuário comum não vê a lista de permitidos', forBob.allowed === null, forBob);

  // 2. Envio de link (item 163): so http/https, com tamanho limitado.
  const send = (url: string) => req('POST', '/api/entries/url', cBob, { url, title: 'link' });
  for (const bad of ['javascript:alert(1)', 'ftp://arquivos.exemplo/x', 'data:text/html,oi']) {
    const res = await send(bad);
    ok(`recusa ${bad.split(':')[0]}:`, res.statusCode === 400 && Boolean(res.json().details?.url));
  }
  const long = await send(`https://exemplo.com/${'a'.repeat(URL_MAX)}`);
  ok('recusa link acima do limite', long.statusCode === 400, long.statusCode);
  ok('aceita https', (await send('https://exemplo.com/login?u=1')).statusCode === 201);

  // 3. Log sem a query string (item 163).
  const lines: string[] = [];
  const logged = Fastify({
    logger: {
      level: 'info',
      serializers: { req: requestLogSerializer },
      stream: new Writable({
        write(chunk, _enc, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    },
  });
  logged.get('/api/search', async () => ({ ok: true }));
  await logged.inject({ method: 'GET', url: '/api/search?q=token-da-vitima' });
  await logged.close();
  const all = lines.join('');
  ok(
    'log da API sem a query string',
    all.includes('"url":"/api/search"') && !all.includes('token-da-vitima'),
    all,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
