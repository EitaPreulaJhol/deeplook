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
