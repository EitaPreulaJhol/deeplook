import type { EntryStatus, Verdict } from '../generated/prisma/client';
import { entriesIocs } from '../routes/iocs';
import { allowedBy, loadAllowlist } from './allowlist';
import { type CaseIoc, type ExportKind, worstVerdict } from './ioc-export';
import { normalizeUrl } from './ioc-normalize';
import { prisma } from './prisma';

/**
 * Feed de indicadores (item 5.3): o que o TAXII 2.1 e o feed MISP servem a quem integra (TIP,
 * SIEM, outro MISP). Decisao do dono: so indicadores de amostras MALICIOSAS ou SUSPEITAS, fora da
 * lixeira, e nunca os da lista de permitidos nem os dominios da empresa (com subdominios, e-mails
 * e URLs deles), para nao mandar a um SIEM o proprio dominio ou um hash limpo como ameaca.
 */

export const FEED_VERDICTS: Verdict[] = ['MALICIOUS', 'SUSPICIOUS'];

export interface FeedEntry {
  id: string;
  title: string;
  status: EntryStatus;
  verdict: Verdict;
  createdAt: Date;
  /** Ultima mudanca da amostra ou de um relatorio publicado dela. */
  modified: Date;
  iocs: CaseIoc[];
}

export interface FeedIndicator extends CaseIoc {
  verdict: Verdict;
  /** Quando apareceu pela primeira vez numa amostra que entra no feed. */
  firstSeen: Date;
  /** A ultima mudanca entre as amostras dele: e a "versao" no TAXII (date_added e modified). */
  modified: Date;
}

export interface FeedData {
  entries: FeedEntry[];
  indicators: FeedIndicator[];
  builtAt: Date;
}

/** Dominio da empresa (ou subdominio dele) no indicador? */
function companyMatch(domains: string[], kind: ExportKind, value: string): boolean {
  let host: string | null = null;
  if (kind === 'DOMAIN') host = value;
  else if (kind === 'EMAIL') host = value.split('@')[1] ?? null;
  else if (kind === 'URL') {
    const url = normalizeUrl(value);
    host = url ? new URL(url).hostname : null;
  }
  if (!host) return false;
  host = host.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

async function build(): Promise<FeedData> {
  const rows = await prisma.entry.findMany({
    where: { deletedAt: null, verdict: { in: FEED_VERDICTS } },
    select: {
      id: true,
      title: true,
      status: true,
      verdict: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const ids = rows.map((r) => r.id);
  const [iocs, reports, allowlist, company] = await Promise.all([
    entriesIocs(ids),
    // O relatorio publicado editado depois muda os indicadores da amostra.
    prisma.report.groupBy({
      by: ['entryId'],
      where: { entryId: { in: ids }, status: 'PUBLISHED' },
      _max: { updatedAt: true },
    }),
    loadAllowlist(),
    prisma.companyDomain.findMany({ select: { domain: true } }),
  ]);
  const companyDomains = company.map((c) => c.domain.toLowerCase());
  const reportUpdated = new Map(reports.map((r) => [r.entryId, r._max.updatedAt]));
  const entryById = new Map(
    rows.map((r) => {
      const report = reportUpdated.get(r.id);
      const modified = report && report > r.updatedAt ? report : r.updatedAt;
      return [r.id, { ...r, modified, iocs: [] as CaseIoc[] }];
    }),
  );

  const indicators: FeedIndicator[] = [];
  for (const ioc of iocs) {
    if (allowedBy(allowlist, ioc.kind, ioc.value)) continue;
    if (companyMatch(companyDomains, ioc.kind, ioc.value)) continue;
    const entries = ioc.entries.map((e) => entryById.get(e.id)).filter((e) => e !== undefined);
    if (!entries.length) continue;
    for (const e of entries) e.iocs.push(ioc);
    indicators.push({
      ...ioc,
      verdict: worstVerdict(entries.map((e) => e.verdict)),
      firstSeen: new Date(Math.min(...entries.map((e) => e.createdAt.getTime()))),
      modified: new Date(Math.max(...entries.map((e) => e.modified.getTime()))),
    });
  }
  return {
    entries: [...entryById.values()]
      .filter((e) => e.iocs.length)
      .map(({ updatedAt: _updated, ...e }) => e),
    indicators,
    builtAt: new Date(),
  };
}

/** Quem consulta de minuto em minuto (TIP, MISP) nao refaz a conta a cada pedido. */
const CACHE_MS = 60_000;
let cache: { at: number; value: Promise<FeedData> } | null = null;

export function feedData(): Promise<FeedData> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const value = build();
    cache = { at: Date.now(), value };
    value.catch(() => {
      if (cache?.value === value) cache = null;
    });
  }
  return cache.value;
}

/** Para os testes (e depois de uma mudanca que deve aparecer na hora). */
export function resetFeedCache(): void {
  cache = null;
}
