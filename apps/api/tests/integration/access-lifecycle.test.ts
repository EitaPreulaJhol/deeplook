import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

// Quem ve o que, e o que muda quando a conta perde acesso; cota com envios simultaneos.
let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 20;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
    ['cid@x.io', 'USER'],
    ['dan@x.io', 'USER'],
    ['eva@x.io', 'ANALYST'],
    ['fay@x.io', 'USER'],
    ['gil@x.io', 'USER'],
    ['hal@x.io', 'USER'],
  ] as const) {
    ids[email] = (
      await prisma.user.create({
        data: {
          email,
          displayName: email.split('@')[0],
          role,
          apiAccess: true,
          passwordHash: await hashPassword('senha-123!'),
        },
      })
    ).id;
  }
  const loginAs = (email: string, ip: string, password = 'senha-123!', device?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
      remoteAddress: ip,
      ...(device ? { headers: { cookie: device } } : {}),
    });
  const cookies = (r: { headers: Record<string, unknown> }) =>
    [r.headers['set-cookie']].flat().map((c) => String(c).split(';')[0]);
  let ip = 0;
  const login = async (email: string) => cookies(await loginAs(email, `10.9.0.${++ip}`))[0];
  const cAdm = await login('adm@x.io');
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const cCid = await login('cid@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const get = async (url: string, c: string) => (await req('GET', url, c)).json();
  const mk = (owner: string, title: string, data: Record<string, unknown> = {}) =>
    prisma.entry.create({ data: { type: 'FILE', title, ownerId: ids[owner], ...data } });

  // 1. PATCH nao entrega o e-mail de quem enviou.
  const ofCid = await mk('cid@x.io', 'amostra-cid');
  const patched = (await req('PATCH', `/api/entries/${ofCid.id}`, cBob, {})).json();
  ok('PATCH de outro usuário sem e-mail', patched.entry.owner.email === undefined, patched);
  ok(
    'PATCH do dono com e-mail',
    (await req('PATCH', `/api/entries/${ofCid.id}`, cCid, {})).json().entry.owner.email ===
      'cid@x.io',
  );
  ok(
    'PATCH do analista com e-mail',
    (await req('PATCH', `/api/entries/${ofCid.id}`, cAna, {})).json().entry.owner.email ===
      'cid@x.io',
  );

  // 2. Historico: etapas da revisao so para analistas.
  for (const [type, data] of [
    ['REPORT_CREATED', { toValue: 'SUSPICIOUS' }],
    ['REPORT_SUBMITTED', { toValue: 'SUSPICIOUS' }],
    ['REPORT_RETURNED', { detail: 'NOTA-DO-REVISOR' }],
    ['REPORT_APPROVED', {}],
    ['SANDBOX_FAILED', { detail: 'ERRO-DO-PROXMOX' }],
    ['REPORT_PUBLISHED', { toValue: 'MALICIOUS' }],
    ['STATUS_CHANGED', { fromValue: 'PENDING', toValue: 'COMPLETED' }],
  ] as const) {
    await prisma.entryEvent.create({
      data: { entryId: ofCid.id, actorId: ids['ana@x.io'], type, ...data },
    });
  }
  const typesFor = async (c: string) =>
    (await get(`/api/entries/${ofCid.id}/events`, c)).events.map((e: { type: string }) => e.type);
  const seenByOwner = await typesFor(cCid);
  ok(
    'dono não vê revisão, rascunho nem erro do sandbox',
    !seenByOwner.some((t: string) => /REPORT_(CREATED|SUBMITTED|RETURNED|APPROVED)|FAILED/.test(t)),
    seenByOwner,
  );
  ok(
    'dono vê a publicação e o status',
    seenByOwner.includes('REPORT_PUBLISHED') && seenByOwner.includes('STATUS_CHANGED'),
  );
  ok(
    'analista vê tudo',
    (await req('GET', `/api/entries/${ofCid.id}/events`, cAna)).body.includes('NOTA-DO-REVISOR'),
  );

  // 3. Dados do ambiente isolado.
  const box = await prisma.sandboxSession.create({
    data: {
      entryId: ofCid.id,
      analystId: ids['ana@x.io'],
      node: 'pve-1',
      name: 'dl-x',
      ip: '10.99.0.7',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const boxOf = async (c: string) => (await get(`/api/entries/${ofCid.id}/sandbox`, c)).session;
  ok('usuário não vê o ambiente', (await boxOf(cBob)) === null);
  ok('dono da amostra não vê o ambiente', (await boxOf(cCid)) === null);
  ok('analista vê o ambiente', (await boxOf(cAna))?.ip === '10.99.0.7');

  // 4. Analista rebaixado perde o ambiente que abriu.
  const huge = await req('POST', `/api/sandbox/${box.id}/extend`, cAna, { minutes: 1e300 });
  ok('extensão enorme não dá 500', huge.statusCode === 200, huge.body);
  ok(
    'extensão limitada a um TTL',
    new Date(huge.json().session?.expiresAt ?? Infinity).getTime() <=
      box.expiresAt.getTime() + env.SANDBOX_TTL_MINUTES * 60_000 + 1000,
  );
  ok(
    'rebaixar responde',
    (await req('PATCH', `/api/admin/users/${ids['ana@x.io']}`, cAdm, { role: 'USER' }))
      .statusCode === 200,
  );
  for (const [method, url] of [
    ['GET', `/api/sandbox/${box.id}`],
    ['POST', `/api/sandbox/${box.id}/extend`],
    ['GET', `/api/sandbox/${box.id}/console/credentials`],
    ['DELETE', `/api/sandbox/${box.id}`],
  ]) {
    const r = await req(method, url, cAna, method === 'POST' ? {} : undefined);
    ok(
      `rebaixado: ${method} ${url.split(box.id)[1] || '/'} recusado`,
      r.statusCode === 403,
      r.body,
    );
  }
  ok('rebaixado: lista vazia', (await get('/api/sandbox?active=true', cAna)).sessions.length === 0);
  let closed = null;
  for (let i = 0; i < 40 && !closed; i++) {
    closed = await prisma.sandboxSession.findFirst({ where: { id: box.id, status: 'STOPPED' } });
    if (!closed) await sleep(100);
  }
  ok('rebaixar encerra o ambiente', Boolean(closed));
  ok(
    'encerramento no histórico',
    (await prisma.entryEvent.count({
      where: { entryId: ofCid.id, type: 'SANDBOX_CLOSED', detail: { contains: 'removido' } },
    })) === 1,
  );

  // 5. Suspender encerra sessoes e tokens de vez.
  const cDan = await login('dan@x.io');
  const token = (
    await req('POST', '/api/me/api-tokens', cDan, { name: 'teste', expiresInDays: 30 })
  ).json();
  const bearer = { authorization: `Bearer ${token.secret ?? token.token}` };
  const withToken = () => app.inject({ method: 'GET', url: '/api/entries', headers: bearer });
  ok('token vale antes', (await withToken()).statusCode === 200, token);
  const danStatus = (status: string) =>
    req('PATCH', `/api/admin/users/${ids['dan@x.io']}`, cAdm, { status });
  ok('suspende', (await danStatus('SUSPENDED')).statusCode === 200);
  ok('suspensa: sessão recusada', (await req('GET', '/api/auth/me', cDan)).statusCode === 401);
  ok('reativa', (await danStatus('ACTIVE')).statusCode === 200);
  ok(
    'reativada: sessão antiga não volta',
    (await req('GET', '/api/auth/me', cDan)).statusCode === 401,
  );
  ok('reativada: token antigo não volta', (await withToken()).statusCode === 401);
  ok('reativada: entra de novo', (await loginAs('dan@x.io', '10.9.1.1')).statusCode === 200);
  ok(
    'revogação na auditoria',
    (await prisma.auditEvent.count({
      where: { action: 'USER_SUSPENDED', detail: { contains: 'revogados' } },
    })) === 1,
  );

  // 6. Restricao ligada: a amostra de outra pessoa nao aparece pelos vinculos.
  const setOwn = (value: boolean) =>
    req('PATCH', '/api/admin/settings', cAdm, { ownSamplesOnly: value });
  const foreign = await mk('cid@x.io', 'TITULO-DE-CID');
  const dup = await mk('bob@x.io', 'dup-de-bob', { duplicateOfId: foreign.id });
  const child = await mk('bob@x.io', 'filha-de-bob', { parentEntryId: foreign.id });
  const ownParent = await mk('bob@x.io', 'pai-de-bob');
  const ownChild = await mk('bob@x.io', 'filha-do-bob', { parentEntryId: ownParent.id });
  for (const type of ['MARKED_DUPLICATE', 'UNMARKED_DUPLICATE'] as const) {
    await prisma.entryEvent.create({
      data: {
        entryId: dup.id,
        actorId: ids['adm@x.io'],
        type,
        toValue: type === 'MARKED_DUPLICATE' ? foreign.title : null,
        detail: foreign.id,
      },
    });
  }
  await setOwn(true);
  const leaks = (body: string) => body.includes(foreign.id) || body.includes('TITULO-DE-CID');
  const detail = await req('GET', `/api/entries/${dup.id}`, cBob);
  ok('detalhe sem o id da principal', !leaks(detail.body), detail.body.slice(0, 300));
  const list = await req('GET', '/api/entries?limit=50', cBob);
  ok('lista sem o id da principal', !leaks(list.body));
  ok(
    'lista mantém o aviso de duplicata',
    list.json().items.find((e: { id: string }) => e.id === dup.id).isDuplicate === true,
  );
  ok(
    'PATCH sem o id da principal',
    !leaks((await req('PATCH', `/api/entries/${dup.id}`, cBob, {})).body),
  );
  ok(
    'histórico sem o título e o id',
    !leaks((await req('GET', `/api/entries/${dup.id}/events`, cBob)).body),
  );
  ok(
    'filha sem o id do pai de outra pessoa',
    !leaks((await req('GET', `/api/entries/${child.id}`, cBob)).body),
  );
  ok(
    'pai da própria pessoa continua',
    (await get(`/api/entries/${ownChild.id}`, cBob)).entry.parentEntryId === ownParent.id,
  );
  await setOwn(false);
  ok(
    'desligada: vínculo visível',
    (await get(`/api/entries/${dup.id}`, cBob)).entry.duplicateOfId === foreign.id,
  );
  ok(
    'desligada: histórico inteiro',
    (await req('GET', `/api/entries/${dup.id}/events`, cBob)).body.includes('TITULO-DE-CID'),
  );

  // 7. Janela por e-mail: de fora nao tranca quem ja entrou por este navegador.
  const known = await loginAs('fay@x.io', '10.8.0.1');
  const device = cookies(known).find((c) => c.startsWith('dl_device='));
  ok('login guarda o navegador', Boolean(device), known.headers['set-cookie']);
  const other = cookies(await loginAs('gil@x.io', '10.8.0.2')).find((c) =>
    c.startsWith('dl_device='),
  );
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) await loginAs('fay@x.io', `10.7.${i}.1`, 'errada');
  }
  // Dispositivo novo numa conta com muitas falhas pede CAPTCHA (428) em vez de
  // trancar a dona (429), senao qualquer um de fora a deixaria de fora de casa.
  const captchaAsked = (r: { statusCode: number; body: string }) =>
    r.statusCode === 428 && JSON.parse(r.body).captchaRequired === true;
  const newIp = await loginAs('fay@x.io', '10.8.1.1');
  ok('IP novo sem cookie cai no CAPTCHA', captchaAsked(newIp), newIp.statusCode);
  ok(
    'navegador conhecido entra',
    (await loginAs('fay@x.io', '10.8.1.2', 'senha-123!', device)).statusCode === 200,
  );
  const otherCookie = await loginAs('fay@x.io', '10.8.1.3', 'senha-123!', other);
  ok('cookie de outra conta não vale', captchaAsked(otherCookie), otherCookie.statusCode);
  const forged = await loginAs(
    'fay@x.io',
    '10.8.1.4',
    'senha-123!',
    `dl_device=${ids['fay@x.io']}`,
  );
  ok('cookie forjado não vale', captchaAsked(forged), forged.statusCode);
  const wrong = await loginAs('fay@x.io', '10.8.1.5', 'errada', device);
  ok('navegador conhecido com senha errada: 401', wrong.statusCode === 401, wrong.statusCode);

  // 8. Cota: envios simultaneos nao passam do limite.
  const cHal = await login('hal@x.io');
  const upload = (i: number) => {
    const boundary = `----dl${i}`;
    return app.inject({
      method: 'POST',
      url: '/api/entries/file',
      headers: { cookie: cHal, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r${i}.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        ),
        Buffer.from(`corrida ${i}\n`),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  };
  const codes = (await Promise.all(Array.from({ length: 30 }, (_, i) => upload(i)))).map(
    (r) => r.statusCode,
  );
  const stored = await prisma.entry.count({ where: { ownerId: ids['hal@x.io'] } });
  ok('30 envios simultâneos: 20 gravados', stored === 20, { stored, codes });
  ok(
    'o resto recebe 429',
    codes.filter((c) => c === 201).length === 20 && codes.filter((c) => c === 429).length === 10,
    codes,
  );
  const cGil = await login('gil@x.io');
  await prisma.entry.createMany({
    data: Array.from({ length: 19 }, (_, i) => ({
      type: 'URL' as const,
      title: `u${i}`,
      ownerId: ids['gil@x.io'],
    })),
  });
  const urls = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      req('POST', '/api/entries/url', cGil, { url: `https://e${i}.example/`, title: `r${i}` }),
    ),
  );
  ok(
    'links simultâneos: só a vaga que restava',
    urls.filter((r) => r.statusCode === 201).length === 1 &&
      urls.filter((r) => r.statusCode === 429).length === 5,
    urls.map((r) => r.statusCode),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
