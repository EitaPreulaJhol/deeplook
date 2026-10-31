import { domainToUnicode } from 'node:url';

import type { LookalikeReason } from '../generated/prisma/client';
import { baseDomain } from './domains';
import type { Db } from './prisma';
import { prisma } from './prisma';

/**
 * Dominios parecidos com os da empresa (item 92). Em vez de gerar a lista de
 * variacoes (milhares, com os homoglifos), cada dominio visto e comparado com os
 * da empresa pelas mesmas regras. Nada e consultado na internet.
 */

export const REASON_LABEL: Record<LookalikeReason, string> = {
  TLD: 'outro TLD',
  HOMOGLYPH: 'letras parecidas',
  TYPO: 'erro de digitação',
  KEYWORD: 'nome com palavra a mais',
  SUBDOMAIN: 'nome no subdomínio',
};

/** Onde o dominio apareceu na amostra. */
export type LookalikeSource = 'URL' | 'SENDER' | 'LINK' | 'IOC' | 'REPORT';

export interface LookalikeMatch {
  company: string;
  reason: LookalikeReason;
  /** Complemento ("letra faltando", "rn no lugar de m"...). */
  detail: string | null;
}

/** Letras e numeros que se passam por outros (cirilico, grego, leet). */
const CONFUSABLE: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  м: 'm',
  т: 't',
  н: 'h',
  в: 'b',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  ı: 'i',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ν: 'v',
  ρ: 'p',
  τ: 't',
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '5': 's',
  '@': 'a',
};

/** Forma "como se le": sem acento, confusaveis trocados, rn=m, vv=w, i=l. */
export function skeleton(label: string): string {
  return [...label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()]
    .map((ch) => CONFUSABLE[ch] ?? ch)
    .join('')
    .replaceAll('rn', 'm')
    .replaceAll('vv', 'w')
    .replaceAll('cl', 'd')
    .replaceAll('i', 'l');
}

/** Distancia 1 (troca, falta, sobra ou inversao de vizinhas) e o tipo do erro. */
function typo(seen: string, real: string): string | null {
  if (seen === real) return null;
  if (seen.length === real.length) {
    const diff = [...seen].map((ch, i) => (ch === real[i] ? -1 : i)).filter((i) => i >= 0);
    if (diff.length === 1) return 'letra trocada';
    if (
      diff.length === 2 &&
      diff[1] === diff[0] + 1 &&
      seen[diff[0]] === real[diff[1]] &&
      seen[diff[1]] === real[diff[0]]
    ) {
      return 'letras invertidas';
    }
    return null;
  }
  const [longer, shorter] = seen.length > real.length ? [seen, real] : [real, seen];
  if (longer.length - shorter.length !== 1) return null;
  for (let i = 0; i < longer.length; i++) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) {
      if (seen.length < real.length) return 'letra faltando';
      return seen[i] === '-'
        ? 'hífen a mais'
        : seen[i] === seen[i - 1] || seen[i] === seen[i + 1]
          ? 'letra repetida'
          : 'letra a mais';
    }
  }
  return null;
}

/** "empresa.com.br" -> nome "empresa" e sufixo "com.br". */
function split(domain: string): { name: string; suffix: string } {
  const base = baseDomain(domain);
  const dot = base.indexOf('.');
  return dot < 0
    ? { name: base, suffix: '' }
    : { name: base.slice(0, dot), suffix: base.slice(dot + 1) };
}

/** Host normalizado (minusculas, sem "www." e ponto final, IDN em Unicode) ou null. */
export function normalizeHost(raw: string): string | null {
  let host = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!host || /^\d+(\.\d+){3}$/.test(host) || host.includes(':') || !host.includes('.')) {
    return null;
  }
  if (host.includes('xn--')) host = domainToUnicode(host) || host;
  return host.replace(/^www\./, '');
}

/**
 * Compara um dominio visto com os da empresa. Null se nao parece com nenhum ou
 * se e da propria empresa (o dominio ou um subdominio dele).
 */
export function matchLookalike(rawHost: string, companies: string[]): LookalikeMatch | null {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  // Mesmo dominio-base: com portal.empresa.com.br cadastrado, mail.empresa.com.br
  // e empresa.com.br tambem sao da empresa (item 101).
  const hostBase = baseDomain(host);
  if (companies.some((c) => baseDomain(c) === hostBase)) return null;
  const seen = split(host);
  const sub = host.slice(0, Math.max(0, host.length - baseDomain(host).length - 1));
  for (const company of companies) {
    const real = split(company);
    if (real.name.length < 3) continue;
    if (seen.name === real.name && seen.suffix !== real.suffix) {
      return { company, reason: 'TLD', detail: `.${seen.suffix || '?'}` };
    }
    if (skeleton(seen.name) === skeleton(real.name)) {
      return { company, reason: 'HOMOGLYPH', detail: null };
    }
    const err = real.name.length >= 4 ? typo(seen.name, real.name) : null;
    if (err) return { company, reason: 'TYPO', detail: err };
    if (real.name.length >= 4 && seen.name.includes(real.name)) {
      const extra = seen.name.replace(real.name, '').replace(/^-+|-+$/g, '');
      return { company, reason: 'KEYWORD', detail: extra ? `"${extra}"` : null };
    }
    if (sub && sub.split(/[.-]/).includes(real.name)) {
      return { company, reason: 'SUBDOMAIN', detail: null };
    }
  }
  return null;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};
