import { BlockList, isIP } from 'node:net';

import { env } from '../env';
import type { ReputationKind, Verdict } from '../generated/prisma/client';
import { baseDomain } from './domains';

/**
 * Enriquecimento de links (revisao de novembro, item 3.3), ao lado da reputacao externa e com o
 * mesmo cuidado: so o dominio (ou o IP) sai do DeepLook, nunca a URL completa. Tres fontes:
 *
 *   rdap     registro do dominio (o WHOIS atual): quando foi registrado e por quem. Dominio de
 *            dias e o sinal classico de phishing. Consulta o servidor RDAP do proprio registro
 *            (.com, .br...), achado pela lista publica da IANA, sem intermediario.
 *   crtsh    Certificate Transparency pelo crt.sh: quando o host ganhou o primeiro certificado
 *            e quantos teve. Certificado emitido ontem para um host de login e outro sinal.
 *   vtdns    DNS passivo pelas resolucoes do VirusTotal: para que IPs o dominio apontou (ou que
 *            dominios apontaram para o IP). Usa a chave do VirusTotal, que ja recebe o dominio.
 *
 * O RDAP e o crt.sh nao pedem chave, entao ligam por opcao explicita (RDAP_ENABLED, CT_ENABLED):
 * sem isso, nenhum dominio sai para um servico que a pessoa nao escolheu. O DNS passivo liga com
 * a chave do VirusTotal (PASSIVE_DNS_ENABLED=false desliga).
 *
 * Nenhuma das tres da veredito de reputacao: o resultado e informativo (UNKNOWN), a nao ser os
 * sinais de novidade, que viram SUSPICIOUS e entram na pontuacao de risco.
 */

/** Enderecos (os testes apontam para um servidor local). */
export const ENRICHMENT_ENDPOINTS = {
  ianaDns: 'https://data.iana.org/rdap/dns.json',
  ianaIpv4: 'https://data.iana.org/rdap/ipv4.json',
  ianaIpv6: 'https://data.iana.org/rdap/ipv6.json',
  crtsh: 'https://crt.sh/',
  virustotal: 'https://www.virustotal.com/api/v3',
};

/** Dominio registrado ha menos disto e suspeito. */
export const NEW_DOMAIN_DAYS = 30;
/** Primeiro certificado do host ha menos disto e suspeito. */
export const NEW_CERT_DAYS = 14;
const TIMEOUT_MS = 20_000;
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const DAY = 86_400_000;

export type EnrichmentResult = {
  status: 'FOUND' | 'NOT_FOUND';
  verdict: Verdict;
  summary: string;
  link: string | null;
  details?: Record<string, unknown>;
};

