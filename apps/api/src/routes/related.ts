import type { FastifyInstance } from 'fastify';

import type { IocKind, Prisma } from '../generated/prisma/client';
import { allowedBy, loadAllowlist } from '../lib/allowlist';
import { ownerForViewer, requireUser, visibleEntries } from '../lib/auth';
import { baseDomain } from '../lib/domains';
import { iconDistance } from '../lib/icon-hash';
import { urlKey } from '../lib/ioc-normalize';
import { linkHostIndicator, linkIndicator } from '../lib/ioc-watch';
import { phashDistance, phashSimilarity } from '../lib/phash';
import { PIVOT_KINDS, type PivotKind } from '../lib/pivots';
import { prisma } from '../lib/prisma';
import { tlshDistance, tlshSimilarity } from '../lib/tlsh';

/** Maximo de amostras relacionadas devolvidas (as mais relevantes). */
export const RELATED_LIMIT = 50;
/** Candidatas lidas por criterio antes de pontuar. */
const CANDIDATES = 100;
/** Hashes TLSH comparados por consulta (os mais recentes). */
const SIMILAR_SCAN = 20_000;
/** Capturas comparadas pelo hash perceptual (as mais recentes) e a similaridade minima. */
const PAGE_SCAN = 5_000;
export const PAGE_MIN_SIMILARITY = 90;
/** Pivo por distancia com mais amostras que isto com o mesmo valor: generico demais para ligar. */
const GENERIC_PIVOT = 50;

export type RelatedReason =
  | { kind: 'SAME_SHA256' }
  | { kind: 'SAME_HOST'; detail: string }
  | { kind: 'SAME_BASE_DOMAIN'; detail: string }
  | { kind: 'SHARED_TAGS'; detail: string[] }
  | { kind: 'SHARED_IOCS'; detail: string[] }
  /** Arquivo parecido pelo TLSH (item 71): similaridade em % (100 - distancia). */
  | { kind: 'SIMILAR'; detail: number }
  /** Mesma tabela de importacoes (imphash, item 7.1). */
  | { kind: 'SAME_IMPHASH'; detail: string }
  /** Mesmo Rich header: mesmo ambiente de compilacao, ou cabecalho copiado (item 7.1). */
  | { kind: 'SAME_RICH'; detail: string }
  /** Pagina com a mesma aparencia (hash perceptual do print, revisao 3.4): similaridade em %. */
  | { kind: 'SIMILAR_PAGE'; detail: number }
  /**
   * Mesmo pivo (EntryPivot: PDB, authentihash...; plans/analise-estatica-ampliada). `distance` nos
   * que se comparam por proximidade (bits do icone, distancia do telfhash); 0 e igual.
   */
  | { kind: 'SAME_PIVOT'; detail: { pivot: PivotKind; value: string; distance?: number } }
  /** Funcoes parecidas pelo BSim do Ghidra (plans/analise-estatica-ampliada, item 23). */
  | { kind: 'SHARED_CODE'; detail: number };

/** Peso de cada motivo na ordenacao (arquivo identico pesa mais que uma tag). */
function weight(reason: RelatedReason): number {
  switch (reason.kind) {
    case 'SAME_SHA256':
      return 100;
    case 'SAME_HOST':
      return 60;
    case 'SAME_BASE_DOMAIN':
      return 40;
    case 'SHARED_TAGS':
      return 15 * reason.detail.length;
    case 'SHARED_IOCS':
      // Indicador em comum e evidencia forte; ate 3 contam.
      return 50 * Math.min(reason.detail.length, 3);
    case 'SIMILAR':
      // 100% parecida pesa quase como o mesmo arquivo.
      return Math.round(reason.detail * 0.9);
    case 'SAME_IMPHASH':
      return 45;
    case 'SAME_RICH':
      return 30;
    case 'SIMILAR_PAGE':
      // Mesma aparencia em outro dominio e indicio forte de mesmo kit; no mesmo dominio, o
      // motivo do dominio ja pesa por si.
      return Math.round(reason.detail * 0.6);
    case 'SHARED_CODE':
      // Cada funcao em comum conta; 10 ou mais valem quase o mesmo codigo.
      return 30 + 6 * Math.min(reason.detail, 10);
    case 'SAME_PIVOT': {
      const spec = PIVOT_KINDS[reason.detail.pivot];
      if (!spec) return 20;
      // Por distancia: o peso cai ate a metade no limite.
      const d = reason.detail.distance ?? 0;
      return 'max' in spec ? Math.round(spec.weight * (1 - d / (2 * spec.max))) : spec.weight;
    }
  }
}

