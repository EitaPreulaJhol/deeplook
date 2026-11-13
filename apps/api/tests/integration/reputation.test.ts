import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { ENRICHMENT_ENDPOINTS, resetRdapBootstrap } from '../../src/lib/link-enrichment';
import { prisma } from '../../src/lib/prisma';
import {
  checkReputation,
  enabledServices,
  ENDPOINTS,
  MIN_INTERVAL_MS,
  resetReputationQueues,
  servicesFor,
} from '../../src/lib/reputation';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const DAY = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/**
 * Reputacao externa e enriquecimento de links (revisao de novembro, 3.3) contra um servidor
 * local que faz o papel do VirusTotal, da lista da IANA, dos servidores RDAP e do crt.sh. Anota
 * cada caminho pedido: o teste confere tambem o que saiu do DeepLook.
 */
async function main() {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    seen.push(`${url.pathname}${url.search}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const p = url.pathname;
    if (p === '/iana/dns.json') {
      return json(200, {
        services: [
          [['top'], [`${base}/rdap-top/`]],
          [['com.br', 'br'], [`${base}/rdap-br`]],
        ],
      });
    }
    if (p === '/iana/ipv4.json')
      return json(200, { services: [[['203.0.113.0/24'], [`${base}/rdap-ip/`]]] });
    if (p === '/iana/ipv6.json') return json(200, { services: [] });
    if (p === '/rdap-top/domain/novo.top') {
      return json(200, {
        events: [
          { eventAction: 'registration', eventDate: isoDaysAgo(3.5) },
          { eventAction: 'expiration', eventDate: isoDaysAgo(-362) },
        ],
        entities: [
          {
            roles: ['registrar'],
            vcardArray: ['vcard', [['fn', {}, 'text', 'Registrador Barato Ltd']]],
          },
        ],
      });
    }
    if (p === '/rdap-br/domain/banco.com.br') {
      return json(200, {
        events: [{ eventAction: 'registration', eventDate: '2001-05-10T00:00:00Z' }],
      });
    }
    if (p.startsWith('/rdap-top/domain/')) return json(404, {});
    if (p === '/rdap-ip/ip/203.0.113.9') {
      return json(200, {
        name: 'EXEMPLO-NET',
        startAddress: '203.0.113.0',
        endAddress: '203.0.113.255',
        country: 'BR',
      });
    }
    if (p === '/crt/') {
      const q = url.searchParams.get('q');
      if (q === 'login.novo.top') {
        return json(200, [
          { not_before: isoDaysAgo(2), issuer_name: "C=US, O=Let's Encrypt, CN=R11" },
          { not_before: isoDaysAgo(1), issuer_name: "C=US, O=Let's Encrypt, CN=R10" },
        ]);
      }
      if (q === 'www.banco.com.br') {
        return json(200, [
          { not_before: '2019-01-01T00:00:00', issuer_name: 'C=US, O=DigiCert Inc, CN=x' },
        ]);
      }
      return json(200, []);
    }
    if (p.startsWith('/vt/domains/') && p.endsWith('/resolutions')) {
      return json(200, {
        data: [
          { attributes: { ip_address: '203.0.113.9', date: Math.floor(Date.now() / 1000) - 3600 } },
          {
            attributes: {
              ip_address: '198.51.100.7',
              date: Math.floor(Date.now() / 1000) - 86400 * 40,
            },
          },
        ],
      });
    }
    if (p.startsWith('/vt/domains/')) {
      return json(200, {
        data: { attributes: { last_analysis_stats: { malicious: 0, harmless: 70 } } },
      });
    }
    if (p.startsWith('/vt/ip_addresses/') && p.endsWith('/resolutions')) {
      return json(200, {
        data: [{ attributes: { host_name: 'novo.top', date: Math.floor(Date.now() / 1000) } }],
      });
    }
    if (p.startsWith('/vt/ip_addresses/')) {
      return json(200, {
        data: { attributes: { last_analysis_stats: { malicious: 0, harmless: 70 } } },
      });
    }
    if (p.startsWith('/rdap-down/')) return json(503, {});
    json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ENDPOINTS.virustotal = `${base}/vt`;
  Object.assign(ENRICHMENT_ENDPOINTS, {
    ianaDns: `${base}/iana/dns.json`,
    ianaIpv4: `${base}/iana/ipv4.json`,
    ianaIpv6: `${base}/iana/ipv6.json`,
    crtsh: `${base}/crt/`,
    virustotal: `${base}/vt`,
  });
  for (const key of Object.keys(MIN_INTERVAL_MS))
    MIN_INTERVAL_MS[key as keyof typeof MIN_INTERVAL_MS] = 0;

  const owner = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', passwordHash: await hashPassword('senha-123!') },
  });
  const link = (title: string, url: string, urlDomain: string) =>
    prisma.entry.create({ data: { type: 'URL', title, url, urlDomain, ownerId: owner.id } });
  const results = async (entryId: string) =>
    Object.fromEntries(
      (await prisma.reputationResult.findMany({ where: { entryId } })).map((r) => [r.service, r]),
    );

  // ---- 1. Sem opcao explicita, RDAP e crt.sh nao ligam; o DNS passivo vem com a chave do VT.
  env.VT_API_KEY = 'chave-de-teste';
  ok(
    'sem opção: RDAP e crt.sh desligados, DNS passivo com a chave do VirusTotal',
    !enabledServices().includes('rdap') &&
      !enabledServices().includes('crtsh') &&
      enabledServices().includes('vtdns'),
    enabledServices(),
  );
  const quiet = await link(
    'quieto',
    'http://login.novo.top/x?email=vitima@empresa.com',
    'login.novo.top',
  );
  await checkReputation(quiet.id);
  ok(
    'desligados: nada foi pedido à IANA nem ao crt.sh',
    !seen.some((s) => s.startsWith('/iana') || s.startsWith('/crt')),
    seen,
  );
  env.PASSIVE_DNS_ENABLED = 'false';
  ok('PASSIVE_DNS_ENABLED=false desliga o DNS passivo', !enabledServices().includes('vtdns'));
  env.PASSIVE_DNS_ENABLED = 'true';

  // ---- 2. Ligados: dominio novo, certificado de ontem e resolucoes.
  env.RDAP_ENABLED = 'true';
  env.CT_ENABLED = 'true';
  ok(
    'domínio: os três entram',
    ['rdap', 'crtsh', 'vtdns'].every((s) => servicesFor('DOMAIN').includes(s as never)),
  );
  ok(
    'IP: RDAP e DNS passivo, sem crt.sh',
    servicesFor('IP').includes('rdap') && !servicesFor('IP').includes('crtsh'),
  );
  seen.length = 0;
  const fresh = await link(
    'novo',
    'http://login.novo.top/x?email=vitima@empresa.com',
    'login.novo.top',
  );
  await checkReputation(fresh.id);
  const r = await results(fresh.id);
  ok(
    'RDAP: registro do domínio-base, há 3 dias, é suspeito',
    r.rdap?.status === 'FOUND' &&
      r.rdap.verdict === 'SUSPICIOUS' &&
      r.rdap.summary.startsWith('domínio novo: novo.top registrado em') &&
      r.rdap.summary.includes('há 3 dias') &&
      r.rdap.summary.includes('Registrador Barato Ltd'),
    r.rdap,
  );
  ok(
    'RDAP: pergunta pelo domínio registrável, não pelo host',
    seen.includes('/rdap-top/domain/novo.top'),
    seen,
  );
  ok(
    'crt.sh: dois certificados, o primeiro há 2 dias, é suspeito',
    r.crtsh?.verdict === 'SUSPICIOUS' &&
      r.crtsh.summary.includes('2 certificados') &&
      r.crtsh.summary.includes("Let's Encrypt") &&
      r.crtsh.link === 'https://crt.sh/?q=login.novo.top',
    r.crtsh,
  );
  ok(
    'DNS passivo: os IPs para onde apontou, informativo',
    r.vtdns?.status === 'FOUND' &&
      r.vtdns.verdict === 'UNKNOWN' &&
      r.vtdns.summary.includes('203.0.113.9') &&
      r.vtdns.summary.includes('198.51.100.7'),
    r.vtdns,
  );
  ok(
    'só o host sai: nem o caminho nem a query (com o e-mail da vítima) chegam a nenhum serviço',
    seen.length > 0 && !seen.some((s) => s.includes('vitima') || s.includes('/x?')),
    seen,
  );

  // ---- 3. Dominio antigo: nada de suspeito.
  const old = await link('banco', 'https://www.banco.com.br/', 'www.banco.com.br');
  await checkReputation(old.id);
  const o = await results(old.id);
  ok(
    'RDAP: domínio de 2001 é informativo',
    o.rdap?.verdict === 'UNKNOWN' &&
      o.rdap.summary.startsWith('banco.com.br registrado em 2001-05-10'),
    o.rdap,
  );
  ok(
    'RDAP: o sufixo mais longo da IANA vence (com.br)',
    seen.includes('/rdap-br/domain/banco.com.br'),
    seen,
  );
  ok(
    'crt.sh: certificado antigo é informativo',
    o.crtsh?.verdict === 'UNKNOWN' && o.crtsh.summary.startsWith('1 certificado'),
    o.crtsh,
  );

  // ---- 4. Nao registrado, sem certificado, TLD sem RDAP.
  const gone = await link('sumiu', 'http://outro.top/', 'outro.top');
  await checkReputation(gone.id);
  const g = await results(gone.id);
  ok(
    'RDAP 404: não registrado',
    g.rdap?.status === 'NOT_FOUND' && g.rdap.summary === 'não registrado',
    g.rdap,
  );
  ok('crt.sh vazio: nenhum certificado', g.crtsh?.status === 'NOT_FOUND', g.crtsh);
  const noRdap = await link('sem rdap', 'http://exemplo.xyz/', 'exemplo.xyz');
  await checkReputation(noRdap.id);
  ok(
    'TLD fora da lista da IANA: diz que não publica RDAP',
    (await results(noRdap.id)).rdap?.summary === 'o registro deste domínio não publica RDAP',
  );

  // ---- 5. IP: faixa pelo RDAP e dominios pelo DNS passivo.
  const ip = await link('ip', 'http://203.0.113.9/a', '203.0.113.9');
  await checkReputation(ip.id);
  const i = await results(ip.id);
  ok(
    'RDAP de IP: a faixa e o país',
    i.rdap?.summary === 'EXEMPLO-NET · 203.0.113.0 – 203.0.113.255 · BR',
    i.rdap,
  );
  ok(
    'DNS passivo de IP: os domínios que apontaram',
    i.vtdns?.summary.startsWith('domínios que apontaram para este IP: novo.top'),
    i.vtdns,
  );
  ok('IP não vai para o crt.sh', !i.crtsh);

  // ---- 6. Cache de 24 h por indicador, e falha do servico vira ERROR legivel.
  seen.length = 0;
  const again = await link('de novo', 'http://login.novo.top/y', 'login.novo.top');
  await checkReputation(again.id);
  ok(
    'mesmo indicador em menos de 24 h: reaproveita, sem nova consulta',
    seen.length === 0 && (await results(again.id)).rdap?.verdict === 'SUSPICIOUS',
    seen,
  );
  ENRICHMENT_ENDPOINTS.crtsh = `${base}/rdap-down/`;
  await checkReputation(again.id, true);
  const down = (await results(again.id)).crtsh;
  ok(
    'serviço fora (503): falha com o motivo, as outras seguem',
    down?.status === 'ERROR' &&
      down.summary.includes('HTTP 503') &&
      (await results(again.id)).rdap?.status === 'FOUND',
    down,
  );

  // ---- 7. Lista da IANA guardada: nao e baixada a cada consulta.
  const before = seen.filter((s) => s.startsWith('/iana')).length;
  await checkReputation(old.id, true);
  ok(
    'lista da IANA guardada por 24 h',
    seen.filter((s) => s.startsWith('/iana')).length === before,
  );
  resetRdapBootstrap();
  resetReputationQueues();

  server.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
