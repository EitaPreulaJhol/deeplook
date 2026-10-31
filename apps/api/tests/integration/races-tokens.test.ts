import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { adminRoutes } from '../../src/routes/admin';
import { authRoutes } from '../../src/routes/auth';
import { meRoutes } from '../../src/routes/me';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const PASSWORD = 'Senha-Forte-123!';
const NEW_PASSWORD = 'Outra-Senha-Forte-456!';

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, meRoutes, adminRoutes]) await app.register(r);
  await app.ready();

  const mkUser = (email: string, data: Record<string, unknown> = {}) =>
    hashPassword(PASSWORD).then((passwordHash) =>
      prisma.user.create({
        data: { email, displayName: email.split('@')[0], role: 'USER', passwordHash, ...data },
      }),
    );
  const login = async (email: string, password = PASSWORD) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const mkToken = async (userId: string) => {
    const secret = newTokenSecret();
    return prisma.apiToken.create({
      data: {
        userId,
        name: 'ci',
        prefix: secret.slice(0, 12),
        tokenHash: hashToken(secret),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  };
  const revoked = async (id: string) =>
    Boolean((await prisma.apiToken.findUniqueOrThrow({ where: { id } })).revokedAt);

  // 1. Chave de um uso com cadastros simultaneos (item 111).
  const creator = await mkUser('chaves@x.io');
  const key = await prisma.activationKey.create({
    data: { code: 'DL-AAAA-BBBB-CCCC', role: 'USER', createdById: creator.id, maxUses: 1 },
  });
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((i) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: `novo${i}@x.io`,
          displayName: `Novo ${i}`,
          password: PASSWORD,
          activationKey: key.code,
        },
      }),
    ),
  );
  const created = results.filter((r) => r.statusCode === 201).length;
  ok(
    'chave de um uso vale uma vez',
    created === 1,
    results.map((r) => r.statusCode),
  );
  ok(
    'os outros recebem o motivo',
    results.filter((r) => r.statusCode === 400 && r.json().error.includes('utilizada')).length ===
      4,
    results.map((r) => r.json().error),
  );
  ok('uma conta só', (await prisma.user.count({ where: { email: { startsWith: 'novo' } } })) === 1);
  ok(
    'usos contados uma vez',
    (await prisma.activationKey.findUniqueOrThrow({ where: { id: key.id } })).usesUsed === 1,
  );

  // 2. Mesmo e-mail ao mesmo tempo: uma conta, sem erro 500.
  const multi = await prisma.activationKey.create({
    data: { code: 'DL-DDDD-EEEE-FFFF', role: 'USER', createdById: creator.id, maxUses: 10 },
  });
  const same = await Promise.all(
    [1, 2, 3].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'igual@x.io',
          displayName: 'Igual',
          password: PASSWORD,
          activationKey: multi.code,
        },
      }),
    ),
  );
  ok(
    'mesmo e-mail simultâneo: 201 e 409',
    same.filter((r) => r.statusCode === 201).length === 1 &&
      same.filter((r) => r.statusCode === 409).length === 2,
    same.map((r) => r.statusCode),
  );

  // 3. Troca voluntaria derruba os tokens (item 108).
  const voluntary = await mkUser('voluntaria@x.io');
  const t1 = await mkToken(voluntary.id);
  const c1 = await login('voluntaria@x.io');
  const changed = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { cookie: c1 },
    payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  ok('troca voluntária', changed.statusCode === 200, changed.json());
  ok('token revogado na troca voluntária', await revoked(t1.id));

  // 4. Senha vencida pela politica: scripts continuam depois da troca.
  const expired = await mkUser('vencida@x.io', {
    passwordChangedAt: new Date(Date.now() - 400 * 86400000),
  });
  const t2 = await mkToken(expired.id);
  const c2 = await login('vencida@x.io');
  const renewed = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { cookie: c2 },
    payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  ok('troca da senha vencida', renewed.statusCode === 200, renewed.json());
  ok('token continua na troca por validade', !(await revoked(t2.id)));

  // 5. Redefinicao pelo admin derruba os tokens.
  await mkUser('adm@x.io', { role: 'ADMIN' });
  const cAdm = await login('adm@x.io');
  const reset = await mkUser('redefinida@x.io');
  const t3 = await mkToken(reset.id);
  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${reset.id}/reset-password`,
    headers: { cookie: cAdm },
  });
  ok('redefinição pelo admin', res.statusCode === 200, res.json());
  ok('token revogado na redefinição', await revoked(t3.id));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
