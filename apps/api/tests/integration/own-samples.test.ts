import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { adminRoutes } from '../../src/routes/admin';
import { antivirusRoutes } from '../../src/routes/antivirus';
import { apiTokenRoutes } from '../../src/routes/api-tokens';
import { authRoutes } from '../../src/routes/auth';
import { captureRoutes } from '../../src/routes/captures';
import { caseRoutes } from '../../src/routes/cases';
import { duplicateRoutes } from '../../src/routes/duplicates';
import { entryRoutes } from '../../src/routes/entries';
import { evidenceRoutes } from '../../src/routes/evidence';
import { favoritesRoutes } from '../../src/routes/favorites';
import { graphRoutes } from '../../src/routes/graph';
import { hexRoutes } from '../../src/routes/hex';
import { iocRoutes } from '../../src/routes/iocs';
import { kbRoutes } from '../../src/routes/kb';
import { notificationRoutes } from '../../src/routes/notifications';
import { relatedRoutes } from '../../src/routes/related';
import { reportRoutes } from '../../src/routes/reports';
import { reputationRoutes } from '../../src/routes/reputation';
import { sandboxRoutes } from '../../src/routes/sandbox';
import { searchRoutes } from '../../src/routes/search';
import { settingsRoutes } from '../../src/routes/settings';
import { trashRoutes } from '../../src/routes/trash';
import { yaraRoutes } from '../../src/routes/yara';

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
  // Toda rota de uma amostra entra na varredura, inclusive as que ainda vao existir.
  const entryRouteList: { method: string; url: string }[] = [];
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/entries/:id')) return;
    for (const method of [r.method].flat()) {
      if (method !== 'HEAD' && method !== 'OPTIONS') entryRouteList.push({ method, url: r.url });
    }
  });
  for (const r of [
    authRoutes,
    adminRoutes,
    settingsRoutes,
    entryRoutes,
    antivirusRoutes,
    apiTokenRoutes,
    captureRoutes,
    caseRoutes,
    duplicateRoutes,
    evidenceRoutes,
    favoritesRoutes,
    graphRoutes,
    hexRoutes,
    iocRoutes,
    kbRoutes,
    notificationRoutes,
    relatedRoutes,
    reportRoutes,
    reputationRoutes,
    sandboxRoutes,
    searchRoutes,
    trashRoutes,
    yaraRoutes,
  ]) {
    await app.register(r);
  }
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
    ['cid@x.io', 'USER'],
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
  const cAdm = await login('adm@x.io');
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const get = async (url: string, c: string) => (await req('GET', url, c)).json();
  const SHA = 'a'.repeat(64);
  const mk = (owner: string, title: string, data: Record<string, unknown> = {}) =>
    prisma.entry.create({
      data: {
        type: 'FILE',
        title,
        description: 'palavrachave',
        ownerId: ids[owner],
        sha256: SHA,
        ...data,
      },
    });

  // Amostra de Cid, com tudo o que poderia vazar; a de Bob compartilha arquivo e domínio.
  const secret = await mk('cid@x.io', 'segredo-cid');
  const mine = await mk('bob@x.io', 'minha-bob');
  const dupOfSecret = await mk('bob@x.io', 'duplicata-bob', { duplicateOfId: secret.id });
  const childOfSecret = await mk('bob@x.io', 'filha-bob', { parentEntryId: secret.id });
  const report = await prisma.report.create({
    data: {
      entryId: secret.id,
      analystId: ids['ana@x.io'],
      summary: 'palavrachave resumo',
      status: 'PUBLISHED',
    },
  });
  await prisma.reportIoc.create({
    data: { reportId: report.id, entryId: secret.id, kind: 'DOMAIN', value: 'mal.example.com' },
  });
  await prisma.entryEvent.create({
    data: {
      entryId: secret.id,
      actorId: ids['ana@x.io'],
      type: 'COMMENT',
      detail: 'palavrachave comentario',
    },
  });
  const evidence = await prisma.reportEvidence.create({
    data: {
      reportId: report.id,
      storageKey: 'nao-existe.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      size: 1,
    },
  });
  const article = await prisma.kbArticle.create({
    data: {
      title: 'Artigo',
      summary: 'x',
      body: 'x',
      category: Object.values((await import('../../src/generated/prisma/client')).KbCategory)[0],
      reports: { connect: { id: report.id } },
    },
  });
  const seenNotice = await prisma.notification.create({
    data: { userId: ids['bob@x.io'], type: 'IOC_SEEN', entryId: secret.id, detail: 'mal' },
  });
  const pinned = await prisma.favorite.create({
    data: {
      userId: ids['bob@x.io'],
      kind: 'ENTRY',
      entryId: secret.id,
      label: 'fixada',
      url: `/entries/${secret.id}`,
    },
  });
  const titles = (items: { title: string }[]) => items.map((i) => i.title);

  // 1. Desligada (padrao): nada muda.
  ok('padrão desligado', (await get('/api/me/sample-access', cBob)).ownOnly === false);
  ok(
    'desligada: vê amostra alheia',
    (await req('GET', `/api/entries/${secret.id}`, cBob)).statusCode === 200,
  );
  ok(
    'desligada: lista tem a alheia',
    titles((await get('/api/entries', cBob)).items).includes('segredo-cid'),
  );

  // 2. Quem liga.
  const set = (c: string, value: boolean) =>
    req('PATCH', '/api/admin/settings', c, { ownSamplesOnly: value });
  ok('usuário comum não liga', (await set(cBob, true)).statusCode === 403);
  ok('analista não liga', (await set(cAna, true)).statusCode === 403);
  ok(
    'usuário comum não lê a configuração',
    (await req('GET', '/api/admin/settings', cBob)).statusCode === 403,
  );
  ok(
    'campo desconhecido = 400',
    (await req('PATCH', '/api/admin/settings', cAdm, { outra: true })).statusCode === 400,
  );
  ok('admin liga', (await set(cAdm, true)).json().ownSamplesOnly === true);
  await set(cAdm, true);
  ok(
    'auditada uma vez',
    (await prisma.auditEvent.count({ where: { action: 'SETTING_CHANGED', detail: 'ligada' } })) ===
      1,
  );
  ok('admin lê', (await get('/api/admin/settings', cAdm)).ownSamplesOnly === true);
  ok('tela do usuário sabe', (await get('/api/me/sample-access', cBob)).ownOnly === true);
  ok(
    'tela do analista não restringe',
    (await get('/api/me/sample-access', cAna)).ownOnly === false,
  );

  // 3. Varredura: toda rota de amostra responde 404 para a alheia.
  ok('varredura achou as rotas', entryRouteList.length >= 25, entryRouteList.length);
  for (const r of entryRouteList) {
    const res = await req(
      r.method,
      r.url.replace(':id', secret.id),
      cBob,
      r.method === 'GET' ? undefined : {},
    );
    ok(`404 em ${r.method} ${r.url}`, res.statusCode === 404, res.statusCode);
  }
  const missing = await req('GET', '/api/entries/nao-existe', cBob);
  const hidden = await req('GET', `/api/entries/${secret.id}`, cBob);
  ok('resposta igual à de quem não existe', missing.body === hidden.body, [
    missing.body,
    hidden.body,
  ]);

  // 4. A propria continua.
  const own = await req('GET', `/api/entries/${mine.id}`, cBob);
  ok('a própria abre', own.statusCode === 200, own.body);
  ok(
    'eventos da própria',
    (await req('GET', `/api/entries/${mine.id}/events`, cBob)).statusCode === 200,
  );

  // 5. Ligacoes com a alheia somem da ficha.
  const dup = (await get(`/api/entries/${dupOfSecret.id}`, cBob)).entry;
  ok('principal alheia some', dup.duplicateOf === null, dup.duplicateOf);
  const child = (await get(`/api/entries/${childOfSecret.id}`, cBob)).entry;
  ok('pacote alheio some', child.parentEntry === null, child.parentEntry);
  await prisma.entry.update({ where: { id: mine.id }, data: { duplicateOfId: null } });
  const dupOfMine = await mk('cid@x.io', 'duplicata-cid', { duplicateOfId: mine.id });
  const childOfMine = await mk('cid@x.io', 'filha-cid', { parentEntryId: mine.id });
  const main2 = (await get(`/api/entries/${mine.id}`, cBob)).entry;
  ok(
    'duplicata alheia some',
    main2.duplicates.length === 0 && main2._count.duplicates === 0,
    main2.duplicates,
  );
  ok(
    'filha alheia some',
    (await get(`/api/entries/${mine.id}/children`, cBob)).children.length === 0,
  );
  const ownDup = (await get(`/api/entries/${dupOfMine.id}`, cAna)).entry;
  ok('analista vê a ligação', ownDup.duplicateOf?.id === mine.id, ownDup.duplicateOf);
  ok('sem ownerId na resposta', ownDup.duplicateOf?.ownerId === undefined);
  ok(
    'analista vê a filha',
    (await get(`/api/entries/${mine.id}/children`, cAna)).children.length === 1,
  );
  await prisma.entry.deleteMany({ where: { id: { in: [dupOfMine.id, childOfMine.id] } } });

  // 6. Listas, CSV e contadores.
  const list = await get('/api/entries?scope=all', cBob);
  ok(
    'lista só com as próprias',
    list.total === 3 && !titles(list.items).includes('segredo-cid'),
    titles(list.items),
  );
  ok(
    'filtro por hash não revela',
    !titles((await get(`/api/entries?scope=all&sha256=${SHA}`, cBob)).items).includes(
      'segredo-cid',
    ),
  );
  const csv = (await req('GET', '/api/entries/export.csv', cBob)).body;
  ok('CSV só com as próprias', csv.includes('minha-bob') && !csv.includes('segredo-cid'));
  const counts = await get('/api/entries/counts', cBob);
  ok('contadores só das próprias', counts.counts.PENDING === 3, counts);
  ok('analista vê todas', (await get('/api/entries?scope=all', cAna)).total === 4);

  // 7. Busca.
  const found = await get('/api/search?q=palavrachave', cBob);
  ok(
    'busca: sem a amostra alheia',
    !found.groups.entries.items.some((i: { title: string }) => i.title === 'segredo-cid') &&
      found.groups.entries.total === 3,
    found.groups.entries,
  );
  ok('busca: sem o relatório alheio', found.groups.reports.total === 0, found.groups.reports);
  ok('busca: sem o comentário alheio', found.groups.comments.total === 0, found.groups.comments);
  ok(
    'busca do analista completa',
    (await get('/api/search?q=palavrachave', cAna)).groups.reports.total === 1,
  );

  // 8. Indicador, relacionadas e mapa.
  const ioc = await get(`/api/iocs/sha256/${SHA}`, cBob);
  ok(
    'ficha do indicador só com as próprias',
    ioc.total === 3 &&
      !ioc.items.some((i: { entry: { title: string } }) => i.entry.title === 'segredo-cid'),
    ioc.total,
  );
  ok(
    'relatório alheio não aparece',
    (await get('/api/iocs/domain/mal.example.com', cBob)).total === 0,
  );
  ok('analista vê o relatório', (await get('/api/iocs/domain/mal.example.com', cAna)).total === 1);
  const related = await get(`/api/entries/${mine.id}/related`, cBob);
  ok(
    'relacionadas só com as próprias',
    !related.items.some((r: { entry: { id: string } }) => r.entry.id === secret.id) &&
      related.total === 2,
    related.total,
  );
  ok(
    'analista vê a relacionada',
    (await get(`/api/entries/${mine.id}/related`, cAna)).items.some(
      (r: { entry: { id: string } }) => r.entry.id === secret.id,
    ),
  );
  const graph = await get(`/api/entries/${mine.id}/graph`, cBob);
  ok(
    'mapa só com as próprias',
    !graph.nodes.some((n: { label: string }) => n.label === 'segredo-cid'),
    graph.nodes,
  );

  // 9. Avisos, favoritos, evidencia e base de conhecimento.
  const inbox = await get('/api/me/notifications', cBob);
  ok(
    'aviso de amostra alheia some',
    !inbox.items.some((n: { id: string }) => n.id === seenNotice.id) && inbox.unread === 0,
    inbox,
  );
  const favs = await get('/api/me/favorites', cBob);
  ok(
    'favorito antigo some',
    !favs.favorites.some((f: { id: string }) => f.id === pinned.id),
    favs.favorites,
  );
  await prisma.favorite.delete({ where: { id: pinned.id } });
  ok(
    'não fixa amostra alheia',
    (await req('POST', '/api/me/favorites', cBob, { kind: 'ENTRY', entryId: secret.id }))
      .statusCode === 404,
  );
  ok(
    'fixa a própria',
    (await req('POST', '/api/me/favorites', cBob, { kind: 'ENTRY', entryId: mine.id }))
      .statusCode === 201,
  );
  ok(
    'evidência alheia = 404',
    (await req('GET', `/api/evidence/${evidence.id}`, cBob)).statusCode === 404,
  );
  const kb = await get(`/api/kb/${article.id}`, cBob);
  ok('artigo abre', Boolean(kb.article));
  ok('citação alheia some do artigo', kb.article.reports.length === 0, kb.article.reports);
  ok(
    'analista vê a citação',
    (await get(`/api/kb/${article.id}`, cAna)).article.reports.length === 1,
  );

  // 10. "Ja enviada antes" nao revela a alheia.
  const send = (c: string, text: string) => {
    const boundary = 'xxBOUNDARYxx';
    return app.inject({
      method: 'POST',
      url: '/api/entries/file',
      headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.txt"',
        'Content-Type: text/plain',
        '',
        text,
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    });
  };
  const cCid = await login('cid@x.io');
  const firstByCid = await send(cCid, 'conteudo repetido');
  const bobSends = await send(cBob, 'conteudo repetido');
  ok('envio da alheia não aparece', bobSends.json().previous === null, bobSends.json().previous);
  const bobAgain = await send(cBob, 'conteudo repetido');
  ok(
    'o próprio envio aparece',
    bobAgain.json().previous?.id === bobSends.json().entry.id,
    bobAgain.json().previous,
  );
  const anaSends = await send(cAna, 'conteudo repetido');
  ok('analista vê o primeiro', anaSends.json().previous?.id === firstByCid.json().entry.id);

  // 11. Token de API segue a mesma regra.
  await prisma.user.update({ where: { id: ids['bob@x.io'] }, data: { apiAccess: true } });
  const token = await req('POST', '/api/me/api-tokens', cBob, { name: 'ci', expiresInDays: 30 });
  const secretToken = token.json().secret;
  const byToken = (url: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${secretToken}` } });
  ok('token criado', Boolean(secretToken), token.body);
  ok('token: a própria abre', (await byToken(`/api/entries/${mine.id}`)).statusCode === 200);
  ok('token: a alheia = 404', (await byToken(`/api/entries/${secret.id}`)).statusCode === 404);

  // 12. Desligar vale na hora e reabre o que estava escondido.
  ok('admin desliga', (await set(cAdm, false)).json().ownSamplesOnly === false);
  ok(
    'desligada de novo: vê',
    (await req('GET', `/api/entries/${secret.id}`, cBob)).statusCode === 200,
  );
  ok(
    'aviso volta',
    (await get('/api/me/notifications', cBob)).items.some(
      (n: { id: string }) => n.id === seenNotice.id,
    ),
  );
  ok(
    'desligar auditado',
    (await prisma.auditEvent.count({
      where: { action: 'SETTING_CHANGED', detail: 'desligada' },
    })) === 1,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
