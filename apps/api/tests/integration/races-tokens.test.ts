import type { FastifyReply, FastifyRequest } from 'fastify';

import { buildApp } from '../../src/app';
import { hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { createSession } from '../../src/lib/auth';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import {
  base32Decode,
  currentStep,
  decryptSecret,
  encryptSecret,
  hotp,
  newSecret,
} from '../../src/lib/two-factor';
import { checkSecondFactor } from '../../src/routes/two-factor';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const PASSWORD = 'Senha-Forte-123!';
const NEW_PASSWORD = 'Outra-Senha-Forte-456!';

async function main() {
  const app = await buildApp();
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
  // Id da sessao (o valor do cookie) com 256 bits aleatorios, nao um cuid.
  await mkUser('sessao@x.io');
  ok(
    'sessão com id aleatório longo',
    /^dl_session=[0-9a-f]{64}$/.test(await login('sessao@x.io')),
    await login('sessao@x.io'),
  );

  // O mesmo codigo do 2FA em pedidos simultaneos: so um entra.
  const totp = newSecret();
  const totpUser = await mkUser('totp@x.io', {
    twoFactorSecret: encryptSecret(totp),
    twoFactorEnabledAt: new Date(),
  });
  const code = hotp(base32Decode(totp), currentStep());
  const totpResults = await Promise.all(
    Array.from({ length: 8 }, () => checkSecondFactor(prisma, totpUser.id, code)),
  );
  const accepted = totpResults.filter((r) => r.ok).length;
  ok('código 2FA vale uma vez só', accepted === 1, accepted);

  // Segredo do 2FA com a tag do GCM truncada: recusado.
  const [version, iv, tag, data] = encryptSecret(totp).split(':');
  const withTag = (size: number) =>
    [version, iv, Buffer.from(tag, 'base64').subarray(0, size).toString('base64'), data].join(':');
  ok('segredo do 2FA com tag inteira decifra', decryptSecret(withTag(16)) === totp);
  for (const size of [4, 8, 12, 15]) {
    let refused = false;
    try {
      decryptSecret(withTag(size));
    } catch {
      refused = true;
    }
    ok(`segredo do 2FA com tag de ${size} bytes é recusado`, refused);
  }

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

  // 6. Login no meio de uma troca de senha: a sessao nao sobrevive a troca.
  const race = await mkUser('corrida@x.io');
  const fakeReply = { setCookie: () => undefined } as unknown as FastifyReply;
  const fakeReq = { headers: {}, ip: '127.0.0.1' } as unknown as FastifyRequest;
  const newHash = await hashPassword(NEW_PASSWORD);
  let opened: Promise<boolean> | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: race.id }, data: { passwordHash: newHash } });
    await tx.session.deleteMany({ where: { userId: race.id } });
    // A senha antiga ja foi conferida: o login tenta abrir a sessao antes do commit.
    opened = createSession(fakeReply, race, fakeReq);
    await new Promise((r) => setTimeout(r, 300));
  });
  ok('login durante a troca não abre sessão', (await opened!) === false);
  ok(
    'nenhuma sessão depois da troca',
    (await prisma.session.count({ where: { userId: race.id } })) === 0,
  );
  ok(
    'com o hash atual a sessão abre',
    await createSession(fakeReply, { id: race.id, passwordHash: newHash }, fakeReq),
  );

  // 7. Desafio do 2FA de antes da troca de senha nao vira sessao.
  const totp2 = newSecret();
  const twoFa = await mkUser('desafio@x.io', {
    twoFactorSecret: encryptSecret(totp2),
    twoFactorEnabledAt: new Date(),
  });
  const first = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'desafio@x.io', password: PASSWORD },
  });
  const { challenge } = first.json() as { challenge: string };
  await prisma.user.update({ where: { id: twoFa.id }, data: { passwordHash: newHash } });
  const second = await app.inject({
    method: 'POST',
    url: '/api/auth/login/2fa',
    payload: { challenge, code: hotp(base32Decode(totp2), currentStep()) },
  });
  ok('desafio de antes da troca é recusado', second.statusCode === 401, second.json());

  // 8. Senha acima de 72 bytes (o bcrypt ignora o resto) e recusada.
  await mkUser('longa@x.io');
  const cLong = await login('longa@x.io');
  const tooLong = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { cookie: cLong },
    payload: { currentPassword: PASSWORD, newPassword: `Ab1!${'x'.repeat(69)}` },
  });
  ok('senha de 73 bytes recusada', tooLong.statusCode === 400, tooLong.json());
  const accented = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { cookie: cLong },
    payload: { currentPassword: PASSWORD, newPassword: `Ab1!${'é'.repeat(35)}` },
  });
  ok('acento conta 2 bytes', accented.statusCode === 400, accented.json());
  ok(
    'senha de 72 bytes aceita',
    (
      await app.inject({
        method: 'POST',
        url: '/api/me/password',
        headers: { cookie: cLong },
        payload: { currentPassword: PASSWORD, newPassword: `Ab1!${'x'.repeat(68)}` },
      })
    ).statusCode === 200,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
