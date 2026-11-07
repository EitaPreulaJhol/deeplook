import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';

import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { invalidateAllowlist } from '../../src/lib/allowlist';
import { hashPassword } from '../../src/lib/crypto';
import { resetFeedCache } from '../../src/lib/indicator-feed';
import { iocsStix, stixIndicatorId, uuidV5 } from '../../src/lib/ioc-export';
import { prisma } from '../../src/lib/prisma';
import { apiTokenRoutes } from '../../src/routes/api-tokens';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { COLLECTION_ID, feedRoutes } from '../../src/routes/feeds';

// Feed de indicadores (item 5.3): TAXII 2.1 e feed MISP, so de amostras maliciosas e suspeitas,
// sem a lista de permitidos e sem os dominios da empresa.
let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const TAXII = 'application/taxii+json;version=2.1';
const ROOT = '/api/taxii2/deeplook';
const OBJECTS = `${ROOT}/collections/${COLLECTION_ID}/objects/`;

interface Envelope {
  more: boolean;
  next?: string;
  objects: { id: string; type: string; pattern?: string; modified?: string }[];
}

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, apiTokenRoutes, entryRoutes, feedRoutes]) await app.register(r);
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
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
  const [cAdm, cAna] = await Promise.all(['adm@x.io', 'ana@x.io'].map(login));
  const token = async (c: string, scope: string) =>
    app.inject({
      method: 'POST',
      url: '/api/me/api-tokens',
      headers: { cookie: c },
      payload: { name: `feed ${scope}`, expiresInDays: 30, scope },
    });
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  // As amostras: so a maliciosa e a suspeita entram; limpa, desconhecida e na lixeira, nao.
  const owner = ids['ana@x.io'];
  const mal = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.exe',
      ownerId: owner,
      verdict: 'MALICIOUS',
      status: 'COMPLETED',
      sha256: 'a'.repeat(64),
    },
  });
  const sus = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'link do e-mail',
      ownerId: owner,
      verdict: 'SUSPICIOUS',
      url: 'http://phish.example.net/login',
      urlDomain: 'phish.example.net',
    },
  });
  const clean = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'limpo',
      ownerId: owner,
      verdict: 'CLEAN',
      sha256: 'b'.repeat(64),
    },
  });
  await prisma.entry.create({
    data: { type: 'FILE', title: 'sem veredito', ownerId: owner, sha256: 'd'.repeat(64) },
  });
  await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'na lixeira',
      ownerId: owner,
      verdict: 'MALICIOUS',
      sha256: 'c'.repeat(64),
      deletedAt: new Date(),
    },
  });
  const report = async (entryId: string, iocs: [string, string][]) => {
    const r = await prisma.report.create({
      data: { entryId, analystId: owner, summary: 'ok', status: 'PUBLISHED' },
    });
    await prisma.reportIoc.createMany({
      data: iocs.map(([kind, value]) => ({
        reportId: r.id,
        entryId,
        kind: kind as 'DOMAIN',
        value,
      })),
    });
  };
  await report(mal.id, [
    ['DOMAIN', 'evil.top'],
    ['IPV4', '203.0.113.9'],
    ['URL', 'http://evil.top/x'],
    ['DOMAIN', 'google.com'],
    ['DOMAIN', 'mail.empresa.com.br'],
    ['EMAIL', 'ceo@empresa.com.br'],
    ['URL', 'https://intranet.empresa.com.br/a'],
  ]);
  // O mesmo dominio numa amostra limpa nao muda o veredito dele.
  await report(clean.id, [
    ['DOMAIN', 'evil.top'],
    ['DOMAIN', 'so-na-limpa.test'],
  ]);
  await prisma.allowedIndicator.create({
    data: { kind: 'DOMAIN', value: 'google.com', reason: 'buscador' },
  });
  invalidateAllowlist();
  await prisma.companyDomain.create({ data: { domain: 'empresa.com.br' } });
  resetFeedCache();

  // 1. Quem acessa.
  ok('analista não cria token do feed', (await token(cAna, 'FEED')).statusCode === 403);
  const made = await token(cAdm, 'FEED');
  const feedSecret = made.json().secret as string;
  ok('admin cria o token do feed', made.statusCode === 201 && made.json().token.scope === 'FEED');
  const samplesSecret = (await token(cAdm, 'SAMPLES')).json().secret as string;
  const bearer = { authorization: `Bearer ${feedSecret}` };
  const basic = {
    authorization: `Basic ${Buffer.from(`qualquer:${feedSecret}`).toString('base64')}`,
  };
  ok('sem credencial: 401', (await get('/api/taxii2/')).statusCode === 401);
  ok(
    'token de amostras não lê o feed',
    (await get('/api/taxii2/', { authorization: `Bearer ${samplesSecret}` })).statusCode === 403,
  );
  ok('token do feed não lê amostras', (await get('/api/entries', bearer)).statusCode === 403);
  ok(
    'Basic com o token como senha só vale no feed',
    (await get('/api/taxii2/', basic)).statusCode === 200 &&
      (await get('/api/entries', basic)).statusCode === 401,
  );
  ok(
    'analista logado não lê o feed',
    (await get('/api/taxii2/', { cookie: cAna })).statusCode === 403,
  );
  ok('admin logado lê o feed', (await get('/api/taxii2/', { cookie: cAdm })).statusCode === 200);
  ok(
    'nunca pede Basic ao navegador (sem WWW-Authenticate)',
    !(await get('/api/taxii2/')).headers['www-authenticate'],
  );

  // 2. TAXII: descoberta, raiz, colecao.
  let r = await get('/api/taxii2/', { ...bearer, host: 'deeplook.test' });
  ok(
    'descoberta aponta a raiz, com o tipo do TAXII 2.1',
    // O texto exato da especificacao, sem aspas na versao nem charset.
    r.headers['content-type'] === TAXII &&
      r.json().default === 'http://deeplook.test/api/taxii2/deeplook/' &&
      r.json().api_roots.length === 1,
    r.json(),
  );
  ok(
    'raiz da API declara a versão',
    (await get(`${ROOT}/`, bearer)).json().versions?.[0] === TAXII,
  );
  r = await get(`${ROOT}/collections/`, bearer);
  ok(
    'uma coleção, só leitura',
    r.json().collections.length === 1 &&
      r.json().collections[0].id === COLLECTION_ID &&
      r.json().collections[0].can_write === false,
    r.json(),
  );
  ok(
    'coleção desconhecida: 404 no formato do TAXII',
    (await get(`${ROOT}/collections/nao-existe/objects/`, bearer)).json().http_status === '404',
  );
  ok(
    'outra versão do TAXII: 406',
    (await get(`${ROOT}/`, { ...bearer, accept: 'application/taxii+json;version=2.0' }))
      .statusCode === 406,
  );

  // 3. O que sai na colecao.
  const all = (await get(OBJECTS, bearer)).json<Envelope>();
  const patterns = all.objects.map((o) => o.pattern ?? o.type);
  const has = (needle: string) => patterns.some((p) => p.includes(needle));
  ok(
    'a identidade DeepLook vai junto',
    all.objects.some((o) => o.type === 'identity'),
  );
  ok(
    'maliciosa e suspeita entram',
    has(`'${'a'.repeat(64)}'`) &&
      has("domain-name:value = 'evil.top'") &&
      has("ipv4-addr:value = '203.0.113.9'") &&
      has("url:value = 'http://evil.top/x'") &&
      has("url:value = 'http://phish.example.net/login'") &&
      has("domain-name:value = 'phish.example.net'"),
    patterns,
  );
  ok(
    'limpa, sem veredito e na lixeira não entram',
    !has('b'.repeat(64)) && !has('c'.repeat(64)) && !has('d'.repeat(64)) && !has('so-na-limpa'),
    patterns,
  );
  ok('a lista de permitidos não sai', !has('google.com'), patterns);
  ok('domínio da empresa não sai: subdomínio, e-mail nem URL', !has('empresa.com.br'), patterns);
  const evil = all.objects.find((o) => o.pattern?.includes("'evil.top'")) as
    (Envelope['objects'][number] & { indicator_types: string[] }) | undefined;
  ok(
    'veredito da maliciosa, mesmo com o domínio também numa limpa',
    evil?.indicator_types[0] === 'malicious-activity',
    evil,
  );
  const fileExport = iocsStix(
    {
      id: mal.id,
      title: mal.title,
      status: mal.status,
      verdict: mal.verdict,
      createdAt: mal.createdAt,
    },
    [{ kind: 'DOMAIN', value: 'evil.top', source: 'REPORT' }],
  ) as { objects: { id: string }[] };
  ok(
    'mesmo id STIX do arquivo .stix.json da ficha',
    evil?.id === fileExport.objects[1].id && evil.id === stixIndicatorId('DOMAIN', 'evil.top'),
  );

  // 4. Paginacao e filtros.
  const total = all.objects.length;
  const seen: string[] = [];
  let next: string | undefined;
  let pages = 0;
  do {
    const p = (
      await get(`${OBJECTS}?limit=2${next ? `&next=${next}` : ''}`, bearer)
    ).json<Envelope>();
    seen.push(...p.objects.map((o) => o.id));
    next = p.more ? p.next : undefined;
    pages++;
  } while (next && pages < 50);
  ok(
    'paginação percorre tudo, sem repetir',
    seen.length === total && new Set(seen).size === total && pages === Math.ceil(total / 2),
    { total, seen: seen.length, pages },
  );
  ok(
    'match[type] filtra',
    (await get(`${OBJECTS}?match[type]=identity`, bearer))
      .json<Envelope>()
      .objects.every((o) => o.type === 'identity'),
  );
  r = await get(`${OBJECTS}`, bearer);
  const last = String(r.headers['x-taxii-date-added-last']);
  ok(
    'cabeçalhos de data do TAXII',
    Boolean(r.headers['x-taxii-date-added-first']) && last !== 'undefined',
  );
  ok(
    'added_after depois de tudo: vazio',
    (await get(`${OBJECTS}?added_after=${encodeURIComponent(last)}`, bearer)).json<Envelope>()
      .objects.length === 0,
  );
  // A amostra limpa vira maliciosa: os indicadores dela aparecem para quem busca "depois de".
  await new Promise((res) => setTimeout(res, 20));
  await prisma.entry.update({ where: { id: clean.id }, data: { verdict: 'MALICIOUS' } });
  resetFeedCache();
  const fresh = (
    await get(`${OBJECTS}?added_after=${encodeURIComponent(last)}`, bearer)
  ).json<Envelope>();
  ok(
    'mudou para maliciosa: aparece no added_after (com o domínio que já existia, nova versão)',
    fresh.objects.some((o) => o.pattern?.includes('so-na-limpa.test')) &&
      fresh.objects.some((o) => o.pattern?.includes("'evil.top'")) &&
      !fresh.objects.some((o) => o.pattern?.includes('phish')),
    fresh.objects.map((o) => o.pattern),
  );
  await prisma.entry.update({ where: { id: clean.id }, data: { verdict: 'CLEAN' } });
  resetFeedCache();
  const objectUrl = `${OBJECTS}${stixIndicatorId('DOMAIN', 'evil.top')}/`;
  ok('objeto pelo id', (await get(objectUrl, bearer)).json<Envelope>().objects.length === 1);
  ok(
    'versões do objeto',
    (await get(`${objectUrl}versions/`, bearer)).json().versions.length === 1,
  );
  ok(
    'objeto fora do feed: 404',
    (await get(`${OBJECTS}${stixIndicatorId('DOMAIN', 'google.com')}/`, bearer)).statusCode === 404,
  );
  const manifest = (await get(`${ROOT}/collections/${COLLECTION_ID}/manifest/`, bearer)).json<{
    objects: { id: string; version: string; media_type: string }[];
  }>();
  ok(
    'manifesto da coleção',
    manifest.objects.length === total &&
      manifest.objects.every((m) => m.media_type === 'application/stix+json;version=2.1'),
  );

  // 5. Feed MISP.
  const mispManifest = (await get('/api/feeds/misp/manifest.json', bearer)).json<
    Record<string, { info: string; timestamp: string }>
  >();
  const malUuid = uuidV5(`entry:${mal.id}`);
  ok(
    'manifesto do MISP: um evento por amostra que entra',
    Object.keys(mispManifest).sort().join() === [malUuid, uuidV5(`entry:${sus.id}`)].sort().join(),
    mispManifest,
  );
  const event = (await get(`/api/feeds/misp/${malUuid}.json`, bearer)).json<{
    Event: {
      Attribute: { type: string; value: string }[];
      Orgc: { name: string };
      published: boolean;
    };
  }>().Event;
  ok(
    'evento com os atributos filtrados, organização e publicado',
    event.Orgc.name === 'DeepLook' &&
      event.published === true &&
      event.Attribute.some((a) => a.type === 'domain' && a.value === 'evil.top') &&
      !event.Attribute.some((a) => /google\.com|empresa\.com\.br/.test(a.value)),
    event.Attribute,
  );
  ok(
    'evento de amostra limpa ou nome qualquer: 404',
    (await get(`/api/feeds/misp/${uuidV5(`entry:${clean.id}`)}.json`, bearer)).statusCode === 404 &&
      (await get('/api/feeds/misp/../../etc/passwd', bearer)).statusCode === 404,
  );

  // 6. Limite do token: o MISP busca um arquivo por evento.
  const burst = await Promise.all(
    Array.from({ length: 150 }, () => get('/api/feeds/misp/manifest.json', bearer)),
  );
  ok(
    'token do feed aguenta 150 pedidos num minuto (o de amostras para em 120)',
    burst.every((b) => b.statusCode === 200),
    burst
      .map((b) => b.statusCode)
      .filter((c) => c !== 200)
      .slice(0, 3),
  );

  // 7. Interoperabilidade: os clientes de referencia buscam o feed numa porta de verdade.
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const py = `
import json, sys, requests
from taxii2client.v21 import Server, as_pages
import stix2
from pymisp import MISPEvent
base = 'http://127.0.0.1:${port}'
secret = sys.argv[1]
server = Server(base + '/api/taxii2/', user='feed', password=secret)
root = server.api_roots[0]
collection = root.collections[0]
objs = []
for envelope in as_pages(collection.get_objects, per_request=2):
    objs.extend(envelope.get('objects', []))
parsed = [stix2.parse(o, allow_custom=False) for o in objs]
headers = {'Authorization': 'Bearer ' + secret}
manifest = requests.get(base + '/api/feeds/misp/manifest.json', headers=headers).json()
attributes = 0
for uuid in manifest:
    ev = MISPEvent()
    ev.load(requests.get(base + '/api/feeds/misp/' + uuid + '.json', headers=headers).json())
    attributes += len(ev.attributes)
print(json.dumps({'collection': collection.title, 'objects': len(parsed), 'events': len(manifest), 'attributes': attributes}))
`;
  // Assincrono de proposito: um spawnSync travaria este processo, que e o proprio servidor que o
  // cliente Python esta consultando.
  const interop = await promisify(execFile)(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'host',
      'python:3.12-slim',
      'sh',
      '-c',
      'pip install -q --disable-pip-version-check taxii2-client stix2 pymisp >/dev/null 2>&1 && python -c "$0" "$1"',
      py,
      feedSecret,
    ],
    { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
  ).catch((err: { stdout?: string; stderr?: string }) => ({
    stdout: err.stdout ?? '',
    stderr: err.stderr ?? String(err),
  }));
  const result = (() => {
    try {
      return JSON.parse(interop.stdout.trim().split('\n').pop() ?? '');
    } catch {
      return null;
    }
  })();
  ok(
    'taxii2-client pagina a coleção e o stix2 valida cada objeto',
    result?.objects === total && result.collection === 'Indicadores do DeepLook',
    result ?? interop.stderr.slice(-1500),
  );
  ok(
    'pymisp carrega cada evento do feed MISP',
    result?.events === 2 && result.attributes > 0,
    result ?? interop.stderr.slice(-1500),
  );

  // 8. O dono do token deixou de ser admin: o token para.
  await prisma.user.update({ where: { id: ids['adm@x.io'] }, data: { role: 'ANALYST' } });
  ok(
    'dono rebaixado: o token do feed para',
    (await get('/api/taxii2/', bearer)).statusCode === 403,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
