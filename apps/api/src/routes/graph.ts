import type { FastifyInstance } from 'fastify';

import type { EntryStatus, EntryType, IocKind, Verdict } from '../generated/prisma/client';
import { allowedBy, loadAllowlist } from '../lib/allowlist';
import { isAnalyst, requireUser, visibleEntries } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { caseCode } from './cases';
import { findRelated, type RelatedReason } from './related';

/** Limites de nos por tipo em cada nivel (o resto vira "+N"). */
export const GRAPH_LIMITS = { entries: 12, iocs: 12, cases: 8, caseEntries: 20, caseIocs: 15 };

export type GraphNode =
  | {
      id: string;
      kind: 'ENTRY';
      label: string;
      entryId: string;
      type: EntryType;
      status: EntryStatus;
      verdict: Verdict;
    }
  | { id: string; kind: 'IOC'; label: string; iocKind: IocKind; value: string }
  | { id: string; kind: 'CASE'; label: string; caseId: string; code: string };

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface Graph {
  /** No de onde o desenho parte (a amostra ou o caso pedido). */
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Quantos ficaram de fora pelos limites (o front mostra "+N"). */
  hidden: { entries: number; iocs: number; cases: number };
}

const entryNodeId = (id: string) => `entry:${id}`;
const iocNodeId = (kind: string, value: string) => `ioc:${kind}:${value}`;
const caseNodeId = (id: string) => `case:${id}`;

type EntryLike = {
  id: string;
  title: string;
  type: EntryType;
  status: EntryStatus;
  verdict: Verdict;
};
const entryNode = (e: EntryLike): GraphNode => ({
  id: entryNodeId(e.id),
  kind: 'ENTRY',
  label: e.title,
  entryId: e.id,
  type: e.type,
  status: e.status,
  verdict: e.verdict,
});
const entrySelect = { id: true, title: true, type: true, status: true, verdict: true } as const;

/** Rotulo da ligacao entre duas amostras (tags sozinhas nao entram no mapa). */
function reasonLabel(reason: RelatedReason): string | null {
  switch (reason.kind) {
    case 'SAME_SHA256':
      return 'mesmo arquivo';
    case 'SIMILAR':
      return `parecido ${reason.detail}%`;
    case 'SAME_HOST':
    case 'SAME_BASE_DOMAIN':
      return `mesmo domínio ${reason.detail}`;
    case 'SHARED_IOCS':
      return 'indicador em comum';
    case 'SAME_IMPHASH':
      return 'mesmas importações';
    case 'SAME_RICH':
      return 'mesmo Rich header';
    case 'SIMILAR_PAGE':
      return `página parecida ${reason.detail}%`;
    case 'SAME_PIVOT':
      switch (reason.detail.pivot) {
        case 'PDB_PATH':
          return 'mesmo caminho de PDB';
        case 'PDB_ID':
          return 'mesma compilação (GUID do PDB)';
      }
      return null;
    case 'SHARED_TAGS':
      return null;
  }
}

/** Indicadores dos relatorios publicados, sem os da lista de permissoes. */
async function publishedIocs(entryIds: string[]) {
  const [rows, list] = await Promise.all([
    prisma.reportIoc.findMany({
      where: { entryId: { in: entryIds } },
      select: { entryId: true, kind: true, value: true },
      distinct: ['entryId', 'kind', 'value'],
      orderBy: [{ kind: 'asc' }, { value: 'asc' }],
    }),
    loadAllowlist(),
  ]);
  return rows.filter((r) => !allowedBy(list, r.kind, r.value));
}

/**
 * Mapa de uma amostra (item 91): ela no centro, os indicadores dos relatorios
 * publicados, as amostras ligadas (mesmo arquivo, parecido, mesmo dominio,
 * indicador em comum, que se liga ao indicador quando ele esta no mapa) e os
 * casos (so para analistas). Null se a amostra nao existe.
 */