const listInclude = {
  owner: { select: { id: true, displayName: true, email: true } },
  assignee: { select: { id: true, displayName: true } },
  tags: true,
  _count: { select: { reports: true } },
} satisfies Prisma.EntryInclude;

export type ListEntry = Prisma.EntryGetPayload<{ include: typeof listInclude }>;

/**
 * IOCs em comum (fase 2), por amostra: relatorios publicados de outras amostras
 * que citam um indicador dos relatorios desta (ou o proprio arquivo/dominio
 * desta), e amostras cujo arquivo/dominio aparece como IOC nos relatorios desta.
 */
async function sharedIocs(
  entryId: string,
  sha256: string | null,
  host: string | null,
  url: string | null,
): Promise<Map<string, Set<string>>> {
  const mine = await prisma.reportIoc.findMany({
    where: { entryId },
    select: { kind: true, value: true },
    distinct: ['kind', 'value'],
  });
  const ownHash = sha256?.toLowerCase() ?? null;
  const own: { kind: IocKind; value: string }[] = [];
  if (ownHash) own.push({ kind: 'SHA256', value: ownHash });
  // Host do link como dominio ou IP, e o proprio link (item 167).
  for (const ioc of [linkHostIndicator(host), linkIndicator(url)]) if (ioc) own.push(ioc);
  // Lista de permissoes (item 69): indicador legitimo nao liga amostras.
  const list = await loadAllowlist();
  const probes = [...mine, ...own].filter((p) => !allowedBy(list, p.kind, p.value));

  const matches = new Map<string, Set<string>>();
  const note = (otherId: string, value: string) => {
    if (otherId === entryId) return;
    const values = matches.get(otherId) ?? new Set<string>();
    values.add(value);
    matches.set(otherId, values);
  };

  if (probes.length) {
    const hits = await prisma.reportIoc.findMany({
      where: {
        entryId: { not: entryId },
        entry: { deletedAt: null },
        OR: probes.map((p) => ({ kind: p.kind, value: p.value })),
      },
      select: { entryId: true, value: true },
      take: 1000,
    });
    for (const hit of hits) note(hit.entryId, hit.value);
  }

  // O proprio arquivo/dominio ja vira "Mesmo arquivo"/"Mesmo dominio"; aqui so
  // os IOCs que apontam para OUTRA amostra.
  const usable = mine.filter((i) => !allowedBy(list, i.kind, i.value));
  const hashes = usable
    .filter((i) => i.kind === 'SHA256' && i.value !== ownHash)
    .map((i) => i.value);
  // Host de link como esta em urlDomain: dominio, IPv4, ou IPv6 entre colchetes.
  const hosts = new Map(
    usable
      .filter((i) => ['DOMAIN', 'IPV4', 'IPV6'].includes(i.kind))
      .map((i) => [i.kind === 'IPV6' ? `[${i.value}]` : i.value, i.value] as const)
      .filter(([stored]) => stored !== host),
  );
  // Links citados nos relatorios desta que sao o link de outra amostra (item 167).
  const links = new Map(
    usable.filter((i) => i.kind === 'URL').map((i) => [urlKey(i.value), i.value] as const),
  );
  if (hashes.length || hosts.size || links.size) {
    const direct = await prisma.entry.findMany({
      where: {
        id: { not: entryId },
        OR: [
          ...(hashes.length ? [{ sha256: { in: hashes } }] : []),
          ...(hosts.size ? [{ urlDomain: { in: [...hosts.keys()] } }] : []),
          ...(links.size ? [{ urlKey: { in: [...links.keys()] } }] : []),
        ],
      },
      select: { id: true, sha256: true, urlDomain: true, urlKey: true },
      take: CANDIDATES,
    });
    for (const d of direct) {
      if (d.sha256 && hashes.includes(d.sha256)) note(d.id, d.sha256);
      if (d.urlDomain && hosts.has(d.urlDomain)) note(d.id, hosts.get(d.urlDomain)!);
      if (d.urlKey && links.has(d.urlKey)) note(d.id, links.get(d.urlKey)!);
    }
  }
  return matches;
}

export interface RelatedItem {
  entry: ListEntry;
  reasons: RelatedReason[];
  score: number;
}

/**
 * Outras amostras com o mesmo arquivo (SHA-256), o mesmo dominio (host exato ou
 * mesmo dominio-base), tags ou IOCs em comum, ou arquivo parecido (TLSH). Cada
 * uma traz os motivos; ordem por relevancia e, no empate, mais recentes. Null se
 * a amostra nao existe. Usada pela aba Relacionadas e pelo Mapa (item 91).
 */
