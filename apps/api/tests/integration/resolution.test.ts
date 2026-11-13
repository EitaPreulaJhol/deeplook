import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
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
    ['cid@x.io', 'USER'],
    ['dan@x.io', 'USER'],
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
  const [cAna, cBob, cCid] = await Promise.all(['ana@x.io', 'bob@x.io', 'cid@x.io'].map(login));
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const mk = (owner: string, data: Record<string, unknown> = {}) =>
    prisma.entry.create({
      data: {
        type: 'URL',
        title: 'Boleto vencido',
        url: 'http://x.top',
        ownerId: ids[owner],
        ...data,
      },
    });
  const inbox = async (c: string) =>
    (await req('GET', '/api/me/notifications?limit=20', c)).json().items as {
      type: string;
      detail: string | null;
      entry: { id: string; resolution: string | null };
    }[];
  const events = (entryId: string) =>
    prisma.entryEvent.findMany({
      where: { entryId, type: 'RESOLUTION_SET' },
      orderBy: { createdAt: 'asc' },
    });

  const main1 = await mk('bob@x.io');
  const dup = await mk('cid@x.io', { duplicateOfId: main1.id, status: 'COMPLETED' });
  const TEXT = 'É golpe: não clique no link e apague o e-mail.';

  // 1. Permissao e validacao.
  ok(
    'quem enviou não escreve a resolução',
    (await req('PATCH', `/api/entries/${main1.id}`, cBob, { resolution: 'pode abrir' }))
      .statusCode === 403,
  );
  let r = await req('PATCH', `/api/entries/${main1.id}`, cAna, { resolution: 'x'.repeat(501) });
  ok('acima de 500 = 400', r.statusCode === 400 && Boolean(r.json().details?.resolution), r.json());

  // 2. Concluir com a resolucao: o aviso de concluida traz a resolucao (sem aviso duplicado).
  r = await req('PATCH', `/api/entries/${main1.id}`, cAna, {
    status: 'COMPLETED',
    verdict: 'MALICIOUS',
    resolution: `  ${TEXT}  `,
  });
  ok('grava aparada', r.statusCode === 200 && r.json().entry.resolution === TEXT, r.json());
  let bob = await inbox(cBob);
  ok(
    'aviso de concluída com a resolução',
    bob.length === 1 && bob[0].type === 'COMPLETED' && bob[0].entry.resolution === TEXT,
    bob,
  );
  ok(
    'histórico',
    (await events(main1.id)).length === 1 && (await events(main1.id))[0].toValue === TEXT,
  );

  // 3. Duplicata herda e quem a enviou e avisado.
  const d = await prisma.entry.findUnique({ where: { id: dup.id } });
  ok('duplicata herda', d?.resolution === TEXT);
  const cid = await inbox(cCid);
  ok(
    'dono da duplicata avisado',
    cid.length === 1 && cid[0].type === 'RESOLUTION' && cid[0].detail === TEXT,
    cid,
  );
  ok('histórico da duplicata (principal)', (await events(dup.id))[0]?.detail === 'principal');

  // 4. Mesma resolucao de novo: nada muda.
  await req('PATCH', `/api/entries/${main1.id}`, cAna, { resolution: TEXT });
  ok(
    'repetir não grava nem avisa',
    (await events(main1.id)).length === 1 && (await inbox(cBob)).length === 1,
  );

  // 5. Alterar numa concluida: quem enviou e avisado.
  const T2 = 'Clicou? Troque a senha agora e avise o suporte.';
  await req('PATCH', `/api/entries/${main1.id}`, cAna, { resolution: T2 });
  bob = await inbox(cBob);
  ok(
    'alterar numa concluída avisa',
    bob.length === 2 && bob[0].type === 'RESOLUTION' && bob[0].detail === T2,
    bob,
  );
  ok('dono da duplicata recebe a nova', (await inbox(cCid))[0]?.detail === T2);
  ok(
    'quem enviou vê na ficha',
    (await req('GET', `/api/entries/${main1.id}`, cBob)).json().entry.resolution === T2,
  );
  ok(
    'quem enviou vê em Meus Uploads',
    (await req('GET', '/api/entries?scope=mine', cBob)).json().items[0].resolution === T2,
  );

  // 6. Em aberto: grava sem avisar (o aviso vem na conclusao).
  const open = await mk('bob@x.io');
  await req('PATCH', `/api/entries/${open.id}`, cAna, { resolution: 'Seguro: pode abrir.' });
  ok('em aberto não avisa', (await inbox(cBob)).length === 2);

  // 7. Remover (vazio): historico, duplicata acompanha, sem aviso.
  r = await req('PATCH', `/api/entries/${main1.id}`, cAna, { resolution: '' });
  ok('vazio remove', r.json().entry.resolution === null);
  ok('remoção no histórico', (await events(main1.id)).at(-1)?.toValue === null);
  ok(
    'duplicata acompanha a remoção',
    (await prisma.entry.findUnique({ where: { id: dup.id } }))?.resolution === null,
  );
  ok('remover não avisa', (await inbox(cBob)).length === 2 && (await inbox(cCid)).length === 2);

  // 8. Marcar como duplicata: herda a da principal; sem resolucao na principal, fica com a sua.
  await req('PATCH', `/api/entries/${main1.id}`, cAna, { resolution: TEXT });
  const own = await mk('dan@x.io', { resolution: 'minha' });
  r = await req('POST', `/api/entries/${own.id}/duplicate`, cAna, { of: main1.id });
  ok(
    'marcada como duplicata herda',
    r.statusCode === 200 &&
      (await prisma.entry.findUnique({ where: { id: own.id } }))?.resolution === TEXT,
    r.json(),
  );
  const plain = await mk('bob@x.io');
  const own2 = await mk('dan@x.io', { resolution: 'minha' });
  await req('POST', `/api/entries/${own2.id}/duplicate`, cAna, { of: plain.id });
  ok(
    'principal sem resolução mantém a da duplicata',
    (await prisma.entry.findUnique({ where: { id: own2.id } }))?.resolution === 'minha',
  );

  // 9. Desmarcar devolve a resolucao de antes (item 103).
  const before = await mk('dan@x.io', { resolution: 'a minha', status: 'IN_REVIEW' });
  await req('POST', `/api/entries/${before.id}/duplicate`, cAna, { of: main1.id });
  ok(
    'herdou ao marcar',
    (await prisma.entry.findUnique({ where: { id: before.id } }))?.resolution === TEXT,
  );
  ok('herança no histórico', (await events(before.id)).at(-1)?.detail === 'principal');
  r = await req('DELETE', `/api/entries/${before.id}/duplicate`, cAna);
  ok(
    'desmarcar devolve a resolução',
    r.statusCode === 200 && r.json().entry.resolution === 'a minha',
    r.json(),
  );
  ok('devolução no histórico', (await events(before.id)).at(-1)?.toValue === 'a minha');
  const none = await mk('dan@x.io');
  await req('POST', `/api/entries/${none.id}/duplicate`, cAna, { of: main1.id });
  r = await req('DELETE', `/api/entries/${none.id}/duplicate`, cAna);
  ok('sem resolução antes: volta sem nenhuma', r.json().entry.resolution === null, r.json());

  // 10. Em massa (item 124): mesmas regras da ficha.
  const bulk = (entryIds: string[], patch: object, c = cAna) =>
    req('POST', '/api/entries/bulk', c, { ids: entryIds, patch });
  const noticesOf = (entryId: string) => prisma.notification.count({ where: { entryId } });
  const T3 = 'Seguro: pode abrir.';
  const openOne = await mk('bob@x.io');
  const doneOne = await mk('bob@x.io', { status: 'COMPLETED' });
  ok(
    'usuário comum não usa',
    (await bulk([openOne.id], { resolution: T3 }, cBob)).statusCode === 403,
  );
  ok(
    'em massa acima de 500 = 400',
    (await bulk([openOne.id], { resolution: 'x'.repeat(501) })).statusCode === 400,
  );
  r = await bulk([openOne.id, doneOne.id], { resolution: `  ${T3}  ` });
  ok('grava aparada em todas', r.statusCode === 200 && r.json().updated === 2, r.json());
  ok(
    'em massa: gravada nas duas',
    (await prisma.entry.count({
      where: { id: { in: [openOne.id, doneOne.id] }, resolution: T3 },
    })) === 2,
  );
  ok(
    'em massa: histórico de cada uma',
    (await events(openOne.id)).at(-1)?.toValue === T3 &&
      (await events(doneOne.id)).at(-1)?.toValue === T3,
  );
  ok(
    'em massa: só a concluída avisa',
    (await noticesOf(openOne.id)) === 0 && (await noticesOf(doneOne.id)) === 1,
  );
  await bulk([doneOne.id], { resolution: T3 });
  ok('em massa: repetir não avisa', (await noticesOf(doneOne.id)) === 1);

  // Principal e duplicata marcadas juntas: um evento e um aviso so, em qualquer ordem.
  for (const principalFirst of [true, false]) {
    const head = await mk('bob@x.io');
    const copy = await mk('cid@x.io', { duplicateOfId: head.id, status: 'COMPLETED' });
    await bulk(principalFirst ? [head.id, copy.id] : [copy.id, head.id], { resolution: T3 });
    const label = principalFirst ? 'principal primeiro' : 'duplicata primeiro';
    ok(
      `${label}: duplicata com a resolução`,
      (await prisma.entry.findUnique({ where: { id: copy.id } }))?.resolution === T3,
    );
    ok(`${label}: um evento`, (await events(copy.id)).length === 1, await events(copy.id));
    ok(`${label}: um aviso`, (await noticesOf(copy.id)) === 1, await noticesOf(copy.id));
  }

  // O limite da rota, com as notificacoes, cabe na transacao.
  const lote = await Promise.all(
    Array.from({ length: 100 }, () => mk('bob@x.io', { status: 'COMPLETED' })),
  );
  r = await bulk(
    lote.map((e) => e.id),
    { resolution: T3, verdict: 'CLEAN' },
  );
  ok('100 amostras de uma vez', r.statusCode === 200 && r.json().updated === 100, r.body);

  // 11. CSV (item 124): para todos, como a ficha; formula neutralizada.
  const FORMULA = '=HYPERLINK("http://x.top")';
  const csvEntry = await mk('bob@x.io', { title: 'Para o CSV', resolution: FORMULA });
  const csv = (await req('GET', '/api/entries/export.csv?q=Para%20o%20CSV', cCid)).body;
  const [head, line] = csv.replace(/^\uFEFF/, '').split('\r\n');
  ok('coluna no CSV', head.split(';').includes('Resolução'), head);
  ok('fórmula neutralizada no CSV', line.includes(`"'=HYPERLINK(""http://x.top"")"`), line);
  ok('amostra certa no CSV', line.startsWith(csvEntry.id), line);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