export class EnrichmentHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // O RDAP de alguns registros redireciona para o servidor certo.
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) throw new EnrichmentHttpError(res.status, `HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('resposta inválida');
  }
}

const daysAgo = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / DAY);
const day = (iso: string) => iso.slice(0, 10);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- RDAP ----

type Bootstrap = { services?: [string[], string[]][] };
const bootstraps = new Map<string, { at: number; data: Bootstrap }>();

async function bootstrap(url: string): Promise<Bootstrap> {
  const cached = bootstraps.get(url);
  if (cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) return cached.data;
  const data = (await getJson(url)) as Bootstrap;
  bootstraps.set(url, { at: Date.now(), data });
  return data;
}

/** Esquece a lista da IANA guardada (testes). */
export function resetRdapBootstrap() {
  bootstraps.clear();
}

/** Servidor RDAP do TLD (o sufixo mais longo que a lista da IANA conhece). */
async function rdapServerForDomain(domain: string): Promise<string | null> {
  const data = await bootstrap(ENRICHMENT_ENDPOINTS.ianaDns);
  const labels = domain.split('.');
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    const hit = data.services?.find(([tlds]) => tlds.includes(suffix));
    if (hit?.[1]?.[0]) return hit[1][0];
  }
  return null;
}

async function rdapServerForIp(ip: string): Promise<string | null> {
  const family = isIP(ip);
  const data = await bootstrap(
    family === 6 ? ENRICHMENT_ENDPOINTS.ianaIpv6 : ENRICHMENT_ENDPOINTS.ianaIpv4,
  );
  for (const [ranges, urls] of data.services ?? []) {
    const list = new BlockList();
    for (const range of ranges) {
      const [address, prefix] = range.split('/');
      try {
        list.addSubnet(address, Number(prefix), family === 6 ? 'ipv6' : 'ipv4');
      } catch {
        /* faixa malformada na lista: ignora */
      }
    }
    if (list.check(ip, family === 6 ? 'ipv6' : 'ipv4') && urls[0]) return urls[0];
  }
  return null;
}

type RdapEvent = { eventAction?: string; eventDate?: string };
type RdapEntity = { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]] };
type RdapAnswer = {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  name?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
};

const eventDate = (body: RdapAnswer, action: string) =>
  body.events?.find((e) => e.eventAction === action)?.eventDate ?? null;

/** Nome (fn do vCard) da entidade com o papel. */
function entityName(body: RdapAnswer, role: string): string | null {
  const entity = body.entities?.find((e) => e.roles?.includes(role));
  const fn = entity?.vcardArray?.[1]?.find((field) => field[0] === 'fn');
  return typeof fn?.[3] === 'string' ? fn[3].slice(0, 120) : null;
}

export async function rdap(
  kind: ReputationKind,
  value: string,
  now = Date.now(),
): Promise<EnrichmentResult> {
  const ip = kind === 'IP';
  // O registro so responde pelo dominio registravel: login.banco.com.br -> banco.com.br.
  const query = ip ? value : baseDomain(value);
  const server = ip ? await rdapServerForIp(query) : await rdapServerForDomain(query);
  if (!server) {
    return {
      status: 'NOT_FOUND',
      verdict: 'UNKNOWN',
      summary: 'o registro deste domínio não publica RDAP',
      link: null,
    };
  }
  let body: RdapAnswer;
  try {
    body = (await getJson(`${server.replace(/\/?$/, '/')}${ip ? 'ip' : 'domain'}/${query}`, {
      accept: 'application/rdap+json, application/json',
    })) as RdapAnswer;
  } catch (err) {
    if (err instanceof EnrichmentHttpError && err.status === 404) {
      return { status: 'NOT_FOUND', verdict: 'UNKNOWN', summary: 'não registrado', link: null };
    }
    throw err;
  }
  if (ip) {
    const parts = [
      body.name,
      body.startAddress && body.endAddress ? `${body.startAddress} – ${body.endAddress}` : null,
      body.country,
      entityName(body, 'registrant'),
    ].filter(Boolean);
    return {
      status: 'FOUND',
      verdict: 'UNKNOWN',
      summary: parts.join(' · ') || 'faixa registrada',
      link: null,
      details: { name: body.name ?? null, country: body.country ?? null },
    };
  }
  const registered = eventDate(body, 'registration');
  const expires = eventDate(body, 'expiration');
  const registrar = entityName(body, 'registrar');
  const age = registered ? daysAgo(registered, now) : null;
  const fresh = age !== null && age < NEW_DOMAIN_DAYS;
  const parts = [
    registered
      ? `${query} registrado em ${day(registered)} (${age === 0 ? 'hoje' : `há ${plural(age!, 'dia', 'dias')}`})`
      : `${query}: data de registro não informada`,
    registrar && `registrador ${registrar}`,
    expires && `vence em ${day(expires)}`,
  ].filter(Boolean);
  return {
    status: 'FOUND',
    verdict: fresh ? 'SUSPICIOUS' : 'UNKNOWN',
    summary: `${fresh ? 'domínio novo: ' : ''}${parts.join(' · ')}`,
    link: null,
    details: { domain: query, registered, expires, registrar, ageDays: age },
  };
}

// ---- Certificate Transparency (crt.sh) ----

type CrtEntry = { not_before?: string; entry_timestamp?: string; issuer_name?: string };

/** Teto de certificados lidos (um host popular tem milhares). */
const CRT_MAX = 5000;

export async function crtsh(
  _kind: ReputationKind,
  value: string,
  now = Date.now(),
): Promise<EnrichmentResult> {
  const url = new URL(ENRICHMENT_ENDPOINTS.crtsh);
  url.searchParams.set('q', value);
  url.searchParams.set('output', 'json');
  const body = (await getJson(url.toString())) as CrtEntry[];
  const list = Array.isArray(body) ? body.slice(0, CRT_MAX) : [];
  const link = `https://crt.sh/?q=${encodeURIComponent(value)}`;
  const dates = list
    .map((c) => c.not_before ?? c.entry_timestamp)
    .filter((d): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d)))
    .sort();
  if (!dates.length) {
    return {
      status: 'NOT_FOUND',
      verdict: 'UNKNOWN',
      summary: 'nenhum certificado público para este host',
      link,
    };
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  const age = daysAgo(first, now);
  const fresh = age < NEW_CERT_DAYS;
  const issuers = [
    ...new Set(
      list
        .map((c) => /(?:^|,\s*)O=([^,]+)/.exec(c.issuer_name ?? '')?.[1]?.trim())
        .filter((o): o is string => Boolean(o)),
    ),
  ];
  return {
    status: 'FOUND',
    verdict: fresh ? 'SUSPICIOUS' : 'UNKNOWN',
    summary:
      `${fresh ? 'certificado recente: ' : ''}${plural(list.length, 'certificado', 'certificados')}` +
      `${list.length === CRT_MAX ? ' ou mais' : ''}, o primeiro em ${day(first)}` +
      ` (há ${plural(age, 'dia', 'dias')}), o último em ${day(last)}` +
      (issuers.length ? ` · ${issuers.slice(0, 2).join(', ')}` : ''),
    link,
    details: { count: list.length, first, last, issuers: issuers.slice(0, 5), ageDays: age },
  };
}

