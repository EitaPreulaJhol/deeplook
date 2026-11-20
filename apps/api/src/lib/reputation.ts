import { isIP } from 'node:net';

import { env } from '../env';
import type { Prisma, ReputationKind, ReputationStatus, Verdict } from '../generated/prisma/client';
import { avclass } from './avclass';
import { crtsh, EnrichmentHttpError, rdap, vtdns } from './link-enrichment';
import { prisma } from './prisma';

/**
 * Reputacao externa (aba Detalhes da ficha): consulta automatica no envio, so
 * com o INDICADOR (SHA-256 do arquivo; dominio ou IP do link, nunca a URL
 * completa nem o arquivo). Cada servico so liga com a chave no .env.
 */

export type ServiceId =
  | 'virustotal'
  | 'malwarebazaar'
  | 'urlhaus'
  | 'threatfox'
  | 'abuseipdb'
  // Enriquecimento de links (revisao de novembro, 3.3; lib/link-enrichment.ts).
  | 'rdap'
  | 'crtsh'
  | 'vtdns'
  // Reputacao por hash e por IP (plans/analise-estatica-ampliada, item 5).
  | 'hashlookup'
  | 'yaraify'
  | 'internetdb'
  // Sandbox publico do Triage (Recorded Future), pela chave (item 5).
  | 'triage';

export const SERVICE_NAMES: Record<ServiceId, string> = {
  virustotal: 'VirusTotal',
  malwarebazaar: 'MalwareBazaar',
  urlhaus: 'URLhaus',
  threatfox: 'ThreatFox',
  abuseipdb: 'AbuseIPDB',
  rdap: 'Registro (RDAP)',
  crtsh: 'Certificados (crt.sh)',
  vtdns: 'DNS passivo (VirusTotal)',
  hashlookup: 'Arquivo conhecido (CIRCL hashlookup)',
  yaraify: 'YARAify',
  internetdb: 'Shodan InternetDB',
  triage: 'Triage (Recorded Future)',
};

/** Enderecos das APIs (o teste de integracao aponta para um servidor local). */
export const ENDPOINTS = {
  virustotal: 'https://www.virustotal.com/api/v3',
  malwarebazaar: 'https://mb-api.abuse.ch/api/v1/',
  urlhaus: 'https://urlhaus-api.abuse.ch/v1',
  threatfox: 'https://threatfox-api.abuse.ch/api/v1/',
  abuseipdb: 'https://api.abuseipdb.com/api/v2',
  hashlookup: 'https://hashlookup.circl.lu',
  yaraify: 'https://yaraify-api.abuse.ch/api/v1/',
  internetdb: 'https://internetdb.shodan.io',
  triage: 'https://tria.ge/api/v0',
};

/** Intervalo minimo entre chamadas por servico (VirusTotal gratuito: 4/min). */
export const MIN_INTERVAL_MS: Record<ServiceId, number> = {
  virustotal: 15_000,
  malwarebazaar: 1_000,
  urlhaus: 1_000,
  threatfox: 1_000,
  abuseipdb: 1_000,
  rdap: 1_000,
  // O crt.sh e um servico comunitario e lento: uma consulta a cada 3 s.
  crtsh: 3_000,
  // Mesma chave e mesma cota do VirusTotal: entra na fila dele (QUEUE_OF).
  vtdns: 15_000,
  hashlookup: 1_000,
  yaraify: 1_000,
  internetdb: 1_000,
  triage: 2_000,
};

/** Servicos que dividem a cota (e a fila) de outro. */
const QUEUE_OF: Partial<Record<ServiceId, ServiceId>> = { vtdns: 'virustotal' };
const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

/** Quais servicos consultam cada tipo de indicador. */
const BY_KIND: Record<ReputationKind, ServiceId[]> = {
  HASH: ['virustotal', 'malwarebazaar', 'threatfox', 'yaraify', 'hashlookup', 'triage'],
  DOMAIN: ['virustotal', 'urlhaus', 'threatfox', 'rdap', 'crtsh', 'vtdns'],
  IP: ['virustotal', 'urlhaus', 'threatfox', 'abuseipdb', 'rdap', 'vtdns', 'internetdb'],
};