export async function findRelated(id: string, minSimilarity = 70): Promise<RelatedItem[] | null> {
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: {
      id: true,
      sha256: true,
      tlsh: true,
      imphash: true,
      richHash: true,
      url: true,
      urlDomain: true,
      tags: { select: { id: true, name: true } },
    },
  });
  if (!entry) return null;

  const notSelf = { id: { not: entry.id } };
  const host = entry.urlDomain?.toLowerCase() ?? null;
  // Dominio permitido (ex.: docs.google.com) nao liga amostras pelo dominio.
  const hostIoc = linkHostIndicator(host);
  const hostAllowed = hostIoc
    ? Boolean(allowedBy(await loadAllowlist(), hostIoc.kind, hostIoc.value))
    : false;
  const base = host && !hostAllowed ? baseDomain(host) : null;
  const tagIds = entry.tags.map((t) => t.id);

  // Mesmo imphash ou Rich header (item 7.1); o mesmo arquivo ja entra como "Mesmo arquivo".
  const samePe = (field: 'imphash' | 'richHash', value: string | null) =>
    value
      ? prisma.entry.findMany({
          where: {
            ...notSelf,
            [field]: value,
            ...(entry.sha256 ? { NOT: { sha256: entry.sha256 } } : {}),
          },
          include: listInclude,
          orderBy: { createdAt: 'desc' },
          take: CANDIDATES,
        })
      : Promise.resolve([] as ListEntry[]);

  const [sameFile, sameDomain, sharedTags, sameImphash, sameRich] = await Promise.all([
    entry.sha256
      ? prisma.entry.findMany({
          where: { ...notSelf, sha256: entry.sha256 },
          include: listInclude,
          orderBy: { createdAt: 'desc' },
          take: CANDIDATES,
        })
      : [],
    base
      ? prisma.entry.findMany({
          where: {
            ...notSelf,
            OR: [{ urlDomain: base }, { urlDomain: { endsWith: `.${base}` } }],
          },
          include: listInclude,
          orderBy: { createdAt: 'desc' },
          take: CANDIDATES,
        })
      : [],
    tagIds.length
      ? prisma.entry.findMany({
          where: { ...notSelf, tags: { some: { id: { in: tagIds } } } },
          include: listInclude,
          orderBy: { createdAt: 'desc' },
          take: CANDIDATES,
        })
      : [],
    samePe('imphash', entry.imphash),
    samePe('richHash', entry.richHash),
  ]);

  const found = new Map<string, { entry: ListEntry; reasons: RelatedReason[] }>();
  const add = (item: ListEntry, reason: RelatedReason) => {
    const current = found.get(item.id) ?? { entry: item, reasons: [] };
    current.reasons.push(reason);
    found.set(item.id, current);
  };

  for (const item of sameFile) add(item, { kind: 'SAME_SHA256' });
  for (const item of sameDomain) {
    const otherHost = item.urlDomain?.toLowerCase();
    if (!otherHost || !base) continue;
    if (otherHost === host) add(item, { kind: 'SAME_HOST', detail: otherHost });
    else add(item, { kind: 'SAME_BASE_DOMAIN', detail: base });
  }
  for (const item of sameImphash) add(item, { kind: 'SAME_IMPHASH', detail: entry.imphash! });
  for (const item of sameRich) add(item, { kind: 'SAME_RICH', detail: entry.richHash! });
  const myTags = new Map(entry.tags.map((t) => [t.id, t.name]));
  for (const item of sharedTags) {
    const common = item.tags.filter((t) => myTags.has(t.id)).map((t) => t.name);
    if (common.length) add(item, { kind: 'SHARED_TAGS', detail: common.sort() });
  }

  // Pivos em comum (EntryPivot): o mesmo PDB, authentihash... O mesmo arquivo ja e "Mesmo arquivo".
  // Os exatos numa consulta so; os por distancia (icone, telfhash) contra os mais recentes.
  const myPivots = await prisma.entryPivot.findMany({
    where: { entryId: entry.id },
    select: { kind: true, value: true },
  });
  const pivotHits: { entryId: string; kind: PivotKind; value: string; distance?: number }[] = [];
  const otherFile = entry.sha256 ? { NOT: { sha256: entry.sha256 } } : {};
  const exact = myPivots.filter((p) => PIVOT_KINDS[p.kind as PivotKind]?.match === 'exact');
  if (exact.length) {
    const hits = await prisma.entryPivot.findMany({
      where: {
        entryId: { not: entry.id },
        OR: exact.map((p) => ({ kind: p.kind, value: p.value })),
        entry: otherFile,
      },
      select: { entryId: true, kind: true, value: true },
      orderBy: { entry: { createdAt: 'desc' } },
      take: CANDIDATES * exact.length,
    });
    for (const h of hits) pivotHits.push({ ...h, kind: h.kind as PivotKind });
  }
  for (const mine of myPivots) {
    const spec = PIVOT_KINDS[mine.kind as PivotKind];
    if (!spec || spec.match === 'exact') continue;
    // Icone que dezenas de amostras usam (o padrao do Visual Studio, de um instalador) nao liga.
    const twins = await prisma.entryPivot.count({
      where: { kind: mine.kind, value: mine.value },
    });
    if (twins > GENERIC_PIVOT) continue;
    const others = await prisma.entryPivot.findMany({
      where: { kind: mine.kind, entryId: { not: entry.id }, entry: otherFile },
      select: { entryId: true, value: true },
      orderBy: { entry: { createdAt: 'desc' } },
      take: SIMILAR_SCAN,
    });
    const near = others
      .map((o) => ({
        ...o,
        distance:
          spec.match === 'hamming'
            ? iconDistance(mine.value, o.value)
            : tlshDistance(mine.value, o.value),
      }))
      .filter((o): o is typeof o & { distance: number } => o.distance !== null)
      .filter((o) => o.distance <= spec.max)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, CANDIDATES);
    for (const o of near) pivotHits.push({ ...o, kind: mine.kind as PivotKind });
  }
  if (pivotHits.length) {
    const known = new Map([...found.values()].map((r) => [r.entry.id, r.entry]));
    const missing = [...new Set(pivotHits.map((h) => h.entryId))].filter((eid) => !known.has(eid));
    if (missing.length) {
      const extra = await prisma.entry.findMany({
        where: { id: { in: missing } },
        include: listInclude,
      });
      for (const item of extra) known.set(item.id, item);
    }
    for (const hit of pivotHits) {
      const item = known.get(hit.entryId);
      if (!item) continue;
      add(item, {
        kind: 'SAME_PIVOT',
        detail: {
          pivot: hit.kind,
          value: hit.value,
          ...(hit.distance !== undefined ? { distance: hit.distance } : {}),
        },
      });
    }
  }

  // IOCs em comum: as amostras que ainda nao vieram por outro motivo sao lidas
  // aqui (as com mais indicadores em comum primeiro).
  const iocMatches = await sharedIocs(entry.id, entry.sha256, host, entry.url);
  if (iocMatches.size) {
    const known = new Map([...found.values()].map((r) => [r.entry.id, r.entry]));
    const missing = [...iocMatches.entries()]
      .filter(([otherId]) => !known.has(otherId))
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, CANDIDATES)
      .map(([otherId]) => otherId);
    if (missing.length) {
      const extra = await prisma.entry.findMany({
        where: { id: { in: missing } },
        include: listInclude,
      });
      for (const item of extra) known.set(item.id, item);
    }
    for (const [otherId, values] of iocMatches) {
      const item = known.get(otherId);
      if (item) add(item, { kind: 'SHARED_IOCS', detail: [...values].sort() });
    }
  }

  // Parecidas pelo TLSH (item 71): compara com os hashes ja calculados.
  if (entry.tlsh) {
    const others = await prisma.entry.findMany({
      where: { id: { not: entry.id }, tlsh: { not: null }, NOT: { tlsh: '' } },
      select: { id: true, tlsh: true, sha256: true },
      take: SIMILAR_SCAN,
      orderBy: { createdAt: 'desc' },
    });
    const similar = others
      .filter((o) => !entry.sha256 || o.sha256 !== entry.sha256)
      .map((o) => ({ id: o.id, distance: tlshDistance(entry.tlsh!, o.tlsh!) }))
      .filter((o): o is { id: string; distance: number } => o.distance !== null)
      .map((o) => ({ id: o.id, similarity: tlshSimilarity(o.distance) }))
      .filter((o) => o.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, CANDIDATES);
    if (similar.length) {
      const known = new Map([...found.values()].map((r) => [r.entry.id, r.entry]));
      const missing = similar.map((s) => s.id).filter((sid) => !known.has(sid));
      if (missing.length) {
        const extra = await prisma.entry.findMany({
          where: { id: { in: missing } },
          include: listInclude,
        });
        for (const item of extra) known.set(item.id, item);
      }
      for (const s of similar) {
        const item = known.get(s.id);
        if (item) add(item, { kind: 'SIMILAR', detail: s.similarity });
      }
    }
  }

  // Codigo compartilhado pelo BSim (item 23), nos dois sentidos: as amostras que a analise desta
  // achou e as que, analisadas depois, acharam esta.
  if (entry.sha256) {
    const counts = new Map<string, number>();
    const own = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: entry.id },
      select: { summary: true },
    });
    const ownShared =
      (own?.summary as { bsim?: { shared?: { sha256: string; functions: number }[] } } | null)?.bsim
        ?.shared ?? [];
    for (const s of ownShared)
      counts.set(s.sha256, Math.max(counts.get(s.sha256) ?? 0, s.functions));
    const reverse = await prisma.$queryRaw<{ sha256: string | null; functions: number }[]>`
      SELECT e."sha256", (item->>'functions')::int AS functions
      FROM "GhidraAnalysis" g
      JOIN "Entry" e ON e."id" = g."entryId"
      CROSS JOIN LATERAL jsonb_array_elements(g."summary"->'bsim'->'shared') AS item
      WHERE g."summary"->'bsim'->'shared' @> ${JSON.stringify([{ sha256: entry.sha256 }])}::jsonb
        AND item->>'sha256' = ${entry.sha256}
      LIMIT ${CANDIDATES}`;
    for (const r of reverse) {
      if (r.sha256) counts.set(r.sha256, Math.max(counts.get(r.sha256) ?? 0, r.functions));
    }
    counts.delete(entry.sha256);
    if (counts.size) {
      const others = await prisma.entry.findMany({
        where: { id: { not: entry.id }, deletedAt: null, sha256: { in: [...counts.keys()] } },
        include: listInclude,
        take: CANDIDATES,
      });
      for (const item of others) {
        const n = counts.get(item.sha256 ?? '');
        if (n) add(item, { kind: 'SHARED_CODE', detail: n });
      }
    }
  }

  // Paginas com a mesma aparencia (revisao 3.4): o print mais recente desta amostra contra os
  // das outras. Liga o mesmo kit de phishing em dominios diferentes.
  const mine = await prisma.pageCapture.findFirst({
    where: { entryId: entry.id, status: 'DONE', screenshotHash: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { screenshotHash: true },
  });
  if (mine?.screenshotHash) {
    const captures = await prisma.pageCapture.findMany({
      where: { entryId: { not: entry.id }, status: 'DONE', screenshotHash: { not: null } },
      select: { entryId: true, screenshotHash: true },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SCAN,
    });
    // Uma amostra pode ter varias capturas: vale a mais parecida.
    const best = new Map<string, number>();
    for (const c of captures) {
      const distance = phashDistance(mine.screenshotHash, c.screenshotHash!);
      if (distance === null) continue;
      const similarity = phashSimilarity(distance);
      if (similarity >= PAGE_MIN_SIMILARITY && similarity > (best.get(c.entryId) ?? 0)) {
        best.set(c.entryId, similarity);
      }
    }
    const ids = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES);
    if (ids.length) {
      const known = new Map([...found.values()].map((r) => [r.entry.id, r.entry]));
      const missing = ids.map(([eid]) => eid).filter((eid) => !known.has(eid));
      if (missing.length) {
        const extra = await prisma.entry.findMany({
          where: { id: { in: missing } },
          include: listInclude,
        });
        for (const item of extra) known.set(item.id, item);
      }
      for (const [eid, similarity] of ids) {
        const item = known.get(eid);
        if (item) add(item, { kind: 'SIMILAR_PAGE', detail: similarity });
      }
    }
  }

  return [...found.values()]
    .map((r) => ({ ...r, score: r.reasons.reduce((sum, reason) => sum + weight(reason), 0) }))
    .sort((a, b) => b.score - a.score || b.entry.createdAt.getTime() - a.entry.createdAt.getTime());
}

/** Aba "Relacionadas" da amostra (ver findRelated). */
export async function relatedRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/related', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    // Similaridade minima do TLSH (padrao 70%, ou seja, distancia ate 30).
    const minSimilarity = Math.min(
      99,
      Math.max(50, Number((req.query as { similarity?: string }).similarity) || 70),
    );
    const found = await findRelated(id, minSimilarity);
    if (!found) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const { ownerId } = await visibleEntries(user);
    const items = ownerId ? found.filter((r) => r.entry.owner.id === ownerId) : found;

    return reply.send({
      items: items
        .slice(0, RELATED_LIMIT)
        .map((r) => ({ ...r, entry: ownerForViewer(r.entry, user) })),
      total: items.length,
      limit: RELATED_LIMIT,
    });
  });
}
