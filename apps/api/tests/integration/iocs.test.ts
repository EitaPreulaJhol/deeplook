import { Writable } from 'node:stream';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { urlKey } from '../../src/lib/ioc-normalize';
import { reindexIocs } from '../../src/lib/ioc-reindex';
import { extractIocs, syncReportIocs } from '../../src/lib/iocs';
import { prisma } from '../../src/lib/prisma';
import { requestLogSerializer } from '../../src/lib/request-log';
import { ensureBucket } from '../../src/lib/s3';
import { authRoutes } from '../../src/routes/auth';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import { entryRoutes, URL_MAX } from '../../src/routes/entries';
import { iocRoutes } from '../../src/routes/iocs';

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
  for (const r of [authRoutes, entryRoutes, iocRoutes]) await app.register(r);
  await app.ready();

  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
  ] as const) {
    await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
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
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  // 1. Lista de permitidos na ficha do indicador (item 163): so analistas, como a lista.
  await prisma.allowedIndicator.create({
    data: { kind: 'DOMAIN', value: 'fornecedor.com.br', reason: 'contrato 2026 com o jurídico' },
  });
  const page = async (c: string) =>
    (await req('GET', '/api/iocs/domain/fornecedor.com.br', c)).json();
  const forAna = await page(cAna);
  ok(
    'analista vê o motivo da permissão',
    forAna.allowed?.reason === 'contrato 2026 com o jurídico',
    forAna,
  );
  const forBob = await page(cBob);
  ok('usuário comum não vê a lista de permitidos', forBob.allowed === null, forBob);

  // 2. Envio de link (item 163): so http/https, com tamanho limitado.
  const send = (url: string) => req('POST', '/api/entries/url', cBob, { url, title: 'link' });
  for (const bad of ['javascript:alert(1)', 'ftp://arquivos.exemplo/x', 'data:text/html,oi']) {
    const res = await send(bad);
    ok(`recusa ${bad.split(':')[0]}:`, res.statusCode === 400 && Boolean(res.json().details?.url));
  }
  const long = await send(`https://exemplo.com/${'a'.repeat(URL_MAX)}`);
  ok('recusa link acima do limite', long.statusCode === 400, long.statusCode);
  ok('aceita https', (await send('https://exemplo.com/login?u=1')).statusCode === 201);

  // 3. Log sem a query string (item 163).
  const lines: string[] = [];
  const logged = Fastify({
    logger: {
      level: 'info',
      serializers: { req: requestLogSerializer },
      stream: new Writable({
        write(chunk, _enc, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    },
  });
  logged.get('/api/search', async () => ({ ok: true }));
  await logged.inject({ method: 'GET', url: '/api/search?q=token-da-vitima' });
  await logged.close();
  const all = lines.join('');
  ok(
    'log da API sem a query string',
    all.includes('"url":"/api/search"') && !all.includes('token-da-vitima'),
    all,
  );

  // 4. Extracao de URL e IPv6 (item 165).
  const pairs = (text: string) => extractIocs(text).map((i) => `${i.kind} ${i.value}`);
  const phish = pairs(
    'hxxps://evil[.]top/Login.php?user=vitima@empresa.com&next=empresa.com.br#vitima@empresa.com).',
  );
  ok(
    'URL normalizada, com o caminho como veio e sem o fragmento',
    phish.includes('URL https://evil.top/Login.php?user=vitima@empresa.com&next=empresa.com.br'),
    phish,
  );
  ok(
    'e-mail e domínio da query não viram indicador',
    !phish.some((p) => p.startsWith('EMAIL') || p === 'DOMAIN empresa.com.br'),
    phish,
  );
  ok('o host do link continua', phish.includes('DOMAIN evil.top'), phish);
  ok(
    'host vem antes da URL (o "Ir para:" pega o primeiro)',
    extractIocs('https://evil.top/a')[0]?.kind === 'DOMAIN',
  );
  const v6 = pairs(
    '2606:4700:0:0:0:0:0:1111, [2001:4860:4860::8888], fe80::1%eth0, fd00::5, add::, 12:30:45, ' +
      '00:1a:2b:3c:4d:5e, ::ffff:8.8.4.4, http://[2a00:1450:4001::200e]/x',
  );
  ok(
    'IPv6 canônico, sem rede interna nem palavras',
    v6.includes('IPV6 2606:4700::1111') &&
      v6.includes('IPV6 2001:4860:4860::8888') &&
      v6.includes('IPV6 2a00:1450:4001::200e') &&
      v6.includes('IPV4 8.8.4.4') &&
      !v6.some((p) => /fe80|fd00|add::|12:30|1a:2b/.test(p)),
    v6,
  );
  ok(
    'link para rede interna ou domínio ignorado não entra',
    !pairs('http://10.0.0.1/a https://update.microsoft.com/b').some((p) => p.startsWith('URL')),
  );
  ok('javascript: não é link', !pairs('javascript:alert(1)').length);

  // 5. Relatorio publicado: URL e IPv6 no indice, URL guardada pela chave.
  const ana = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@x.io' } });
  const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@x.io' } });
  const sample = await prisma.entry.create({
    data: { type: 'FILE', title: 'dropper.exe', ownerId: bob.id },
  });
  const report = await prisma.report.create({
    data: {
      entryId: sample.id,
      analystId: ana.id,
      summary: 's',
      status: 'PUBLISHED',
      iocs: 'hxxp://c2[.]top/gate.php?id=AbC#x\n2606:4700:4700::1111',
    },
  });
  await syncReportIocs(prisma, report.id, { notify: false });
  const rows = await prisma.reportIoc.findMany({ where: { reportId: report.id } });
  const C2 = 'http://c2.top/gate.php?id=AbC';
  ok(
    'relatório indexa URL e IPv6',
    rows.some((r) => r.kind === 'URL' && r.value === C2) &&
      rows.some((r) => r.kind === 'IPV6' && r.value === '2606:4700:4700::1111'),
    rows,
  );
  ok(
    'URL guardada pela chave',
    (await prisma.iocUrl.findUnique({ where: { key: urlKey(C2) } }))?.value === C2,
  );
  const v6page = (await req('GET', '/api/iocs/ipv6/2606:4700:4700::1111', cAna)).json();
  ok('ficha do IPv6 com o relatório', v6page.items?.[0]?.entry.id === sample.id, v6page);

  // 6. Amostra de link: chave, indicadores proprios e aviso de quem segue a URL.
  const LINK = 'https://evil.top/Login.php?token=SEGREDO';
  await prisma.iocWatch.create({ data: { userId: bob.id, kind: 'URL', value: LINK } });
  let res = await req('POST', '/api/entries/url', cAna, { url: `${LINK}#vitima`, title: 'phish' });
  const link = await prisma.entry.findUniqueOrThrow({ where: { id: res.json().entry.id } });
  ok('link com a chave da URL normalizada', link.urlKey === urlKey(LINK), link.urlKey);
  const seen = await prisma.notification.findFirst({ where: { userId: bob.id, type: 'IOC_SEEN' } });
  ok(
    'quem segue a URL é avisado, sem o caminho no aviso',
    seen?.detail === 'URL https://evil.top/… numa amostra nova',
    seen?.detail,
  );
  const exported = (await req('GET', `/api/entries/${link.id}/iocs`, cAna)).json();
  ok(
    'indicadores da amostra: a URL normalizada e o domínio',
    exported.iocs?.some(
      (i: { kind: string; value: string }) => i.kind === 'URL' && i.value === LINK,
    ) && exported.iocs?.some((i: { kind: string; value: string }) => i.kind === 'DOMAIN'),
    exported,
  );
  res = await req('POST', '/api/entries/url', cAna, {
    url: 'http://[2a00:1450:4001::200e]:8080/p',
    title: 'ipv6',
  });
  const v6link = res.json().entry;
  const own6 = (await req('GET', `/api/entries/${v6link.id}/iocs`, cAna)).json();
  ok(
    'host IPv6 do link vira IPv6, não domínio',
    own6.iocs?.some(
      (i: { kind: string; value: string }) =>
        i.kind === 'IPV6' && i.value === '2a00:1450:4001::200e',
    ),
    own6,
  );
  const hosted = (await req('GET', '/api/iocs/ipv6/2a00:1450:4001::200e', cAna)).json();
  ok(
    'ficha do IPv6 acha o link hospedado nele',
    hosted.items?.some((i: { entry: { id: string } }) => i.entry.id === v6link.id),
    hosted,
  );

  // 7. Reindexacao das bases antigas: uma vez, sem avisar quem segue.
  const old = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'antigo',
      ownerId: bob.id,
      url: 'https://old.top/x#y',
      urlDomain: 'old.top',
    },
  });
  await prisma.reportIoc.deleteMany({ where: { reportId: report.id } });
  const before = await prisma.notification.count();
  const quiet = { info: () => {}, error: (o: object) => console.log(o) };
  await reindexIocs(quiet);
  ok(
    'reindexa link e relatório antigos',
    (await prisma.entry.findUniqueOrThrow({ where: { id: old.id } })).urlKey ===
      urlKey('https://old.top/x') &&
      (await prisma.reportIoc.count({ where: { reportId: report.id } })) === rows.length,
  );
  ok('reindexar não avisa ninguém', (await prisma.notification.count()) === before);
  await prisma.reportIoc.deleteMany({ where: { reportId: report.id } });
  await reindexIocs(quiet);
  ok('roda uma vez só', (await prisma.reportIoc.count({ where: { reportId: report.id } })) === 0);

  // 8. Sugestoes da analise: no maximo 15 de cada tipo.
  const lots = [
    ...Array.from({ length: 40 }, (_, i) => `http://d${i}.top/a`),
    ...Array.from({ length: 40 }, (_, i) => `8.8.${i}.1`),
  ].join('\n');
  const kinds = analyzeBuffer(Buffer.from(lots), 'x.txt').iocCandidates.map((i) => i.kind);
  ok(
    'sugestões limitadas por tipo',
    kinds.filter((k) => k === 'IPV4').length === 15 &&
      kinds.filter((k) => k === 'URL').length === 15,
    kinds,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