function keyOf(service: ServiceId): string {
  if (service === 'virustotal') return env.VT_API_KEY;
  // Sem chave: so ligam por opcao explicita, para nenhum dominio sair sem a pessoa escolher.
  if (service === 'rdap') return env.RDAP_ENABLED === 'true' ? 'on' : '';
  if (service === 'crtsh') return env.CT_ENABLED === 'true' ? 'on' : '';
  if (service === 'vtdns') return env.PASSIVE_DNS_ENABLED === 'true' ? env.VT_API_KEY : '';
  if (service === 'abuseipdb') return env.ABUSEIPDB_API_KEY;
  if (service === 'hashlookup') return env.HASHLOOKUP_ENABLED === 'true' ? 'on' : '';
  if (service === 'internetdb') return env.INTERNETDB_ENABLED === 'true' ? 'on' : '';
  if (service === 'triage') return env.TRIAGE_API_KEY;
  return env.ABUSECH_AUTH_KEY;
}

/** Servicos ligados que consultam este tipo de indicador. */
export function servicesFor(kind: ReputationKind): ServiceId[] {
  return enabledServices().filter((s) => BY_KIND[kind].includes(s));
}

/** Servicos com chave configurada, na ordem de exibicao. */
export function enabledServices(): ServiceId[] {
  return (Object.keys(SERVICE_NAMES) as ServiceId[]).filter((s) => keyOf(s));
}

export interface Lookup {
  status: ReputationStatus;
  verdict: Verdict;
  summary: string;
  link: string | null;
  details?: Prisma.InputJsonValue;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('resposta inválida');
  }
}

const notFound = (summary = 'não encontrado na base'): Lookup => ({
  status: 'NOT_FOUND',
  verdict: 'UNKNOWN',
  summary,
  link: null,
});

const date = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : null);

// ---- Clientes de cada servico ----

async function virustotal(kind: ReputationKind, value: string): Promise<Lookup> {
  const path = { HASH: 'files', DOMAIN: 'domains', IP: 'ip_addresses' }[kind];
  const gui = { HASH: 'file', DOMAIN: 'domain', IP: 'ip-address' }[kind];
  let body: {
    data?: {
      attributes?: {
        last_analysis_stats?: Record<string, number>;
        popular_threat_classification?: { suggested_threat_label?: string };
        reputation?: number;
        last_analysis_results?: Record<string, { category?: string; result?: string | null }>;
        md5?: string;
        sha1?: string;
      };
    };
  };
  try {
    body = (await call(`${ENDPOINTS.virustotal}/${path}/${encodeURIComponent(value)}`, {
      headers: { 'x-apikey': env.VT_API_KEY, accept: 'application/json' },
    })) as typeof body;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return notFound();
    throw err;
  }
  const attrs = body.data?.attributes ?? {};
  const stats = attrs.last_analysis_stats ?? {};
  const malicious = stats.malicious ?? 0;
  const suspicious = stats.suspicious ?? 0;
  const total = Object.values(stats).reduce((a, b) => a + (b ?? 0), 0);
  const label = attrs.popular_threat_classification?.suggested_threat_label;
  const verdict: Verdict =
    malicious >= 5 ? 'MALICIOUS' : malicious + suspicious > 0 ? 'SUSPICIOUS' : 'CLEAN';
  // Familia por consenso dos rotulos dos antivirus (AVclass; plans/analise-estatica-ampliada, item 6).
  const labels = Object.entries(attrs.last_analysis_results ?? {})
    .filter(([, r]) => (r.category === 'malicious' || r.category === 'suspicious') && r.result)
    .map(([engine, r]) => [engine, String(r.result)] as [string, string]);
  const consensus =
    kind === 'HASH' && labels.length
      ? avclass(labels, [attrs.md5 ?? '', attrs.sha1 ?? '', value].filter(Boolean))
      : null;
  const family = consensus?.family
    ? `família ${consensus.family} (${consensus.tags.find((t) => t.tag === consensus.family)?.votes} antivírus)`
    : null;
  return {
    status: 'FOUND',
    verdict,
    summary: [`${malicious}/${total} motores detectaram`, label, family]
      .filter(Boolean)
      .join(' · '),
    link: `https://www.virustotal.com/gui/${gui}/${encodeURIComponent(value)}`,
    details: {
      stats,
      reputation: attrs.reputation ?? null,
      label: label ?? null,
      ...(consensus ? { avclass: consensus as unknown as Prisma.InputJsonValue } : {}),
      ...(labels.length ? { labels: labels.slice(0, 100) } : {}),
    },
  };
}