export async function entryGraph(
  id: string,
  withCases: boolean,
  onlyOwner?: string,
): Promise<Graph | null> {
  const entry = await prisma.entry.findFirst({
    where: { id, deletedAt: null },
    select: entrySelect,
  });
  if (!entry) return null;
  const center = entryNodeId(entry.id);
  const nodes = new Map<string, GraphNode>([[center, entryNode(entry)]]);
  const edges: GraphEdge[] = [];
  const hidden = { entries: 0, iocs: 0, cases: 0 };

  const iocs = await publishedIocs([entry.id]);
  hidden.iocs = Math.max(0, iocs.length - GRAPH_LIMITS.iocs);
  for (const ioc of iocs.slice(0, GRAPH_LIMITS.iocs)) {
    const nid = iocNodeId(ioc.kind, ioc.value);
    nodes.set(nid, { id: nid, kind: 'IOC', label: ioc.value, iocKind: ioc.kind, value: ioc.value });
    edges.push({ from: center, to: nid, label: 'indicador' });
  }

  const related = ((await findRelated(entry.id)) ?? [])
    .filter((r) => !r.entry.deletedAt && (!onlyOwner || r.entry.owner.id === onlyOwner))
    .map((r) => ({ ...r, labels: r.reasons.map(reasonLabel).filter(Boolean) as string[] }))
    .filter((r) => r.labels.length);
  hidden.entries = Math.max(0, related.length - GRAPH_LIMITS.entries);
  for (const r of related.slice(0, GRAPH_LIMITS.entries)) {
    const nid = entryNodeId(r.entry.id);
    nodes.set(nid, entryNode(r.entry));
    // Indicador em comum que ja esta no mapa: a ligacao passa por ele.
    const shared = r.reasons.find((x) => x.kind === 'SHARED_IOCS');
    const viaIoc = shared
      ? [...nodes.values()].filter(
          (n) => n.kind === 'IOC' && (shared.detail as string[]).includes(n.value),
        )
      : [];
    for (const ioc of viaIoc) edges.push({ from: nid, to: ioc.id, label: 'indicador' });
    const direct = r.labels.filter((l) => l !== 'indicador em comum' || !viaIoc.length);
    if (direct.length) edges.push({ from: center, to: nid, label: direct.join(', ') });
  }

  if (withCases) {
    const links = await prisma.caseEntry.findMany({
      where: { entryId: entry.id },
      select: { case: { select: { id: true, number: true, title: true } } },
      orderBy: { addedAt: 'desc' },
    });
    hidden.cases = Math.max(0, links.length - GRAPH_LIMITS.cases);
    for (const { case: c } of links.slice(0, GRAPH_LIMITS.cases)) {
      const nid = caseNodeId(c.id);
      const code = caseCode(c.number);
      nodes.set(nid, { id: nid, kind: 'CASE', label: `${code} · ${c.title}`, caseId: c.id, code });
      edges.push({ from: center, to: nid, label: 'no caso' });
    }
  }
  return { center, nodes: [...nodes.values()], edges, hidden };
}

/**
 * Mapa de um caso (item 91): o caso no centro, as amostras dele e os
 * indicadores, primeiro os que ligam mais de uma amostra. Null se nao existe.
 */
export async function caseGraph(id: string): Promise<Graph | null> {
  const c = await prisma.case.findUnique({
    where: { id },
    select: { id: true, number: true, title: true },
  });
  if (!c) return null;
  const center = caseNodeId(c.id);
  const code = caseCode(c.number);
  const nodes = new Map<string, GraphNode>([
    [center, { id: center, kind: 'CASE', label: `${code} · ${c.title}`, caseId: c.id, code }],
  ]);
  const edges: GraphEdge[] = [];
  const hidden = { entries: 0, iocs: 0, cases: 0 };

  const links = await prisma.caseEntry.findMany({
    where: { caseId: c.id, entry: { deletedAt: null } },
    select: { entry: { select: entrySelect } },
    orderBy: { addedAt: 'asc' },
  });
  hidden.entries = Math.max(0, links.length - GRAPH_LIMITS.caseEntries);
  const shown = links.slice(0, GRAPH_LIMITS.caseEntries).map((l) => l.entry);
  for (const e of shown) {
    nodes.set(entryNodeId(e.id), entryNode(e));
    edges.push({ from: center, to: entryNodeId(e.id), label: 'no caso' });
  }

  // Indicadores: os que ligam mais amostras primeiro.
  const byIoc = new Map<string, { kind: IocKind; value: string; entryIds: string[] }>();
  for (const row of await publishedIocs(shown.map((e) => e.id))) {
    const key = iocNodeId(row.kind, row.value);
    const item = byIoc.get(key) ?? { kind: row.kind, value: row.value, entryIds: [] };
    item.entryIds.push(row.entryId);
    byIoc.set(key, item);
  }
  const ranked = [...byIoc.entries()].sort(
    (a, b) => b[1].entryIds.length - a[1].entryIds.length || a[0].localeCompare(b[0]),
  );
  hidden.iocs = Math.max(0, ranked.length - GRAPH_LIMITS.caseIocs);
  for (const [nid, ioc] of ranked.slice(0, GRAPH_LIMITS.caseIocs)) {
    nodes.set(nid, { id: nid, kind: 'IOC', label: ioc.value, iocKind: ioc.kind, value: ioc.value });
    for (const entryId of ioc.entryIds) {
      edges.push({ from: entryNodeId(entryId), to: nid, label: 'indicador' });
    }
  }
  return { center, nodes: [...nodes.values()], edges, hidden };
}

/** Mapa de relacoes (item 91): amostra (todos) e caso (analistas). */
export async function graphRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/graph', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // Casos sao so dos analistas: o usuario comum ve o mapa sem eles.
    const { ownerId } = await visibleEntries(user);
    const graph = await entryGraph(id, isAnalyst(user), ownerId);
    if (!graph) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    return reply.send(graph);
  });

  app.get('/api/cases/:id/graph', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas trabalham com casos.' });
    }
    const { id } = req.params as { id: string };
    const graph = await caseGraph(id);
    if (!graph) return reply.code(404).send({ error: 'Caso não encontrado.' });
    return reply.send(graph);
  });
}
