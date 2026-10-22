import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

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
  | { kind: 'SHARED_TAGS'; detail: string[] };

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
 * Aba "Relacionadas" da amostra: outras amostras com o mesmo arquivo (SHA-256),
 * o mesmo dominio (host exato ou mesmo dominio-base) ou tags em comum. Cada
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