const domainOfEmail = (address: string | null | undefined) =>
  address?.includes('@') ? address.split('@').pop()! : null;

type EmailInfoLike = {
  from?: { address: string | null } | null;
  sender?: { address: string | null } | null;
  replyTo?: { address: string | null }[];
  returnPath?: string | null;
  links?: string[];
};
type StaticInfoLike = { iocCandidates?: { kind: string; value: string }[] };

/** Dominios de uma amostra com a origem (link da amostra, remetente, links...). */
async function entryHosts(db: Db, entryId: string) {
  const entry = await db.entry.findUnique({
    where: { id: entryId },
    select: { urlDomain: true, url: true, emailInfo: true, staticInfo: true },
  });
  if (!entry) return null;
  const found = new Map<string, Set<LookalikeSource>>();
  const add = (raw: string | null | undefined, source: LookalikeSource) => {
    const host = raw ? normalizeHost(raw) : null;
    if (!host) return;
    found.set(host, (found.get(host) ?? new Set()).add(source));
  };
  add(entry.urlDomain ?? (entry.url ? hostOf(entry.url) : null), 'URL');
  const email = entry.emailInfo as EmailInfoLike | null;
  if (email) {
    for (const p of [email.from, email.sender, ...(email.replyTo ?? [])]) {
      add(domainOfEmail(p?.address), 'SENDER');
    }
    add(domainOfEmail(email.returnPath), 'SENDER');
    for (const link of email.links ?? []) add(hostOf(link), 'LINK');
  }
  const stat = entry.staticInfo as StaticInfoLike | null;
  for (const ioc of stat?.iocCandidates ?? []) {
    if (ioc.kind === 'DOMAIN') add(ioc.value, 'IOC');
    if (ioc.kind === 'URL') add(hostOf(ioc.value), 'IOC');
    if (ioc.kind === 'EMAIL') add(domainOfEmail(ioc.value), 'IOC');
  }
  const reported = await db.reportIoc.findMany({
    where: { entryId, kind: { in: ['DOMAIN', 'EMAIL'] } },
    select: { kind: true, value: true },
  });
  for (const r of reported) add(r.kind === 'EMAIL' ? domainOfEmail(r.value) : r.value, 'REPORT');
  return found;
}

/** Dominios cadastrados da empresa (poucos; lidos a cada varredura). */
export async function companyDomains(db: Db = prisma): Promise<string[]> {
  return (await db.companyDomain.findMany({ select: { domain: true } })).map((d) => d.domain);
}

/** Refaz os achados de uma amostra. Devolve quantos dominios parecidos achou. */
export async function scanLookalikes(
  db: Db,
  entryId: string,
  companies?: string[],
): Promise<number> {
  const list = companies ?? (await companyDomains(db));
  const hosts = list.length ? await entryHosts(db, entryId) : null;
  await db.lookalikeHit.deleteMany({ where: { entryId } });
  if (!hosts) return 0;
  const hits = [...hosts.entries()].flatMap(([domain, sources]) => {
    const m = matchLookalike(domain, list);
    return m
      ? [
          {
            entryId,
            domain,
            companyDomain: m.company,
            reason: m.reason,
            detail: m.detail,
            sources: [...sources],
          },
        ]
      : [];
  });
  if (hits.length) await db.lookalikeHit.createMany({ data: hits, skipDuplicates: true });
  return hits.length;
}

/** Sem derrubar quem chamou (chegada, relatorio, reanalise). */
export async function scanLookalikesQuietly(entryId: string, db: Db = prisma): Promise<void> {
  try {
    await scanLookalikes(db, entryId);
  } catch (err) {
    console.error('Falha ao procurar dominios parecidos', err);
  }
}

/** Revarre todas as amostras (lista da empresa mudou), em lotes. */
export async function rescanAllLookalikes(): Promise<number> {
  const list = await companyDomains();
  if (!list.length) {
    await prisma.lookalikeHit.deleteMany({});
    return 0;
  }
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const batch = await prisma.entry.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) return total;
    for (const e of batch) total += await scanLookalikes(prisma, e.id, list);
    cursor = batch[batch.length - 1].id;
  }
}
