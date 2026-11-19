import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import {
  checkReputation,
  enabledServices,
  ENDPOINTS,
  MIN_INTERVAL_MS,
  servicesFor,
} from '../../src/lib/reputation';
import { riskOf } from '../../src/lib/risk-score';

// Reputacao por hash e por IP (plans/analise-estatica-ampliada, item 5): o hashlookup da CIRCL, o
// YARAify da abuse.ch e o InternetDB da Shodan contra um servidor local com as respostas no formato
// real (conferido ao vivo em 19/11/2026 para o hashlookup e o InternetDB).

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const KNOWN = 'a'.repeat(64);
const BAD = 'b'.repeat(64);

async function main() {
  const seen: { path: string; body: string; key: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = new URL(req.url ?? '/', 'http://local').pathname;
      seen.push({ path: p, body, key: req.headers['auth-key'] as string | undefined });
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (p === `/hl/lookup/sha256/${KNOWN}`) {
        return json(200, {
          FileName: './Windows/System32/kernel32.dll',
          ProductCode: { ProductName: 'Windows 10' },
          source: 'NSRL',
          'hashlookup:trust': 70,
        });
      }
      if (p.startsWith('/hl/')) return json(404, { message: 'Non existing SHA-256' });
      if (p === '/yf/') {
        const q = JSON.parse(body || '{}');
        if (q.search_term !== BAD) return json(200, { query_status: 'hash_not_found' });
        return json(200, {
          query_status: 'ok',
          data: {
            tasks: [
              {
                clamav_results: ['Win.Trojan.Agent-1'],
                static_results: [{ rule_name: 'AgentTesla_Strings' }, { rule_name: 'xxx' }],
                unpack_results: [{ unpacked_yara_matches: [{ rule_name: 'AgentTesla_Unpacked' }] }],
              },
            ],
          },
        });
      }
      if (p === '/idb/203.0.113.9') {
        return json(200, {
          ip: '203.0.113.9',
          ports: [22, 443],
          cpes: [],
          hostnames: [],
          tags: ['c2'],
          vulns: ['CVE-2023-1'],
        });
      }
      if (p.startsWith('/idb/')) return json(404, { detail: 'No information available' });
      // VirusTotal com os rotulos dos antivirus (familia por consenso, item 6).
      if (p === `/vt/files/${BAD}`) {
        const r = (result: string) => ({ category: 'malicious', result });
        return json(200, {
          data: {
            attributes: {
              md5: 'd41d8cd98f00b204e9800998ecf8427e',
              last_analysis_stats: { malicious: 6, undetected: 60 },
              last_analysis_results: {
                Kaspersky: r('HEUR:Trojan-PSW.MSIL.Agensla.gen'),
                'ESET-NOD32': r('a variant of MSIL/Spy.AgentTesla.F'),
                Microsoft: r('Trojan:MSIL/AgentTesla.JQK!MTB'),
                Fortinet: r('MSIL/AgentTesla.FFW!tr'),
                Ikarus: r('Trojan-Spy.AgentTesla'),
                Symantec: r('Trojan.Gen.MBT'),
                ClamAV: { category: 'undetected', result: null },
              },
            },
          },
        });
      }
      if (p.startsWith('/vt/files/')) return json(404, {});
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(ENDPOINTS, {
    hashlookup: `${base}/hl`,
    yaraify: `${base}/yf/`,
    internetdb: `${base}/idb`,
    virustotal: `${base}/vt`,
  });
  for (const key of Object.keys(MIN_INTERVAL_MS))
    MIN_INTERVAL_MS[key as keyof typeof MIN_INTERVAL_MS] = 0;

  ok(
    'sem opção nem chave: os três desligados',
    !['hashlookup', 'yaraify', 'internetdb'].some((s) => enabledServices().includes(s as never)),
    enabledServices(),
  );
  env.HASHLOOKUP_ENABLED = 'true';
  env.INTERNETDB_ENABLED = 'true';
  env.ABUSECH_AUTH_KEY = 'chave-abusech';
  env.VT_API_KEY = '';
  ok(
    'ligados: hashlookup e YARAify para hash, InternetDB para IP',
    servicesFor('HASH').includes('hashlookup') &&
      servicesFor('HASH').includes('yaraify') &&
      servicesFor('IP').includes('internetdb') &&
      !servicesFor('DOMAIN').includes('internetdb'),
  );

  const owner = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', passwordHash: await hashPassword('senha-123!') },
  });
  const file = (title: string, sha256: string) =>
    prisma.entry.create({ data: { type: 'FILE', title, sha256, ownerId: owner.id } });
  const results = async (entryId: string) =>
    Object.fromEntries(
      (await prisma.reputationResult.findMany({ where: { entryId } })).map((r) => [r.service, r]),
    );

  const known = await file('kernel32.dll', KNOWN);
  await checkReputation(known.id);
  const k = await results(known.id);
  ok(
    'hashlookup: arquivo conhecido do NSRL, limpo, com o produto e a confiança',
    k.hashlookup?.status === 'FOUND' &&
      k.hashlookup.verdict === 'CLEAN' &&
      k.hashlookup.summary ===
        'arquivo conhecido (NSRL) · Windows 10 · kernel32.dll · confiança 70',
    k.hashlookup,
  );
  ok(
    'YARAify: hash desconhecido não é achado; só o hash saiu, com a chave da abuse.ch',
    k.yaraify?.status === 'NOT_FOUND' &&
      seen.some((s) => s.path === '/yf/' && s.key === 'chave-abusech' && s.body.includes(KNOWN)),
    k.yaraify,
  );
  const risk = await riskOf(known.id);
  ok(
    'risco: arquivo conhecido é atenuante (reputação limpa)',
    risk?.reasons.some((r) => r.weight === -10),
    risk?.reasons,
  );

  env.VT_API_KEY = 'chave-vt';
  const bad = await file('fatura.exe', BAD);
  await checkReputation(bad.id);
  const b = await results(bad.id);
  ok(
    'YARAify: regras públicas (sem as privadas "xxx") e o ClamAV',
    b.yaraify?.verdict === 'MALICIOUS' &&
      b.yaraify.summary ===
        '2 regra(s) YARA · AgentTesla_Strings, AgentTesla_Unpacked · ClamAV: Win.Trojan.Agent-1',
    b.yaraify,
  );
  ok('hashlookup: hash fora da base é "não encontrado"', b.hashlookup?.status === 'NOT_FOUND');
  ok(
    'VirusTotal: família por consenso dos antivírus (AVclass)',
    b.virustotal?.summary === '6/66 motores detectaram · família agenttesla (5 antivírus)' &&
      (b.virustotal.details as { avclass?: { family?: string } }).avclass?.family === 'agenttesla',
    b.virustotal,
  );
  env.VT_API_KEY = '';

  const ip = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'ip',
      url: 'http://203.0.113.9/x',
      urlDomain: '203.0.113.9',
      ownerId: owner.id,
    },
  });
  await checkReputation(ip.id);
  const i = await results(ip.id);
  ok(
    'InternetDB: portas, tag de C2 (suspeito) e CVEs',
    i.internetdb?.verdict === 'SUSPICIOUS' &&
      i.internetdb.summary === 'porta(s) 22, 443 · tags c2 · 1 CVE(s)',
    i.internetdb,
  );
  const quiet = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'ip2',
      url: 'http://192.0.2.1/',
      urlDomain: '192.0.2.1',
      ownerId: owner.id,
    },
  });
  await checkReputation(quiet.id);
  ok(
    'InternetDB: IP sem dados é "sem informação"',
    (await results(quiet.id)).internetdb?.summary === 'sem informação',
  );

  server.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
