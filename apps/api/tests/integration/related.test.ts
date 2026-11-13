import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { relatedRoutes } from '../../src/routes/related';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, relatedRoutes]) await app.register(r);
  await app.ready();
  const u = await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const c = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const mk = (title: string, data: Record<string, unknown> = {}) =>
    prisma.entry.create({ data: { type: 'FILE', title, ownerId: u.id, ...data } });
  const tag = await prisma.tag.create({ data: { name: 'boleto' } });
  const T = '0'.repeat(70);
  const a = await mk('a', { sha256: 'f'.repeat(64), tags: { connect: { id: tag.id } }, tlsh: T });
  const sameFile = await mk('mesmo', { sha256: 'f'.repeat(64) });
  const sameTag = await mk('tag', { tags: { connect: { id: tag.id } } });
  const url1 = await mk('url1', {
    type: 'URL',
    url: 'http://login.evil.top/x',
    urlDomain: 'login.evil.top',
  });
  const url2 = await mk('url2', {
    type: 'URL',
    url: 'http://login.evil.top/y',
    urlDomain: 'login.evil.top',
  });
  const url3 = await mk('url3', {
    type: 'URL',
    url: 'http://cdn.evil.top/y',
    urlDomain: 'cdn.evil.top',
  });
  const iocPeer = await mk('ioc');
  const rep = await prisma.report.create({
    data: { entryId: a.id, analystId: u.id, summary: 's', status: 'PUBLISHED' },
  });
  await prisma.reportIoc.create({
    data: { reportId: rep.id, entryId: a.id, kind: 'DOMAIN', value: 'evil.top' },
  });
  const rep2 = await prisma.report.create({
    data: { entryId: iocPeer.id, analystId: u.id, summary: 's', status: 'PUBLISHED' },
  });
  await prisma.reportIoc.create({
    data: { reportId: rep2.id, entryId: iocPeer.id, kind: 'DOMAIN', value: 'evil.top' },
  });
  const similar = await mk('parecido', { tlsh: '0'.repeat(68) + '11' });
  const get = async (id: string) =>
    (
      await app.inject({ method: 'GET', url: `/api/entries/${id}/related`, headers: { cookie: c } })
    ).json();
  const r = await get(a.id);
  const kinds = (id: string) =>
    r.items
      .find((i: { entry: { id: string } }) => i.entry.id === id)
      ?.reasons.map((x: { kind: string }) => x.kind) ?? [];
  ok('mesmo arquivo', kinds(sameFile.id).includes('SAME_SHA256'));
  ok('tag em comum', kinds(sameTag.id).includes('SHARED_TAGS'));
  ok('IOC em comum', kinds(iocPeer.id).includes('SHARED_IOCS'));
  ok(
    'parecido',
    kinds(similar.id).includes('SIMILAR'),
    r.items.map((i: { entry: { title: string }; reasons: unknown }) => [i.entry.title, i.reasons]),
  );
  ok('mesmo arquivo primeiro', r.items[0].entry.id === sameFile.id);
  const u1 = await get(url1.id);
  const k1 = (id: string) =>
    u1.items
      .find((i: { entry: { id: string } }) => i.entry.id === id)
      ?.reasons.map((x: { kind: string }) => x.kind) ?? [];
  ok('mesmo host', k1(url2.id).includes('SAME_HOST'));
  ok('mesmo domínio-base', k1(url3.id).includes('SAME_BASE_DOMAIN'));
  ok('total e limite', typeof u1.total === 'number' && u1.limit === 50);
  // Paginas com a mesma aparencia (revisao 3.4): hash perceptual do print da captura.
  const H = 'a5'.repeat(32);
  const flip = (hex: string, bits: number) => {
    const bytes = Buffer.from(hex, 'hex');
    for (let i = 0; i < bits; i++) bytes[i >> 3] ^= 1 << (i & 7);
    return bytes.toString('hex');
  };
  const page = (title: string, domain: string) =>
    mk(title, { type: 'URL', url: `http://${domain}/login`, urlDomain: domain });
  const capture = (entryId: string, screenshotHash: string | null, status = 'DONE') =>
    prisma.pageCapture.create({
      data: { entryId, url: 'http://x', status: status as 'DONE', screenshotHash },
    });
  const kit = await page('kit', 'banco-a.example');
  const twin = await page('gêmea', 'outro-host.example');
  const near = await page('quase', 'terceiro.example');
  const far = await page('diferente', 'quarto.example');
  const failed = await page('captura que falhou', 'quinto.example');
  const blank = await page('sem hash', 'sexto.example');
  await capture(kit.id, flip(H, 200));
  await capture(kit.id, H); // a mais recente e a que vale
  await capture(twin.id, H);
  await capture(near.id, flip(H, 20)); // 20 de 256 bits: 92%
  await capture(near.id, flip(H, 100)); // outra captura, bem diferente: vale a mais parecida
  await capture(far.id, flip(H, 60)); // 77%: abaixo do minimo
  await capture(failed.id, H, 'FAILED');
  await capture(blank.id, null);
  const pages = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${kit.id}/related`,
      headers: { cookie: c },
    })
  ).json().items as { entry: { id: string }; reasons: { kind: string; detail: number }[] }[];
  const pageMatch = (id: string) =>
    pages.find((p) => p.entry.id === id)?.reasons.find((r) => r.kind === 'SIMILAR_PAGE')?.detail;
  ok('página idêntica em outro domínio: 100%', pageMatch(twin.id) === 100, pages);
  ok(
    'página quase igual: vale a captura mais parecida',
    pageMatch(near.id) === 92,
    pageMatch(near.id),
  );
  ok('página diferente fica de fora', pageMatch(far.id) === undefined);
  ok(
    'captura que falhou e captura sem hash não ligam',
    pageMatch(failed.id) === undefined && pageMatch(blank.id) === undefined,
  );
  ok(
    'a mais parecida vem primeiro',
    pages[0]?.entry.id === twin.id,
    pages.map((p) => p.entry.id),
  );
  const none = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${blank.id}/related`,
      headers: { cookie: c },
    })
  ).json().items as { reasons: { kind: string }[] }[];
  ok(
    'amostra sem hash não ganha páginas parecidas',
    !none.some((p) => p.reasons.some((r) => r.kind === 'SIMILAR_PAGE')),
  );

  ok(
    '404',
    (await app.inject({ method: 'GET', url: '/api/entries/nada/related', headers: { cookie: c } }))
      .statusCode === 404,
  );
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
