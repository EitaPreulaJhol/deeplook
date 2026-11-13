import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { NOTIFICATION_TYPES } from '../../src/lib/notification-types';
import { notify } from '../../src/lib/notifications';
import { resolvePreferences } from '../../src/lib/preferences';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const app = await buildApp();
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
    ['adm@x.io', 'ADMIN'],
  ] as const) {
    ids[email] = (
      await prisma.user.create({
        data: {
          email,
          displayName: email.split('@')[0],
          role,
          passwordHash: await hashPassword('senha-123!'),
        },
      })
    ).id;
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
  const [cAna, cBob, cAdm] = await Promise.all(['ana@x.io', 'bob@x.io', 'adm@x.io'].map(login));
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const inbox = async (email: string) =>
    (await prisma.notification.findMany({ where: { userId: ids[email] } })).map((n) => n.type);

  // 1. Tipos pelo papel: o usuario comum so ve os dele.
  const types = async (c: string) =>
    (await req('GET', '/api/me/notification-types', c))
      .json()
      .types.map((t: { type: string }) => t.type);
  const forBob = await types(cBob);
  ok(
    'usuário comum só vê os avisos que pode receber',
    forBob.join() === 'COMPLETED,MENTION,COMMENT,IOC_SEEN,RESOLUTION',
    forBob,
  );
  const forAna = await types(cAna);
  ok(
    'analista vê os de analista, sem o de admin',
    forAna.includes('SLA_WARN') && !forAna.includes('YARA_PACK_UPDATE'),
    forAna,
  );
  ok('admin vê todos', (await types(cAdm)).length === Object.keys(NOTIFICATION_TYPES).length);

  // 2. Gravar: o travado e o desconhecido saem sem derrubar o resto.
  let r = await req('PATCH', '/api/me/preferences', cBob, {
    mutedNotifications: ['MENTION', 'RESOLUTION', 'NAO_EXISTE', 'MENTION'],
  });
  ok(
    'grava só o que pode ser silenciado',
    r.statusCode === 200 && r.json().preferences.mutedNotifications.join() === 'MENTION',
    r.json(),
  );
  ok(
    'valor antigo desconhecido não apaga as outras preferências',
    resolvePreferences({ pageSize: 25, mutedNotifications: ['SUMIU', 'COMMENT'] }).pageSize ===
      25 &&
      resolvePreferences({ mutedNotifications: ['SUMIU', 'COMMENT'] }).mutedNotifications.join() ===
        'COMMENT',
  );
  r = await req('PATCH', '/api/me/preferences', cBob, { mutedNotifications: 'MENTION' });
  ok('formato errado = 400', r.statusCode === 400, r.statusCode);

  // 3. Mencao silenciada: a atualizacao, que a deduplicacao descartaria, chega.
  const entry = await prisma.entry.create({
    data: { type: 'URL', title: 'link', url: 'https://x.test/', ownerId: ids['bob@x.io'] },
  });
  r = await req('POST', `/api/entries/${entry.id}/comments`, cAna, {
    text: 'Olá @bob, veja isto.',
    mentions: [ids['bob@x.io']],
  });
  ok('atualização gravada', r.statusCode === 201, r.json());
  ok(
    'menção silenciada não chega, a atualização sim',
    (await inbox('bob@x.io')).join() === 'COMMENT',
    await inbox('bob@x.io'),
  );

  // 4. Travado chega mesmo gravado a mao no banco (o servidor aplica a regra).
  await prisma.user.update({
    where: { id: ids['bob@x.io'] },
    data: { preferences: { mutedNotifications: ['RESOLUTION', 'COMPLETED'] } },
  });
  await notify(prisma, [
    { userId: ids['bob@x.io'], type: 'RESOLUTION', entryId: entry.id, actorId: ids['ana@x.io'] },
  ]);
  await notify(prisma, [
    { userId: ids['bob@x.io'], type: 'COMPLETED', entryId: entry.id, actorId: ids['ana@x.io'] },
  ]);
  const bob = await inbox('bob@x.io');
  ok(
    'travado chega mesmo silenciado no banco',
    bob.includes('RESOLUTION') && !bob.includes('COMPLETED'),
    bob,
  );

  // 5. Silenciar e de cada um: os outros destinatarios da mesma chamada recebem.
  await notify(prisma, [
    { userId: ids['bob@x.io'], type: 'COMPLETED', entryId: entry.id, actorId: null },
    { userId: ids['ana@x.io'], type: 'COMPLETED', entryId: entry.id, actorId: null },
  ]);
  ok('quem não silenciou recebe', (await inbox('ana@x.io')).includes('COMPLETED'));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
