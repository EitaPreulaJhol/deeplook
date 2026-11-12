import { hashPassword } from '../../src/lib/crypto';
import {
  type DataKeys,
  keyId,
  needsRekey,
  openSecret,
  rekey,
  sealSecret,
} from '../../src/lib/data-key';
import { pendingRekey, rekeyStoredSecrets } from '../../src/lib/data-key-rekey';
import { prisma } from '../../src/lib/prisma';
import { decryptSecret, encryptSecret, newSecret } from '../../src/lib/two-factor';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// Chave de dados (revisao de novembro, item 1.1): o 2FA deixa de depender do SESSION_SECRET.
async function main() {
  const SESSION = 'segredo-de-sessao-antigo-0123456789';
  const KEY_A = 'a'.repeat(40);
  const KEY_B = 'b'.repeat(40);
  const legacy: DataKeys = { sessionSecret: SESSION, dataKey: '', previous: '' };
  const withA: DataKeys = { sessionSecret: SESSION, dataKey: KEY_A, previous: '' };
  const secret = newSecret();

  // ---- formato e leitura
  const v1 = sealSecret(secret, legacy);
  ok('sem DATA_KEY: cifra em v1, como antes', v1.startsWith('v1:') && v1.split(':').length === 4);
  ok('v1 volta com o SESSION_SECRET', openSecret(v1, legacy) === secret);
  ok('sem DATA_KEY nada precisa recifrar', !needsRekey(v1, legacy) && rekey(v1, legacy) === null);
  const v2 = sealSecret(secret, withA);
  ok('com DATA_KEY: cifra em v2 com o id da chave', v2.startsWith(`v2:${keyId(KEY_A)}:`), v2);
  ok('v2 volta com o DATA_KEY', openSecret(v2, withA) === secret);
  ok('o id não revela a chave', !v2.includes(KEY_A) && keyId(KEY_A) !== keyId(KEY_B));
  ok('duas cifragens do mesmo valor diferem (IV aleatório)', sealSecret(secret, withA) !== v2);

  // ---- o ponto: o SESSION_SECRET pode mudar
  const rotatedSession: DataKeys = {
    ...withA,
    sessionSecret: 'outro-segredo-de-sessao-9876543210',
  };
  ok('v2 continua legível com outro SESSION_SECRET', openSecret(v2, rotatedSession) === secret);
  ok(
    'v1 NÃO sobrevive a outro SESSION_SECRET',
    throws(() => openSecret(v1, rotatedSession)),
  );

  // ---- migracao v1 -> v2 e rotacao do DATA_KEY
  ok('com DATA_KEY, o v1 precisa recifrar', needsRekey(v1, withA) && !needsRekey(v2, withA));
  const migrated = rekey(v1, withA);
  ok(
    'v1 recifrado vira v2 legível',
    Boolean(migrated?.startsWith('v2:')) && openSecret(migrated!, withA) === secret,
  );
  const rotating: DataKeys = { sessionSecret: SESSION, dataKey: KEY_B, previous: KEY_A };
  ok('troca do DATA_KEY: a chave anterior ainda lê', openSecret(v2, rotating) === secret);
  const underB = rekey(v2, rotating);
  const onlyB: DataKeys = { sessionSecret: SESSION, dataKey: KEY_B, previous: '' };
  ok('recifrado com a nova, a anterior pode sair', openSecret(underB!, onlyB) === secret);
  ok(
    'sem a chave anterior, o valor antigo não abre',
    throws(() => openSecret(v2, onlyB)),
  );

  // ---- adulteracao
  const parts = v2.split(':');
  const flipped = [...parts.slice(0, 4), Buffer.from('outro-dado').toString('base64')].join(':');
  ok(
    'dado adulterado é recusado',
    throws(() => openSecret(flipped, withA)),
  );
  const shortTag = [
    parts[0],
    parts[1],
    parts[2],
    Buffer.from(parts[3], 'base64').subarray(0, 4).toString('base64'),
    parts[4],
  ].join(':');
  ok(
    'tag truncada é recusada',
    throws(() => openSecret(shortTag, withA)),
  );
  ok(
    'formato desconhecido é recusado',
    throws(() => openSecret('v9:x:y:z', withA)),
  );

  // ---- o 2FA usa a chave do ambiente (os testes rodam sem DATA_KEY: modo antigo)
  const stored = encryptSecret(secret);
  ok('2FA: cifra e decifra pelo ambiente', decryptSecret(stored) === secret);

  // ---- recifragem no banco
  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, data: object) =>
    prisma.user.create({ data: { email, displayName: 'Ana', passwordHash, ...data } });
  const a = await mk('a@x.io', {
    twoFactorSecret: v1,
    twoFactorPendingSecret: sealSecret('pendente', legacy),
  });
  const b = await mk('b@x.io', { twoFactorSecret: v2 });
  const c = await mk('c@x.io', {
    twoFactorSecret: sealSecret('perdido', {
      ...legacy,
      sessionSecret: 'segredo-que-ninguem-tem-mais-000',
    }),
  });
  await mk('d@x.io', {});
  ok(
    'sem DATA_KEY a recifragem não mexe em nada',
    (await rekeyStoredSecrets(legacy)).rekeyed === 0,
  );
  ok(
    'pendentes contados: os dois de A e o de C',
    (await pendingRekey(withA)) === 3,
    await pendingRekey(withA),
  );
  const first = await rekeyStoredSecrets(withA);
  ok(
    'recifra os dois de A; o de C ninguém lê',
    first.rekeyed === 2 && first.unreadable === 1,
    first,
  );
  const afterA = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
  ok(
    'A: segredo e pendente em v2, com o mesmo conteúdo',
    openSecret(afterA.twoFactorSecret!, rotatedSession) === secret &&
      openSecret(afterA.twoFactorPendingSecret!, rotatedSession) === 'pendente',
  );
  const afterB = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
  ok('B, que já estava em dia, não foi regravado', afterB.twoFactorSecret === v2);
  const afterC = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
  ok(
    'C fica como estava (não se perde o que não se lê)',
    afterC.twoFactorSecret?.startsWith('v1:'),
  );
  const second = await rekeyStoredSecrets(withA);
  ok('rodar de novo não muda nada', second.rekeyed === 0 && second.unreadable === 1, second);
  const third = await rekeyStoredSecrets(rotating);
  ok('troca do DATA_KEY recifra A e B com a chave nova', third.rekeyed === 3, third);
  ok('só o ilegível continua pendente', (await pendingRekey(rotating)) === 1);

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
