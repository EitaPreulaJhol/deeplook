import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { ALLOWED_ROUTES, hashToken, newTokenSecret } from '../../src/lib/api-tokens';
import { hashPassword } from '../../src/lib/crypto';
import { documentedRoutes } from '../../src/lib/openapi';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { openApiRoutes } from '../../src/routes/openapi';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes, openApiRoutes]) await app.register(r);
  await app.ready();
  const u = await prisma.user.create({
    data: {
      email: 'bob@x.io',
      displayName: 'bob',
      role: 'USER',
      apiAccess: true,
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const cookieHdr = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'bob@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const secret = newTokenSecret();
  await prisma.apiToken.create({
    data: {
      userId: u.id,
      name: 'ci',
      prefix: secret.slice(0, 12),
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  // 1. Acesso.
  ok(
    'sem login = 401',
    (await app.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode === 401,
  );
  const byToken = await app.inject({
    method: 'GET',
    url: '/api/openapi.json',
    headers: { authorization: `Bearer ${secret}` },
  });
  ok('com token', byToken.statusCode === 200, byToken.body.slice(0, 200));
  const bySession = await app.inject({
    method: 'GET',
    url: '/api/openapi.json',
    headers: { cookie: cookieHdr },
  });
  ok('com sessão', bySession.statusCode === 200);
  const doc = byToken.json();

  // 2. Conteudo.
  ok(
    'OpenAPI 3.1 com segurança bearer',
    doc.openapi === '3.1.0' &&
      doc.components.securitySchemes.bearer.scheme === 'bearer' &&
      doc.security[0].bearer !== undefined,
  );
  const documented = documentedRoutes(doc).sort();
  const allowed = [...ALLOWED_ROUTES].sort();
  ok(
    'documenta exatamente as rotas com token',
    JSON.stringify(documented) === JSON.stringify(allowed),
    { documented, allowed },
  );
  const list = doc.paths['/api/entries'].get.parameters as {
    name: string;
    schema: { enum?: string[]; default?: unknown; maximum?: number };
  }[];
  const p = (n: string) => list.find((x) => x.name === n);
  ok(
    'filtros da lista vêm do zod',
    p('scope')?.schema.enum?.join() === 'all,mine' &&
      p('verdict')?.schema.enum?.includes('MALICIOUS') === true &&
      p('limit')?.schema.maximum === 100,
    list.slice(0, 3),
  );
  const url = doc.paths['/api/entries/url'].post.requestBody.content['application/json'].schema;
  ok(
    'corpo do link vem do zod',
    url.required?.includes('url') &&
      url.required?.includes('title') &&
      url.properties.url.format === 'uri',
    url,
  );
  const exp = doc.paths['/api/entries/{id}/iocs/export'].get.parameters as {
    name: string;
    required: boolean;
    schema: { enum?: string[] };
  }[];
  ok(
    'formatos da exportação',
    exp.some((x) => x.name === 'format' && x.required && x.schema.enum?.join() === 'csv,stix,misp'),
  );
  ok(
    'arquivo em multipart',
    doc.paths['/api/entries/file'].post.requestBody.content['multipart/form-data'].schema.properties
      .file.format === 'binary',
  );
  // Todo $ref resolve e todo {param} do caminho esta declarado.
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map(
    (m) => m[1],
  );
  ok('referências resolvem', refs.length > 0 && refs.every((r) => doc.components.schemas[r]), refs);
  const missing = Object.entries(
    doc.paths as Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>,
  ).flatMap(([path, ops]) =>
    Object.values(ops).flatMap((op) =>
      [...path.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .filter((n) => !op.parameters?.some((x) => x.in === 'path' && x.name === n))
        .map((n) => `${path}:${n}`),
    ),
  );
  ok('parâmetros do caminho declarados', missing.length === 0, missing);
  ok('sem $schema solto', !JSON.stringify(doc).includes('"$schema"'));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
