import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

type Item = {
  type: string;
  detail: string | null;
  entry: unknown;
  case: { id: string; code: string; title: string } | null;
  actor: { displayName: string } | null;
};

async function main() {
  const app = await buildApp();
  await app.ready();
  const ids: Record<string, string> = {};
  const people = [
    ['ana@x.io', 'Ana Souza', 'ANALYST'],
    ['bia@x.io', 'Bia Lima', 'ANALYST'],
    ['caio@x.io', 'Caio Reis', 'ANALYST'],
    ['dani@x.io', 'Dani User', 'USER'],
  ] as const;
  for (const [email, displayName, role] of people) {
    ids[email] = (
      await prisma.user.create({
        data: { email, displayName, role, passwordHash: await hashPassword('senha-123!') },
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
  const [cAna, cBia, cCaio, cDani] = await Promise.all(
    ['ana@x.io', 'bia@x.io', 'caio@x.io', 'dani@x.io'].map(login),
  );
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const inbox = async (c: string) =>
    (await req('GET', '/api/me/notifications?limit=50', c)).json() as {
      items: Item[];
      unread: number;
    };
  const mk = (title: string) =>
    prisma.entry.create({
      data: { type: 'URL', title, url: 'http://x.top', ownerId: ids['dani@x.io'] },
    });
  const [e1, e2, e3] = await Promise.all([mk('Boleto 1'), mk('Boleto 2'), mk('Boleto 3')]);

  // Ana cria o caso (fica responsavel): ninguem e avisado.
  const cs = (
    await req('POST', '/api/cases', cAna, { title: 'Campanha do boleto', entryIds: [e1.id] })
  ).json().case;
  ok(
    'criar não avisa ninguém',
    (await inbox(cAna)).items.length === 0 && (await inbox(cBia)).items.length === 0,
  );

  // 1. Comentario de outra pessoa avisa o responsavel; o proprio nao.
  await req('POST', `/api/cases/${cs.id}/comments`, cBia, {
    text: 'Achei mais dois e-mails iguais.',
  });
  let ana = await inbox(cAna);
  ok(
    'responsável avisado do comentário',
    ana.items.length === 1 &&
      ana.items[0].type === 'CASE_COMMENT' &&
      ana.items[0].detail === 'Achei mais dois e-mails iguais.' &&
      ana.items[0].actor?.displayName === 'Bia Lima',
    ana.items,
  );
  ok(
    'aviso traz o caso (abre o caso), sem amostra',
    ana.items[0].case?.id === cs.id &&
      ana.items[0].case?.code === 'CASO-0001' &&
      ana.items[0].entry === null,
    ana.items[0],
  );
  ok('conta como não lida', ana.unread === 1);
  await req('POST', `/api/cases/${cs.id}/comments`, cAna, { text: 'Obrigada!' });
  ok('comentário do próprio responsável não avisa', (await inbox(cAna)).items.length === 1);

  // 2. Mencoes: so analistas; o responsavel mencionado recebe so a mencao.
  const r = await req('POST', `/api/cases/${cs.id}/comments`, cBia, {
    text: '@Caio Reis e @Ana Souza, vejam. @Dani User também.',
    mentions: [ids['caio@x.io'], ids['ana@x.io'], ids['dani@x.io']],
  });
  ok('comentário com menções', r.statusCode === 201);
  const caio = await inbox(cCaio);
  ok(
    'mencionado avisado',
    caio.items.length === 1 &&
      caio.items[0].type === 'CASE_MENTION' &&
      caio.items[0].case?.id === cs.id,
    caio.items,
  );
  ana = await inbox(cAna);
  ok(
    'responsável mencionado recebe só a menção',
    ana.items.length === 2 && ana.items[0].type === 'CASE_MENTION',
    ana.items.map((i) => i.type),
  );
  ok('usuário comum não é mencionado no caso', (await inbox(cDani)).items.length === 0);
  const ev = await prisma.caseEvent.findFirst({
    where: { caseId: cs.id, type: 'COMMENT', actorId: ids['bia@x.io'], toValue: { not: null } },
  });
  ok(
    'menções gravadas no comentário (sem o usuário comum)',
    JSON.parse(ev?.toValue ?? '[]').length === 2,
    ev?.toValue,
  );
  await req('POST', `/api/cases/${cs.id}/comments`, cBia, {
    text: 'sem nome no texto',
    mentions: [ids['caio@x.io']],
  });
  ok('id sem "@Nome" no texto não avisa', (await inbox(cCaio)).items.length === 1);

  // 3. Incluir e retirar amostras avisa o responsavel.
  await req('POST', `/api/cases/${cs.id}/entries`, cBia, { entryIds: [e2.id, e3.id] });
  ana = await inbox(cAna);
  ok(
    'incluir avisa com quantas',
    ana.items[0].type === 'CASE_ENTRY_ADDED' && ana.items[0].detail === '2 amostra(s)',
    ana.items[0],
  );
  await req('POST', `/api/cases/${cs.id}/entries`, cBia, { entryIds: [e2.id] });
  ok(
    'incluir de novo (nada novo) não avisa',
    (await inbox(cAna)).items.length === ana.items.length,
  );
  await req('DELETE', `/api/cases/${cs.id}/entries/${e3.id}`, cBia);
  ana = await inbox(cAna);
  ok(
    'retirar avisa com o título',
    ana.items[0].type === 'CASE_ENTRY_REMOVED' && ana.items[0].detail === 'Boleto 3',
    ana.items[0],
  );
  const before = ana.items.length;
  await req('POST', `/api/cases/${cs.id}/entries`, cAna, { entryIds: [e3.id] });
  ok('o responsável incluindo não se avisa', (await inbox(cAna)).items.length === before);

  // 4. Atribuir o caso avisa o novo responsavel; daí em diante ele recebe.
  await req('PATCH', `/api/cases/${cs.id}`, cAna, { assigneeId: ids['caio@x.io'] });
  const caio2 = await inbox(cCaio);
  ok(
    'novo responsável avisado',
    caio2.items[0].type === 'CASE_ASSIGNED' && caio2.items[0].actor?.displayName === 'Ana Souza',
    caio2.items[0],
  );
  await req('POST', `/api/cases/${cs.id}/comments`, cBia, { text: 'Caio, assume?' });
  ok(
    'agora o novo responsável recebe os comentários',
    (await inbox(cCaio)).items[0].type === 'CASE_COMMENT',
  );
  await req('PATCH', `/api/cases/${cs.id}`, cAna, { assigneeId: null });
  await req('POST', `/api/cases/${cs.id}/comments`, cBia, { text: 'Sem responsável agora.' });
  ok(
    'sem responsável, comentário não avisa ninguém',
    (await inbox(cCaio)).items[0].detail === 'Caio, assume?',
  );

  // 5. Marcar como lidas inclui as de caso; avisos de amostras seguem iguais.
  await req('POST', '/api/me/notifications/read', cAna, {});
  ok('marcar todas como lidas', (await inbox(cAna)).unread === 0);
  await req('PATCH', `/api/entries/${e1.id}`, cAna, { status: 'COMPLETED' });
  const dani = await inbox(cDani);
  ok(
    'aviso de amostra continua com a amostra',
    dani.items[0].type === 'COMPLETED' && dani.items[0].case === null,
    dani.items[0],
  );

  // 6. A amostra na lixeira esconde só os avisos dela.
  await prisma.entry.update({ where: { id: e1.id }, data: { deletedAt: new Date() } });
  ok(
    'lixeira esconde o aviso da amostra, não os de caso',
    (await inbox(cDani)).items.length === 0 && (await inbox(cCaio)).items.length > 0,
  );

  // 7. Restricao: notificacao sempre de uma amostra ou de um caso.
  let rejected = false;
  try {
    await prisma.notification.create({ data: { userId: ids['ana@x.io'], type: 'CASE_COMMENT' } });
  } catch {
    rejected = true;
  }
  ok('sem amostra e sem caso é recusada', rejected);

  // 8. Autocompletar do caso so com analistas.
  const all = (await req('GET', '/api/users/mentionable?q=', cBia)).json().users as {
    displayName: string;
  }[];
  const analysts = (await req('GET', '/api/users/mentionable?q=&analysts=1', cBia)).json()
    .users as { displayName: string }[];
  ok(
    'autocompletar do caso só com analistas',
    all.some((u) => u.displayName === 'Dani User') &&
      !analysts.some((u) => u.displayName === 'Dani User') &&
      analysts.length === 2,
    analysts,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
