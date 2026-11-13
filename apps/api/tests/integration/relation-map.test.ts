import { buildApp } from '../../src/app';
import { invalidateAllowlist } from '../../src/lib/allowlist';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { GRAPH_LIMITS } from '../../src/routes/graph';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

type Node = { id: string; kind: string; label: string; verdict?: string; code?: string };
type G = {
  center: string;
  nodes: Node[];
  edges: { from: string; to: string; label: string }[];
  hidden: { entries: number; iocs: number; cases: number };
};

async function main() {
  const app = await buildApp();
  await app.ready();
  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
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
  const [cAna, cBob] = await Promise.all(['ana@x.io', 'bob@x.io'].map(login));
  const get = async (url: string, c: string) => {
    const r = await app.inject({ method: 'GET', url, headers: { cookie: c } });
    return { status: r.statusCode, body: r.json() as G };
  };
  const mk = (title: string, data: Record<string, unknown> = {}) =>
    prisma.entry.create({
      data: { type: 'FILE', title, ownerId: ids['bob@x.io'], verdict: 'MALICIOUS', ...data },
    });
  const publish = async (entryId: string, iocs: [string, string][]) => {
    const rep = await prisma.report.create({
      data: { entryId, analystId: ids['ana@x.io'], summary: 's', status: 'PUBLISHED' },
    });
    await prisma.reportIoc.createMany({
      data: iocs.map(([kind, value]) => ({
        reportId: rep.id,
        entryId,
        kind: kind as 'DOMAIN',
        value,
      })),
    });
  };

  const SHA = 'a'.repeat(64);
  const main1 = await mk('fatura.exe', { sha256: SHA });
  const twin = await mk('fatura (2).exe', { sha256: SHA, verdict: 'SUSPICIOUS' });
  const peer = await mk('boleto.js');
  const tagOnly = await mk('so-tag.exe');
  await publish(main1.id, [
    ['DOMAIN', 'evil.top'],
    ['IPV4', '203.0.113.9'],
    ['DOMAIN', 'google.com'],
  ]);
  await publish(peer.id, [['DOMAIN', 'evil.top']]);
  const tag = await prisma.tag.create({ data: { name: 'boleto' } });
  await prisma.entry.update({
    where: { id: main1.id },
    data: { tags: { connect: { id: tag.id } } },
  });
  await prisma.entry.update({
    where: { id: tagOnly.id },
    data: { tags: { connect: { id: tag.id } } },
  });
  await prisma.allowedIndicator.create({
    data: { kind: 'DOMAIN', value: 'google.com', reason: 'legítimo' },
  });
  invalidateAllowlist();
  const cs = await prisma.case.create({
    data: {
      title: 'Campanha do boleto',
      entries: { create: [{ entryId: main1.id }, { entryId: peer.id }] },
    },
  });

  // 1. Mapa da amostra (analista).
  let { status, body: g } = await get(`/api/entries/${main1.id}/graph`, cAna);
  const node = (id: string) => g.nodes.find((n) => n.id === id);
  const edge = (a: string, b: string) =>
    g.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  ok(
    'centro é a amostra',
    status === 200 && g.center === `entry:${main1.id}` && node(g.center)?.verdict === 'MALICIOUS',
    g.center,
  );
  ok(
    'indicadores dos relatórios publicados',
    Boolean(node('ioc:DOMAIN:evil.top')) && Boolean(node('ioc:IPV4:203.0.113.9')),
  );
  ok('lista de permissões fora', !node('ioc:DOMAIN:google.com'));
  ok(
    'mesmo arquivo ligado ao centro',
    edge(g.center, `entry:${twin.id}`)?.label === 'mesmo arquivo' &&
      node(`entry:${twin.id}`)?.verdict === 'SUSPICIOUS',
  );
  ok(
    'indicador em comum passa pelo indicador',
    Boolean(edge(`entry:${peer.id}`, 'ioc:DOMAIN:evil.top')) && !edge(g.center, `entry:${peer.id}`),
    g.edges,
  );
  ok('só tag em comum não entra', !node(`entry:${tagOnly.id}`));
  ok(
    'caso para o analista',
    edge(g.center, `case:${cs.id}`)?.label === 'no caso' &&
      node(`case:${cs.id}`)?.label === 'CASO-0001 · Campanha do boleto',
  );
  ok(
    'nada escondido',
    g.hidden.entries === 0 && g.hidden.iocs === 0 && g.hidden.cases === 0,
    g.hidden,
  );

  // 2. Usuario comum: sem casos.
  ({ body: g } = await get(`/api/entries/${main1.id}/graph`, cBob));
  ok(
    'usuário comum sem casos',
    !g.nodes.some((n) => n.kind === 'CASE') && g.nodes.length >= 4,
    g.nodes.map((n) => n.kind),
  );

  // 3. Limites com "+N".
  const many = Array.from(
    { length: GRAPH_LIMITS.iocs + 3 },
    (_, i) => ['DOMAIN', `d${i}.top`] as [string, string],
  );
  const big = await mk('muitos.exe');
  await publish(big.id, many);
  ({ body: g } = await get(`/api/entries/${big.id}/graph`, cAna));
  ok(
    'limite de indicadores com +N',
    g.nodes.filter((n) => n.kind === 'IOC').length === GRAPH_LIMITS.iocs && g.hidden.iocs === 3,
    g.hidden,
  );

  // 4. Mapa do caso: amostras e indicadores, os compartilhados primeiro.
  ({ status, body: g } = await get(`/api/cases/${cs.id}/graph`, cAna));
  ok('centro é o caso', status === 200 && g.center === `case:${cs.id}`);
  ok(
    'amostras do caso',
    g.edges.filter((e) => e.from === `case:${cs.id}` && e.label === 'no caso').length === 2,
  );
  const evil = g.edges.filter((e) => e.to === 'ioc:DOMAIN:evil.top');
  ok('indicador compartilhado liga as duas', evil.length === 2, evil);
  ok(
    'compartilhado vem primeiro',
    g.nodes.filter((n) => n.kind === 'IOC')[0]?.id === 'ioc:DOMAIN:evil.top',
  );
  ok('permitido fora no caso também', !g.nodes.some((n) => n.id === 'ioc:DOMAIN:google.com'));

  // 5. Permissoes e inexistentes.
  ok(
    'usuário comum sem mapa do caso',
    (await get(`/api/cases/${cs.id}/graph`, cBob)).status === 403,
  );
  ok('amostra inexistente = 404', (await get('/api/entries/naoexiste/graph', cAna)).status === 404);
  await prisma.entry.update({ where: { id: twin.id }, data: { deletedAt: new Date() } });
  ({ body: g } = await get(`/api/entries/${main1.id}/graph`, cAna));
  ok('amostra na lixeira some do mapa', !node(`entry:${twin.id}`));
  ok(
    'amostra na lixeira sem mapa',
    (await get(`/api/entries/${twin.id}/graph`, cAna)).status === 404,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