const abusechHeaders = () => ({ 'Auth-Key': env.ABUSECH_AUTH_KEY, accept: 'application/json' });

async function malwarebazaar(_kind: ReputationKind, value: string): Promise<Lookup> {
  const body = (await call(ENDPOINTS.malwarebazaar, {
    method: 'POST',
    headers: abusechHeaders(),
    body: new URLSearchParams({ query: 'get_info', hash: value }),
  })) as {
    query_status?: string;
    data?: {
      signature?: string | null;
      file_type?: string;
      first_seen?: string;
      tags?: string[];
    }[];
  };
  const hit = body.query_status === 'ok' ? body.data?.[0] : undefined;
  if (!hit) return notFound();
  const parts = [
    hit.signature || 'malware conhecido',
    hit.file_type,
    date(hit.first_seen) && `visto em ${date(hit.first_seen)}`,
  ];
  return {
    status: 'FOUND',
    verdict: 'MALICIOUS',
    summary: parts.filter(Boolean).join(' · '),
    link: `https://bazaar.abuse.ch/sample/${value}/`,
    details: { signature: hit.signature ?? null, tags: hit.tags ?? [] },
  };
}

async function urlhaus(_kind: ReputationKind, value: string): Promise<Lookup> {
  const body = (await call(`${ENDPOINTS.urlhaus}/host/`, {
    method: 'POST',
    headers: abusechHeaders(),
    body: new URLSearchParams({ host: value }),
  })) as {
    query_status?: string;
    urlhaus_reference?: string;
    url_count?: string | number;
    urls?: { url_status?: string; threat?: string }[];
  };
  if (body.query_status !== 'ok') return notFound();
  const count = Number(body.url_count ?? body.urls?.length ?? 0);
  const online = (body.urls ?? []).filter((u) => u.url_status === 'online').length;
  return {
    status: 'FOUND',
    verdict: online > 0 ? 'MALICIOUS' : 'SUSPICIOUS',
    summary: `${count} URL(s) de malware conhecida(s) neste host · ${online} online`,
    link: body.urlhaus_reference ?? `https://urlhaus.abuse.ch/host/${value}/`,
    details: { urlCount: count, online },
  };
}

