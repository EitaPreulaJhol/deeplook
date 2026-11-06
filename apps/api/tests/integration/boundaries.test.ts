import { spawnSync } from 'node:child_process';

import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { SESSION_COOKIE, sessionIdOf } from '../../src/lib/auth';
import { CROSS_SITE_ERROR, installCrossSiteGuard } from '../../src/lib/cross-site';
import { hashPassword } from '../../src/lib/crypto';
import { networkPolicy } from '../../src/lib/network';
import { prisma } from '../../src/lib/prisma';
import { insecureDefaults } from '../../src/lib/status';
import { authRoutes } from '../../src/routes/auth';
import { meRoutes } from '../../src/routes/me';
import { sandboxRoutes } from '../../src/routes/sandbox';
import { sessionRoutes } from '../../src/routes/sessions';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const PASSWORD = 'Senha-Forte-123!';
const SUBNET = '172.31.250.0/24';

/** Fronteiras da API: de quem aceita conexao, de que site aceita pedido e o que o banco guarda. */
async function main() {
  // 1. Rede confiavel (vuln-0008): so o nginx da rede deeplook informa o IP do cliente.
  const policy = networkPolicy(SUBNET);
  const probe = Fastify({ trustProxy: policy.trustProxy });
  probe.get('/ip', async (req) => ({ ip: req.ip }));
  await probe.ready();
  const seen = async (remoteAddress: string) =>
    (
      await probe.inject({
        method: 'GET',
        url: '/ip',
        remoteAddress,
        headers: { 'x-forwarded-for': '203.0.113.7' },
      })
    ).json().ip;
  ok('nginx na rede deeplook informa o IP', (await seen('172.31.250.4')) === '203.0.113.7');
  ok('loopback informa o IP', (await seen('127.0.0.1')) === '203.0.113.7');
  ok(
    'vizinho da rede capture não informa o IP',
    (await seen('172.18.0.5')) === '172.18.0.5',
    await seen('172.18.0.5'),
  );
  ok('outra rede privada não informa o IP', (await seen('10.1.2.3')) === '10.1.2.3');
  await probe.close();

  ok('aceita a rede deeplook', policy.allows('172.31.250.4'));
  ok('aceita a rede deeplook mapeada em IPv6', policy.allows('::ffff:172.31.250.4'));
  ok('aceita o loopback', policy.allows('127.0.0.1') && policy.allows('::1'));
  ok('recusa a rede capture', !policy.allows('172.18.0.5'));
  ok('recusa endereço vazio ou inválido', !policy.allows(undefined) && !policy.allows('x'));
  const legacy = networkPolicy('');
  ok(
    'sem TRUSTED_NETWORK: comportamento antigo',
    legacy.trustProxy === 'loopback,linklocal,uniquelocal' && legacy.allows('172.18.0.5'),
  );
  ok(
    'status avisa TRUSTED_NETWORK vazio',
    env.TRUSTED_NETWORK !== '' || insecureDefaults().some((i) => i.includes('TRUSTED_NETWORK')),
    insecureDefaults(),
  );

  // Conexao de verdade: fora da faixa, o socket cai antes de o HTTP ser lido.
  const served = async (value: string) => {
    const server = Fastify();
    server.get('/', async () => ({ ok: true }));
    const warned: unknown[] = [];
    networkPolicy(value, { loopback: false }).guard(server.server, {
      warn: (obj) => warned.push(obj),
    });
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(address).then(
      (r) => r.status,
      () => 'recusada',
    );
    await server.close();
    return { res, warned: warned.length };
  };
  const refused = await served('10.0.0.0/8');
  ok('conexão de fora da faixa derrubada', refused.res === 'recusada', refused);
  ok('a recusa vai para o log', refused.warned === 1, refused);
  const accepted = await served('127.0.0.0/8');
  ok('conexão de dentro da faixa atendida', accepted.res === 200, accepted);

  // 2. Pedido de outro site (CSRF), inclusive WebSocket.
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  installCrossSiteGuard(app);
  for (const r of [authRoutes, meRoutes, sessionRoutes, sandboxRoutes]) await app.register(r);
  await app.ready();

  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  const login = (site?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@x.io', password: PASSWORD },
      headers: site ? { 'sec-fetch-site': site } : {},
    });
  for (const site of ['cross-site', 'same-site']) {
    const res = await login(site);
    ok(
      `POST ${site} recusado`,
      res.statusCode === 403 && res.json().error === CROSS_SITE_ERROR,
      res.body,
    );
  }
  // O limite de login conta cada tentativa (5 em 5 min): duas bastam aqui.
  const sameOrigin = await login('same-origin');
  ok('POST same-origin passa', sameOrigin.statusCode === 200, sameOrigin.body);
  const script = await login();
  ok('POST sem Sec-Fetch-Site (script) passa', script.statusCode === 200, script.body);
  const cookieHeader = String(script.headers['set-cookie']).split(';')[0];
  const token = cookieHeader.split('=')[1];
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: cookieHeader, 'sec-fetch-site': 'cross-site' },
  });
  ok('GET de outro site não é barrado pela regra', me.statusCode === 200, me.statusCode);
  const revoke = await app.inject({
    method: 'POST',
    url: '/api/me/sessions/revoke-others',
    headers: { cookie: cookieHeader, 'sec-fetch-site': 'same-site' },
  });
  ok('mudança de outro subdomínio recusada', revoke.statusCode === 403, revoke.body);

  const closeReason = async (headers: Record<string, string>) => {
    try {
      const ws = await app.injectWS('/api/sandbox/qualquer/console/ws', { headers });
      return await new Promise<string>((res) =>
        ws.on('close', (_c, reason) => res(String(reason))),
      );
    } catch (err) {
      return `recusado: ${(err as Error).message}`;
    }
  };
  const wsCross = await closeReason({ cookie: cookieHeader, 'sec-fetch-site': 'same-site' });
  ok('WebSocket de outro site recusado', wsCross.includes('403'), wsCross);
  const wsSame = await closeReason({ cookie: cookieHeader, 'sec-fetch-site': 'same-origin' });
  ok('WebSocket da mesma origem chega à rota', wsSame === 'sandbox desabilitado', wsSame);

  // 3. O banco guarda o hash da sessao, nunca o valor do cookie.
  ok('cookie com 256 bits aleatórios', /^[0-9a-f]{64}$/.test(token), token);
  const stored = await prisma.session.findMany({ where: { userId: user.id } });
  ok(
    'sessão gravada pelo SHA-256 do cookie',
    stored.some((s) => s.id === sessionIdOf(token)),
    stored.map((s) => s.id),
  );
  ok(
    'nenhum valor de cookie no banco',
    !stored.some((s) => s.id === token),
    stored.map((s) => s.id),
  );
  const list = await app.inject({
    method: 'GET',
    url: '/api/me/sessions',
    headers: { cookie: cookieHeader },
  });
  ok(
    'lista de sessões marca a atual e não leva o cookie',
    list.json().sessions.filter((s: { current: boolean }) => s.current).length === 1 &&
      !list.body.includes(token) &&
      !list.body.includes(sessionIdOf(token)),
    list.body,
  );
  // O id do banco, usado como cookie, nao abre sessao.
  const replay = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: `${SESSION_COOKIE}=${sessionIdOf(token)}` },
  });
  ok('id do banco não serve de cookie', replay.statusCode === 401, replay.statusCode);
  // A migracao converte as sessoes antigas com o mesmo hash que o codigo usa.
  const [sql] = await prisma.$queryRaw<{ h: string }[]>`
    SELECT encode(sha256(convert_to(${token}, 'UTF8')), 'hex') AS h`;
  ok('hash da migração igual ao do código', sql.h === sessionIdOf(token), sql);
  const legacyToken = 'f'.repeat(64);
  await prisma.session.create({
    data: { id: legacyToken, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
  });
  await prisma.$executeRaw`
    UPDATE "Session" SET "id" = encode(sha256(convert_to("id", 'UTF8')), 'hex')
    WHERE "id" = ${legacyToken}`;
  const migrated = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: `${SESSION_COOKIE}=${legacyToken}` },
  });
  ok('sessão anterior à migração continua valendo', migrated.statusCode === 200, migrated.body);
  const logout = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: cookieHeader },
  });
  ok(
    'sair apaga a sessão pelo hash',
    logout.statusCode === 200 &&
      !(await prisma.session.findUnique({ where: { id: sessionIdOf(token) } })),
    logout.body,
  );

  // 4. Sob HTTPS (COOKIE_SECURE=true), o cookie e __Host- com Secure e Path=/.
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `(async () => {
        const Fastify = (await import('fastify')).default;
        const cookie = (await import('@fastify/cookie')).default;
        const auth = await import('./src/lib/auth.ts');
        const app = Fastify();
        await app.register(cookie);
        app.get('/in', async (req, reply) => {
          await auth.createSession(reply, { id: ${JSON.stringify(user.id)}, passwordHash: ${JSON.stringify(passwordHash)} }, req);
          return {};
        });
        app.get('/out', async (_req, reply) => { auth.clearSessionCookie(reply); return {}; });
        const set = async (url) => String((await app.inject({ url })).headers['set-cookie']);
        console.log(JSON.stringify({ in: await set('/in'), out: await set('/out') }));
        await (await import('./src/lib/prisma.ts')).prisma.$disconnect();
      })()`,
    ],
    { env: { ...process.env, COOKIE_SECURE: 'true' }, encoding: 'utf8' },
  );
  const cookies = (() => {
    try {
      return JSON.parse(child.stdout.trim().split('\n').pop() ?? '') as { in: string; out: string };
    } catch {
      return { in: '', out: '' };
    }
  })();
  ok(
    'COOKIE_SECURE: cookie __Host- com Secure e Path=/',
    /^__Host-dl_session=[0-9a-f]{64};/.test(cookies.in) &&
      /; Secure/.test(cookies.in) &&
      /; Path=\//.test(cookies.in) &&
      !/Domain=/i.test(cookies.in),
    { cookies, stderr: child.stderr.slice(-500) },
  );
  ok(
    'COOKIE_SECURE: sair apaga o __Host- com Secure',
    /^__Host-dl_session=;/.test(cookies.out) && /; Secure/.test(cookies.out),
    cookies.out,
  );
  ok('sem COOKIE_SECURE: nome de sempre', SESSION_COOKIE === 'dl_session', SESSION_COOKIE);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
