import type { FastifyInstance } from 'fastify';

import type { IocKind, Prisma } from '../generated/prisma/client';
import { requireUser } from '../lib/auth';
import { baseDomain } from '../lib/domains';
import { prisma } from '../lib/prisma';

/** Maximo de amostras relacionadas devolvidas (as mais relevantes). */
export const RELATED_LIMIT = 50;
/** Candidatas lidas por criterio antes de pontuar. */
const CANDIDATES = 100;

export type RelatedReason =
  | { kind: 'SAME_SHA256' }
  | { kind: 'SAME_HOST'; detail: string }
  | { kind: 'SAME_BASE_DOMAIN'; detail: string }
  | { kind: 'SHARED_TAGS'; detail: string[] }
  | { kind: 'SHARED_IOCS'; detail: string[] };

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
  }
}

const listInclude = {
  owner: { select: { id: true, displayName: true, email: true } },
  assignee: { select: { id: true, displayName: true } },
  tags: true,
  _count: { select: { reports: true } },
} satisfies Prisma.EntryInclude;

type ListEntry = Prisma.EntryGetPayload<{ include: typeof listInclude }>;

/**
 * IOCs em comum (fase 2), por amostra: relatorios publicados de outras amostras
 * que citam um indicador dos relatorios desta (ou o proprio arquivo/dominio
 * desta), e amostras cujo arquivo/dominio aparece como IOC nos relatorios desta.
 */
async function sharedIocs(
  entryId: string,
  sha256: string | null,
  host: string | null,
): Promise<Map<string, Set<string>>> {
  const mine = await prisma.reportIoc.findMany({
    where: { entryId },
    select: { kind: true, value: true },
    distinct: ['kind', 'value'],
  });
  const ownHash = sha256?.toLowerCase() ?? null;
  const own: { kind: IocKind; value: string }[] = [];
  if (ownHash) own.push({ kind: 'SHA256', value: ownHash });
  if (host) own.push({ kind: 'DOMAIN', value: host });
  const probes = [...mine, ...own];

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
  const hashes = mine.filter((i) => i.kind === 'SHA256' && i.value !== ownHash).map((i) => i.value);
  const domains = mine.filter((i) => i.kind === 'DOMAIN' && i.value !== host).map((i) => i.value);
  if (hashes.length || domains.length) {
    const direct = await prisma.entry.findMany({
      where: {
        id: { not: entryId },
        OR: [
          ...(hashes.length ? [{ sha256: { in: hashes } }] : []),
          ...(domains.length ? [{ urlDomain: { in: domains } }] : []),
        ],
      },
      select: { id: true, sha256: true, urlDomain: true },
      take: CANDIDATES,
    });
    for (const d of direct) {
      if (d.sha256 && hashes.includes(d.sha256)) note(d.id, d.sha256);
      if (d.urlDomain && domains.includes(d.urlDomain)) note(d.id, d.urlDomain);
    }
  }
  return matches;
}

/**
 * Aba "Relacionadas" da amostra: outras amostras com o mesmo arquivo (SHA-256),
 * o mesmo dominio (host exato ou mesmo dominio-base), tags ou IOCs em comum. Cada
 * linha traz os motivos; ordem por relevancia e, no empate, mais recentes.
 */
export async function relatedRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/related', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: {
        id: true,
        sha256: true,
        urlDomain: true,
        tags: { select: { id: true, name: true } },
      },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });

    const notSelf = { id: { not: entry.id } };
    const host = entry.urlDomain?.toLowerCase() ?? null;
    const base = host ? baseDomain(host) : null;
    const tagIds = entry.tags.map((t) => t.id);

    const [sameFile, sameDomain, sharedTags] = await Promise.all([
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
    const myTags = new Map(entry.tags.map((t) => [t.id, t.name]));
    for (const item of sharedTags) {
      const common = item.tags.filter((t) => myTags.has(t.id)).map((t) => t.name);
      if (common.length) add(item, { kind: 'SHARED_TAGS', detail: common.sort() });
    }

    // IOCs em comum: as amostras que ainda nao vieram por outro motivo sao lidas
    // aqui (as com mais indicadores em comum primeiro).
    const iocMatches = await sharedIocs(entry.id, entry.sha256, host);
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

    const items = [...found.values()]
      .map((r) => ({ ...r, score: r.reasons.reduce((sum, reason) => sum + weight(reason), 0) }))
      .sort(
        (a, b) => b.score - a.score || b.entry.createdAt.getTime() - a.entry.createdAt.getTime(),
      );

    return reply.send({
      items: items.slice(0, RELATED_LIMIT),
      total: items.length,
      limit: RELATED_LIMIT,
    });
  });
}