async function threatfox(kind: ReputationKind, value: string): Promise<Lookup> {
  const body = (await call(ENDPOINTS.threatfox, {
    method: 'POST',
    headers: { ...abusechHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(
      kind === 'HASH'
        ? { query: 'search_hash', hash: value }
        : { query: 'search_ioc', search_term: value, exact_match: true },
    ),
  })) as {
    query_status?: string;
    data?: {
      id?: string | number;
      malware_printable?: string;
      threat_type_desc?: string;
      confidence_level?: number;
    }[];
  };
  const hit = body.query_status === 'ok' && Array.isArray(body.data) ? body.data[0] : undefined;
  if (!hit) return notFound();
  const parts = [
    hit.malware_printable,
    hit.threat_type_desc,
    hit.confidence_level !== undefined && `confiança ${hit.confidence_level}%`,
  ];
  return {
    status: 'FOUND',
    verdict: 'MALICIOUS',
    summary: parts.filter(Boolean).join(' · '),
    link: hit.id ? `https://threatfox.abuse.ch/ioc/${hit.id}/` : null,
    details: { matches: body.data?.length ?? 0 },
  };
}

async function abuseipdb(_kind: ReputationKind, value: string): Promise<Lookup> {
  const body = (await call(
    `${ENDPOINTS.abuseipdb}/check?${new URLSearchParams({ ipAddress: value, maxAgeInDays: '90' })}`,
    { headers: { Key: env.ABUSEIPDB_API_KEY, accept: 'application/json' } },
  )) as {
    data?: {
      abuseConfidenceScore?: number;
      totalReports?: number;
      countryCode?: string | null;
      isp?: string | null;
    };
  };
  const d = body.data ?? {};
  const score = d.abuseConfidenceScore ?? 0;
  const reports = d.totalReports ?? 0;
  const verdict: Verdict = score >= 75 ? 'MALICIOUS' : score >= 25 ? 'SUSPICIOUS' : 'CLEAN';
  const parts = [
    `confiança de abuso ${score}%`,
    `${reports} denúncia(s) em 90 dias`,
    d.countryCode,
    d.isp,
  ];
  return {
    status: 'FOUND',
    verdict,
    summary: parts.filter(Boolean).join(' · '),
    link: `https://www.abuseipdb.com/check/${value}`,
    details: { score, reports },
  };
}

/**
 * CIRCL hashlookup: o hash num conjunto de arquivos conhecidos (NSRL, pacotes de distribuicoes). E o
 * atenuante: o arquivo legitimo que sai de um instalador. O servico nao marca malicioso; a
 * confianca (hashlookup:trust) vai de 0 a 100, e 50 e "sem opiniao".
 */
async function hashlookup(_kind: ReputationKind, value: string): Promise<Lookup> {
  let body: Record<string, unknown>;
  try {
    body = (await call(`${ENDPOINTS.hashlookup}/lookup/sha256/${encodeURIComponent(value)}`, {
      headers: { accept: 'application/json' },
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return notFound();
    throw err;
  }
  const trust = typeof body['hashlookup:trust'] === 'number' ? body['hashlookup:trust'] : null;
  const product = (body.ProductCode as { ProductName?: string } | undefined)?.ProductName ?? null;
  const source = typeof body.source === 'string' ? body.source : null;
  const name = typeof body.FileName === 'string' ? body.FileName.split('/').pop() : null;
  return {
    status: 'FOUND',
    verdict: trust === null || trust >= 50 ? 'CLEAN' : 'UNKNOWN',
    summary: [
      source ? `arquivo conhecido (${source})` : 'arquivo conhecido',
      product,
      name,
      trust !== null && `confiança ${trust}`,
    ]
      .filter(Boolean)
      .join(' · '),
    link: `${ENDPOINTS.hashlookup}/lookup/sha256/${value}`,
    details: { source, product, fileName: name ?? null, trust },
  };
}

/**
 * YARAify (abuse.ch): as regras YARA publicas e o ClamAV que rodaram sobre a amostra la (e sobre o
 * que o unpacker deles tirou dela). Regra privada aparece como "xxx" e fica de fora.
 */
async function yaraify(_kind: ReputationKind, value: string): Promise<Lookup> {
  const body = (await call(ENDPOINTS.yaraify, {
    method: 'POST',
    headers: { ...abusechHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'lookup_hash', search_term: value }),
  })) as {
    query_status?: string;
    data?: {
      tasks?: {
        clamav_results?: string[] | null;
        static_results?: { rule_name?: string }[] | null;
        unpack_results?: { unpacked_yara_matches?: { rule_name?: string }[] | null }[] | null;
      }[];
    };
  };
  if (body.query_status !== 'ok' || !body.data) return notFound();
  const tasks = body.data.tasks ?? [];
  const rules = [
    ...new Set(
      tasks
        .flatMap((t) => [
          ...(t.static_results ?? []),
          ...(t.unpack_results ?? []).flatMap((u) => u.unpacked_yara_matches ?? []),
        ])
        .map((r) => r.rule_name ?? '')
        .filter((r) => r && r !== 'xxx'),
    ),
  ];
  const clamav = [...new Set(tasks.flatMap((t) => t.clamav_results ?? []).filter(Boolean))];
  const verdict: Verdict = clamav.length ? 'MALICIOUS' : rules.length ? 'SUSPICIOUS' : 'UNKNOWN';
  return {
    status: 'FOUND',
    verdict,
    summary: [
      `${rules.length} regra(s) YARA`,
      rules.slice(0, 3).join(', '),
      clamav.length && `ClamAV: ${clamav.slice(0, 2).join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · '),
    link: `https://yaraify.abuse.ch/sample/${value}/`,
    details: { rules: rules.slice(0, 50), clamav: clamav.slice(0, 20) },
  };
}

/**
 * Triage (Recorded Future; plans/analise-estatica-ampliada, item 5): a amostra ja analisada no
 * sandbox publico deles. A busca pelo SHA-256 da as analises; a mais recente da a nota (1 a 10), a
 * familia e as tags pelo overview.json (formato da documentacao em tria.ge/docs/cloud-api).
 */
async function triage(_kind: ReputationKind, value: string): Promise<Lookup> {
  const headers = { authorization: `Bearer ${env.TRIAGE_API_KEY}`, accept: 'application/json' };
  const found = (await call(
    `${ENDPOINTS.triage}/search?query=${encodeURIComponent(`sha256:${value}`)}`,
    { headers },
  )) as { data?: { id?: string; status?: string; completed?: string }[] };
  const samples = (found.data ?? []).filter((s) => typeof s.id === 'string');
  if (!samples.length) return notFound();
  const reported = samples.find((s) => s.status === 'reported') ?? samples[0];
  const id = reported.id!;
  let overview: {
    analysis?: { score?: number };
    targets?: { family?: string[]; tags?: string[] }[];
  } = {};
  try {
    overview = (await call(`${ENDPOINTS.triage}/samples/${encodeURIComponent(id)}/overview.json`, {
      headers,
    })) as typeof overview;
  } catch (err) {
    // Analise ainda rodando (ou apagada): fica a existencia.
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  const score = typeof overview.analysis?.score === 'number' ? overview.analysis.score : null;
  const families = [...new Set((overview.targets ?? []).flatMap((t) => t.family ?? []))];
  const tags = [
    ...new Set(
      (overview.targets ?? []).flatMap((t) => t.tags ?? []).filter((t) => !t.startsWith('family:')),
    ),
  ];
  // A escala do Triage: 10 conhecido como malicioso, 8-9 provavel, 6-7 suspeito, ate 5 provavel limpo.
  const verdict: Verdict =
    score === null ? 'UNKNOWN' : score >= 8 ? 'MALICIOUS' : score >= 6 ? 'SUSPICIOUS' : 'UNKNOWN';
  return {
    status: 'FOUND',
    verdict,
    summary: [
      score !== null ? `nota ${score}/10` : 'analisado',
      families.length && `família ${families.slice(0, 3).join(', ')}`,
      `${samples.length} análise(s)`,
    ]
      .filter(Boolean)
      .join(' · '),
    link: `https://tria.ge/${id}`,
    details: {
      id,
      score,
      families: families.slice(0, 10),
      tags: tags.slice(0, 30),
      analyses: samples.length,
    },
  };
}

/** Shodan InternetDB: portas abertas, CPEs, tags e CVEs do IP (sem chave, atualizado por semana). */
async function internetdb(_kind: ReputationKind, value: string): Promise<Lookup> {
  let body: {
    ports?: number[];
    cpes?: string[];
    tags?: string[];
    vulns?: string[];
    hostnames?: string[];
  };
  try {
    body = (await call(`${ENDPOINTS.internetdb}/${encodeURIComponent(value)}`, {
      headers: { accept: 'application/json' },
    })) as typeof body;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return notFound('sem informação');
    throw err;
  }
  const ports = body.ports ?? [];
  const tags = body.tags ?? [];
  const vulns = body.vulns ?? [];
  return {
    status: 'FOUND',
    // So informacao: porta aberta nao e malicia. Tag de C2 ou malware da Shodan vira suspeito.
    verdict: tags.some((t) => /c2|malware|compromised/i.test(t)) ? 'SUSPICIOUS' : 'UNKNOWN',
    summary: [
      ports.length ? `porta(s) ${ports.slice(0, 8).join(', ')}` : 'nenhuma porta aberta',
      tags.length && `tags ${tags.slice(0, 5).join(', ')}`,
      vulns.length && `${vulns.length} CVE(s)`,
    ]
      .filter(Boolean)
      .join(' · '),
    link: `https://www.shodan.io/host/${value}`,
    details: {
      ports: ports.slice(0, 100),
      cpes: (body.cpes ?? []).slice(0, 50),
      tags,
      vulns: vulns.slice(0, 100),
      hostnames: (body.hostnames ?? []).slice(0, 50),
    },
  };
}

const CLIENTS: Record<ServiceId, (kind: ReputationKind, value: string) => Promise<Lookup>> = {
  virustotal,
  malwarebazaar,
  urlhaus,
  threatfox,
  abuseipdb,
  rdap: (kind, value) => rdap(kind, value) as Promise<Lookup>,
  crtsh: (kind, value) => crtsh(kind, value) as Promise<Lookup>,
  vtdns: (kind, value) => vtdns(kind, value) as Promise<Lookup>,
  hashlookup,
  yaraify,
  internetdb,
  triage,
};

// ---- Fila por servico (respeita o intervalo minimo) ----

const queues = new Map<ServiceId, Promise<unknown>>();
const lastCall = new Map<ServiceId, number>();

function throttled<T>(caller: ServiceId, fn: () => Promise<T>): Promise<T> {
  const service = QUEUE_OF[caller] ?? caller;
  const prev = queues.get(service) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const wait = (lastCall.get(service) ?? 0) + MIN_INTERVAL_MS[service] - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall.set(service, Date.now());
      return fn();
    });
  queues.set(service, next);
  return next;
}

/** Zera a fila (teste). */
export function resetReputationQueues() {
  queues.clear();
  lastCall.clear();
}

/** Indicador da amostra: SHA-256 do arquivo; dominio (ou IP) do link. */
export function indicatorOf(entry: {
  type: 'FILE' | 'URL';
  sha256: string | null;
  urlDomain: string | null;
}): { kind: ReputationKind; value: string } | null {
  if (entry.type === 'FILE') return entry.sha256 ? { kind: 'HASH', value: entry.sha256 } : null;
  const host = entry.urlDomain?.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return null;
  return { kind: isIP(host) ? 'IP' : 'DOMAIN', value: host };
}

/**
 * Consulta os servicos ligados para a amostra e grava um resultado por servico.
 * Reaproveita resultado do mesmo indicador com menos de 24 h (exceto `force`).
 * Nunca lanca: falha de um servico vira status ERROR.
 */
export async function checkReputation(entryId: string, force = false): Promise<void> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { id: true, type: true, sha256: true, urlDomain: true },
  });
  if (!entry) return;
  const indicator = indicatorOf(entry);
  if (!indicator) return;
  const services = servicesFor(indicator.kind);

  await Promise.all(
    services.map(async (service) => {
      const where = { entryId_service: { entryId, service } };
      const base = { kind: indicator.kind, indicator: indicator.value };
      if (!force) {
        const cached = await prisma.reputationResult.findFirst({
          where: {
            service,
            indicator: indicator.value,
            status: { not: 'ERROR' },
            checkedAt: { gt: new Date(Date.now() - CACHE_MS) },
          },
          orderBy: { checkedAt: 'desc' },
        });
        if (cached) {
          if (cached.entryId === entryId) return;
          const copy = {
            ...base,
            status: cached.status,
            verdict: cached.verdict,
            summary: cached.summary,
            link: cached.link,
            details: cached.details ?? undefined,
            checkedAt: cached.checkedAt,
          };
          await prisma.reputationResult.upsert({
            where,
            create: { entryId, service, ...copy },
            update: copy,
          });
          return;
        }
      }
      // Marca "consultando" para a ficha mostrar o andamento.
      await prisma.reputationResult.upsert({
        where,
        create: {
          entryId,
          service,
          ...base,
          status: 'PENDING',
          verdict: 'UNKNOWN',
          summary: 'consultando...',
        },
        update: { ...base, status: 'PENDING', summary: 'consultando...' },
      });
      let result: Lookup;
      try {
        result = await throttled(service, () => CLIENTS[service](indicator.kind, indicator.value));
      } catch (err) {
        const status =
          err instanceof HttpError || err instanceof EnrichmentHttpError ? err.status : null;
        const reason =
          status === 401 || status === 403
            ? 'chave recusada pelo serviço'
            : status === 429
              ? 'limite de consultas do serviço atingido'
              : err instanceof Error && err.name === 'TimeoutError'
                ? 'o serviço não respondeu a tempo'
                : `falha na consulta${err instanceof Error ? ` (${err.message})` : ''}`;
        result = { status: 'ERROR', verdict: 'UNKNOWN', summary: reason, link: null };
      }
      const data = {
        ...base,
        ...result,
        details: result.details ?? undefined,
        checkedAt: new Date(),
      };
      await prisma.reputationResult.upsert({
        where,
        create: { entryId, service, ...data },
        update: data,
      });
    }),
  );
}

/** Dispara a consulta sem segurar a resposta do envio. */
export function checkReputationInBackground(
  entryId: string,
  log: { error: (o: object, m: string) => void },
) {
  if (enabledServices().length === 0) return;
  void checkReputation(entryId).catch((err) => log.error({ err }, '[reputacao] falha'));
}
