import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { resetStatusCache } from '../../src/lib/status';
import { adminRoutes } from '../../src/routes/admin';
import { apiTokenRoutes } from '../../src/routes/api-tokens';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { statusRoutes } from '../../src/routes/status';

// Item 3.2: status do sistema por maquina, com token de escopo STATUS (so admin cria, e o
// token so alcanca GET /api/status).

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

interface Created {
  token: { id: string; scope: string; prefix: string };
  secret: string;
}
interface StatusBody {
  checkedAt: string;
  overall: string;
  checks: { id: string; level: string }[];
}

async function main() {
  await ensureBucket(3, 500);
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, apiTokenRoutes, statusRoutes, entryRoutes, adminRoutes]) {
    await app.register(r);
  }
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role, apiAccess] of [
    ['adm@x.io', 'ADMIN', true],
    ['adm-sem-api@x.io', 'ADMIN', false],
    ['ana@x.io', 'ANALYST', true],
    ['dono@x.io', 'USER', true],
  ] as const) {
    const u = await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        apiAccess,
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
  const [cAdm, cAdmSemApi, cAna] = await Promise.all(
    ['adm@x.io', 'adm-sem-api@x.io', 'ana@x.io'].map(login),
  );
  const createToken = (cookieHeader: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/me/api-tokens',
      headers: { cookie: cookieHeader },
      payload,
    });
  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
  const status = (headers: Record<string, string>, query = '') =>
    app.inject({ method: 'GET', url: `/api/status${query}`, headers });

  // 1. Quem cria o token de status.
  const byAna = await createToken(cAna, { name: 'monitor', expiresInDays: 30, scope: 'STATUS' });
  ok('analista não cria token de status', byAna.statusCode === 403, byAna.body);
  ok(
    'a recusa explica que é só para administradores',
    byAna.json().error.includes('Só administradores'),
    byAna.body,
  );
  const noApi = await createToken(cAdmSemApi, {
    name: 'monitor',
    expiresInDays: 30,
    scope: 'STATUS',
  });
  ok(
    'admin sem "Acesso por API" também não (a regra de sempre)',
    noApi.statusCode === 403 && noApi.json().error.includes('acesso por API'),
    noApi.body,
  );
  const bad = await createToken(cAdm, { name: 'monitor', expiresInDays: 30, scope: 'ROOT' });
  ok('escopo inventado é recusado', bad.statusCode === 400, bad.body);

  const made = await createToken(cAdm, { name: 'Uptime Kuma', expiresInDays: 30, scope: 'STATUS' });
  const status1 = made.json<Created>();
  ok(
    'admin cria o token de status',
    made.statusCode === 201 &&
      status1.token.scope === 'STATUS' &&
      status1.secret.startsWith('dlk_'),
    made.body,
  );
  const defaultScope = await createToken(cAdm, { name: 'script', expiresInDays: 30 });
  const samplesToken = defaultScope.json<Created>();
  ok(
    'sem escopo, o token é de amostras (o comportamento de antes)',
    defaultScope.statusCode === 201 && samplesToken.token.scope === 'SAMPLES',
    defaultScope.body,
  );
  const listed = await app.inject({
    method: 'GET',
    url: '/api/me/api-tokens',
    headers: { cookie: cAdm },
  });
  ok(
    'a lista mostra o escopo de cada token',
    listed
      .json<{ tokens: { name: string; scope: string }[] }>()
      .tokens.some((t) => t.name === 'Uptime Kuma' && t.scope === 'STATUS'),
    listed.body,
  );
  const audit = await prisma.auditEvent.findFirst({
    where: { action: 'API_TOKEN_CREATED', targetLabel: { contains: 'Uptime Kuma' } },
  });
  ok(
    'a auditoria da criação diz o escopo',
    audit?.detail?.includes('escopo: somente leitura do status') === true,
    audit,
  );

  // 2. O que o token de status le.
  resetStatusCache();
  const ok1 = await status(bearer(status1.secret));
  const body1 = ok1.json<StatusBody>();
  ok(
    'o token de status lê o status',
    ok1.statusCode === 200 && Array.isArray(body1.checks),
    ok1.body.slice(0, 200),
  );
  ok(
    'é o mesmo objeto da tela: situação geral, hora e as verificações',
    typeof body1.overall === 'string' &&
      Boolean(body1.checkedAt) &&
      ['database', 'storage', 'integrity'].every((id) => body1.checks.some((c) => c.id === id)),
    body1.checks.map((c) => c.id),
  );
  ok(
    'a resposta não vai para cache de navegador nem de proxy',
    ok1.headers['cache-control'] === 'no-store',
  );
  const viaSession = await status({ cookie: cAdm });
  ok(
    'o admin também lê pela sessão do navegador',
    viaSession.statusCode === 200,
    viaSession.statusCode,
  );

  // 3. O que cada escopo NAO alcanca, nos dois sentidos.
  const onEntries = await app.inject({
    method: 'GET',
    url: '/api/entries',
    headers: bearer(status1.secret),
  });
  ok(
    'token de status não lê amostras',
    onEntries.statusCode === 403 && onEntries.json().error.includes('só consulta o status'),
    onEntries.body,
  );
  const onAdmin = await app.inject({
    method: 'GET',
    url: '/api/admin/status',
    headers: bearer(status1.secret),
  });
  ok('token de status não abre a administração', onAdmin.statusCode === 403, onAdmin.body);
  const onUpload = await app.inject({
    method: 'POST',
    url: '/api/entries/url',
    headers: bearer(status1.secret),
    payload: { title: 'x', url: 'http://x.test/' },
  });
  ok('token de status não envia amostra', onUpload.statusCode === 403, onUpload.body);

  const samplesOnStatus = await status(bearer(samplesToken.secret));
  ok(
    'token de amostras não lê o status',
    samplesOnStatus.statusCode === 403 &&
      samplesOnStatus.json().error.includes('não vale para esta rota'),
    samplesOnStatus.body,
  );
  const samplesOnEntries = await app.inject({
    method: 'GET',
    url: '/api/entries',
    headers: bearer(samplesToken.secret),
  });
  ok(
    'token de amostras continua lendo amostras',
    samplesOnEntries.statusCode === 200,
    samplesOnEntries.statusCode,
  );

  // 4. Sem credencial valida.
  ok('sem credencial: 401', (await status({})).statusCode === 401);
  ok(
    'token desconhecido: 401 (e não revela escopo nenhum)',
    (await status(bearer(newTokenSecret()))).statusCode === 401,
  );
  const asAnalyst = await status({ cookie: cAna });
  ok('analista com sessão: 403', asAnalyst.statusCode === 403, asAnalyst.statusCode);

  // 5. O dono deixa de ser admin: o token para de valer na hora.
  await prisma.user.update({ where: { id: ids['adm@x.io'] }, data: { role: 'ANALYST' } });
  const demoted = await status(bearer(status1.secret));
  ok(
    'dono rebaixado: o token de status para de valer',
    demoted.statusCode === 403 && demoted.json().error.includes('deixou de ser administrador'),
    demoted.body,
  );
  await prisma.user.update({ where: { id: ids['adm@x.io'] }, data: { role: 'ADMIN' } });
  ok('promovido de novo: volta a valer', (await status(bearer(status1.secret))).statusCode === 200);

  // 6. Revogado e vencido.
  const expiring = (
    await createToken(cAdm, { name: 'vence', expiresInDays: 1, scope: 'STATUS' })
  ).json<Created>();
  await prisma.apiToken.update({
    where: { id: expiring.token.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  ok('token vencido: 401', (await status(bearer(expiring.secret))).statusCode === 401);
  const toRevoke = (
    await createToken(cAdm, { name: 'revoga', expiresInDays: 5, scope: 'STATUS' })
  ).json<Created>();
  ok('antes de revogar: 200', (await status(bearer(toRevoke.secret))).statusCode === 200);
  await app.inject({
    method: 'DELETE',
    url: `/api/me/api-tokens/${toRevoke.token.id}`,
    headers: { cookie: cAdm },
  });
  ok('depois de revogar: 401', (await status(bearer(toRevoke.secret))).statusCode === 401);

  // 7. Cache curto: um monitor insistente nao vira enxurrada de consultas.
  resetStatusCache();
  const c1 = (await status(bearer(status1.secret))).json<StatusBody>();
  const c2 = (await status(bearer(status1.secret))).json<StatusBody>();
  ok('duas leituras seguidas vêm da mesma verificação', c1.checkedAt === c2.checkedAt, [
    c1.checkedAt,
    c2.checkedAt,
  ]);
  resetStatusCache();
  await new Promise((r) => setTimeout(r, 5));
  const c3 = (await status(bearer(status1.secret))).json<StatusBody>();
  ok('sem o cache, a verificação é refeita', c3.checkedAt !== c1.checkedAt);

  // 8. ?strict=1: monitor que so olha o HTTP.
  ok(
    '?strict=1 com tudo no ar: 200',
    (await status(bearer(status1.secret), '?strict=1')).statusCode === 200,
  );
  ok(
    '?strict inválido: 400',
    (await status(bearer(status1.secret), '?strict=2')).statusCode === 400,
  );

  const original = s3.config.endpoint;
  // Troca o endpoint em tempo de execucao so para este teste.
  s3.config.endpoint = async () => ({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 1,
    path: '/',
  });
  resetStatusCache();
  const strictDown = await status(bearer(status1.secret), '?strict=1');
  ok(
    'MinIO fora com ?strict=1: 503 e a situação geral é "error"',
    strictDown.statusCode === 503 && strictDown.json<StatusBody>().overall === 'error',
    { status: strictDown.statusCode, body: strictDown.body.slice(0, 160) },
  );
  const plainDown = await status(bearer(status1.secret));
  ok(
    'o mesmo estado, sem ?strict: 200 (quem lê o JSON decide)',
    plainDown.statusCode === 200 && plainDown.json<StatusBody>().overall === 'error',
    plainDown.statusCode,
  );
  s3.config.endpoint = original;
  resetStatusCache();
  ok(
    'MinIO de volta: a falha não ficou em cache',
    (await status(bearer(status1.secret), '?strict=1')).statusCode === 200,
  );

  // 9. So o hash vai para o banco, nunca o segredo (como nos tokens de amostras).
  ok(
    'o hash do token de status está gravado (e não o segredo)',
    (await prisma.apiToken.count({
      where: { tokenHash: hashToken(status1.secret), scope: 'STATUS' },
    })) === 1,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