// ---- DNS passivo (resolucoes do VirusTotal) ----

type VtResolution = {
  attributes?: { ip_address?: string; host_name?: string; date?: number };
};

/** Quantas resolucoes pedir (as mais recentes). */
const VT_RESOLUTIONS = 20;

export async function vtdns(kind: ReputationKind, value: string): Promise<EnrichmentResult> {
  const ip = kind === 'IP';
  const path = ip ? 'ip_addresses' : 'domains';
  let body: { data?: VtResolution[] };
  try {
    body = (await getJson(
      `${ENRICHMENT_ENDPOINTS.virustotal}/${path}/${encodeURIComponent(value)}/resolutions?limit=${VT_RESOLUTIONS}`,
      { 'x-apikey': env.VT_API_KEY },
    )) as typeof body;
  } catch (err) {
    if (err instanceof EnrichmentHttpError && err.status === 404) {
      return {
        status: 'NOT_FOUND',
        verdict: 'UNKNOWN',
        summary: 'sem resoluções conhecidas',
        link: null,
      };
    }
    throw err;
  }
  const rows = (body.data ?? [])
    .map((r) => ({
      other: (ip ? r.attributes?.host_name : r.attributes?.ip_address) ?? '',
      date: r.attributes?.date ? new Date(r.attributes.date * 1000).toISOString() : null,
    }))
    .filter((r) => r.other);
  const link = `https://www.virustotal.com/gui/${ip ? 'ip-address' : 'domain'}/${encodeURIComponent(value)}/relations`;
  if (!rows.length) {
    return { status: 'NOT_FOUND', verdict: 'UNKNOWN', summary: 'sem resoluções conhecidas', link };
  }
  const distinct = [...new Set(rows.map((r) => r.other))];
  const latest = rows
    .map((r) => r.date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  return {
    status: 'FOUND',
    verdict: 'UNKNOWN',
    summary:
      `${ip ? 'domínios que apontaram para este IP' : 'apontou para'}: ` +
      `${distinct.slice(0, 4).join(', ')}${distinct.length > 4 ? ` e mais ${distinct.length - 4}` : ''}` +
      (latest ? ` (último visto em ${day(latest)})` : ''),
    link,
    details: {
      [ip ? 'domains' : 'ips']: distinct.slice(0, VT_RESOLUTIONS),
      latest: latest ?? null,
    },
  };
}
