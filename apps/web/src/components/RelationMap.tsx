import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, EntryType, IocKind, Verdict } from '../api/types';
import { t } from '../i18n/analysis';
import { HpsmSection } from './HpsmForm';
import { iocHref } from './iocs';
import { HpsmLoading, HpsmMessage } from './messages';
import { VerdictTag } from './tags';

/** Resposta de GET /api/entries/:id/graph e /api/cases/:id/graph (item 91). */
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
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: { entries: number; iocs: number; cases: number };
}

interface Point {
  x: number;
  y: number;
}

/** Distancia dos vizinhos ao centro e a uma amostra expandida. */
const RING = 200;
const BRANCH = 130;
/** Distancia minima entre dois nos depois de acomodar os novos. */
const GAP = 64;

const VERDICT_COLOR: Record<Verdict, string> = {
  MALICIOUS: 'var(--dl-status-red)',
  SUSPICIOUS: 'var(--dl-status-orange)',
  CLEAN: 'var(--dl-status-green)',
  UNKNOWN: 'var(--dl-status-gray)',
};

const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function nodeHref(node: GraphNode): string {
  if (node.kind === 'ENTRY') return `/entries/${node.entryId}`;
  if (node.kind === 'CASE') return `/casos/${node.caseId}`;
  return iocHref(node.iocKind, node.value);
}

/** "+3 amostras, +2 indicadores" (o que ficou de fora pelos limites). */
function hiddenText(hidden: Graph['hidden']): string | null {
  const parts = [
    hidden.entries && t('hiddenEntries', { n: hidden.entries }),
    hidden.iocs && t('hiddenIocsMap', { n: hidden.iocs }),
    hidden.cases && t('hiddenCases', { n: hidden.cases }),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Posicoes estaveis: quem ja estava fica onde estava; os novos vao num anel em
 * volta de quem os trouxe (o centro, ou a amostra expandida, num arco voltado
 * para fora) e depois se afastam dos vizinhos ate nao sobrepor.
 */
function layout(
  center: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  previous: Map<string, Point>,
): Map<string, Point> {
  const pos = new Map(previous);
  if (!pos.has(center)) pos.set(center, { x: 0, y: 0 });
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    neighbors.set(e.from, [...(neighbors.get(e.from) ?? []), e.to]);
    neighbors.set(e.to, [...(neighbors.get(e.to) ?? []), e.from]);
  }
  const fresh = new Set<string>();
  // Em largura a partir dos ja posicionados.
  let frontier = [...pos.keys()];
  while (frontier.length) {
    const next: string[] = [];
    for (const parent of frontier) {
      const kids = (neighbors.get(parent) ?? []).filter((id) => !pos.has(id));
      if (!kids.length) continue;
      const p = pos.get(parent)!;
      const isCenter = parent === center;
      const away = Math.atan2(p.y, p.x);
      kids.forEach((id, i) => {
        const angle = isCenter
          ? (2 * Math.PI * i) / kids.length - Math.PI / 2
          : away + (kids.length === 1 ? 0 : (i / (kids.length - 1) - 0.5) * (Math.PI * 1.1));
        const r = isCenter ? RING : BRANCH;
        pos.set(id, { x: p.x + r * Math.cos(angle), y: p.y + r * Math.sin(angle) });
        fresh.add(id);
        next.push(id);
      });
    }
    frontier = next;
  }
  // Sem ligacao com o desenho (nao deveria acontecer): numa linha abaixo.
  nodes
    .filter((n) => !pos.has(n.id))
    .forEach((n, i) => {
      pos.set(n.id, { x: -RING + i * GAP, y: RING * 1.6 });
      fresh.add(n.id);
    });
  // So os novos se mexem, para nao desmontar o que a pessoa ja leu.
  for (let round = 0; round < 60; round++) {
    let moved = false;
    for (const id of fresh) {
      const a = pos.get(id)!;
      for (const [other, b] of pos) {
        if (other === id) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < GAP) {
          const push = (GAP - dist) / 2;
          a.x += (dx / dist) * push + (dist === 0.01 ? 1 : 0);
          a.y += (dy / dist) * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pos;
}

/**
 * Mapa de relacoes (item 91) de uma amostra ou de um caso: desenho com o centro,
 * indicadores, amostras ligadas (cor pelo veredito) e casos; clicar abre a
 * ficha. A lista ao lado e o equivalente pelo teclado e tem o "Expandir", que
 * traz as ligacoes de uma amostra para o mesmo desenho.
 */
export function RelationMap({ source, id }: { source: 'entry' | 'case'; id: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: [source, id, 'graph'],
    queryFn: () => api.get<Graph>(`/${source === 'entry' ? 'entries' : 'cases'}/${id}/graph`),
  });
  const [extra, setExtra] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const positions = useRef(new Map<string, Point>());

  // Recarregou o centro: recomeca o desenho.
  useEffect(() => {
    setExtra({ nodes: [], edges: [] });
    setExpanded({});
    positions.current = new Map();
  }, [query.data]);

  const graph = useMemo(() => {
    const base = query.data;
    if (!base) return null;
    const nodes = new Map(base.nodes.map((n) => [n.id, n]));
    for (const n of extra.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    const seen = new Set<string>();
    const edges = [...base.edges, ...extra.edges].filter((e) => {
      const key = [e.from, e.to].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const list = [...nodes.values()];
    positions.current = layout(base.center, list, edges, positions.current);
    return { center: base.center, nodes: list, edges, pos: positions.current };
  }, [query.data, extra]);

  const expand = async (node: Extract<GraphNode, { kind: 'ENTRY' }>) => {
    setError(null);
    setBusy(node.id);
    try {
      const more = await api.get<Graph>(`/entries/${node.entryId}/graph`);
      setExtra((current) => ({
        nodes: [...current.nodes, ...more.nodes],
        edges: [...current.edges, ...more.edges],
      }));
      setExpanded((current) => ({ ...current, [node.id]: hiddenText(more.hidden) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (query.isLoading) return <HpsmLoading text={t('buildingMap')} />;
  if (query.isError || !graph || !query.data) {
    return (
      <HpsmMessage kind="error">
        {(query.error as Error | null)?.message ?? t('mapFailed')}
      </HpsmMessage>
    );
  }

  const { center, nodes, edges, pos } = graph;
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const pad = 70;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + pad;
  // Por que a amostra esta no mapa, com a outra ponta de cada ligacao
  // ("indicador evil.top; mesmo arquivo (fatura.exe)").
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linked = (nodeId: string) =>
    edges
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => {
        const other = byId.get(e.from === nodeId ? e.to : e.from);
        if (!other || other.kind === 'CASE') return null;
        return other.kind === 'IOC' ? `indicador ${other.value}` : `${e.label} (${other.label})`;
      })
      .filter(Boolean)
      .join('; ');
  const groups = [
    { kind: 'ENTRY', title: t('groupEntries') },
    { kind: 'IOC', title: t('groupIocs') },
    { kind: 'CASE', title: t('groupCases') },
  ] as const;
  const hidden = hiddenText(query.data.hidden);

  if (nodes.length === 1) {
    return <p className="dl-static-empty">{t(source === 'entry' ? 'noLinksEntry' : 'noLinks')}</p>;
  }

  return (
    <div className="dl-map">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <div className="dl-map__canvas">
        <svg
          role="img"
          aria-label={t('mapAria', { n: nodes.length })}
          viewBox={`${minX} ${minY} ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const showLabel = e.label !== 'indicador' && e.label !== 'no caso';
            return (
              <g key={`${e.from}|${e.to}`} className="dl-map__edge">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                  <title>{e.label}</title>
                </line>
                {showLabel && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
                    {short(e.label, 26)}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const isCenter = n.id === center;
            const kindLabel =
              n.kind === 'ENTRY' ? t('kindSample') : n.kind === 'CASE' ? t('kindCase') : n.iocKind;
            return (
              <g
                key={n.id}
                className={`dl-map__node dl-map__node--${n.kind.toLowerCase()}${isCenter ? ' is-center' : ''}`}
                data-node={n.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={isCenter ? undefined : () => navigate(nodeHref(n))}
              >
                <title>{`${kindLabel}: ${n.label}`}</title>
                {n.kind === 'ENTRY' && (
                  <circle r={isCenter ? 20 : 14} style={{ fill: VERDICT_COLOR[n.verdict] }} />
                )}
                {n.kind === 'IOC' && (
                  <rect x={-9} y={-9} width={18} height={18} transform="rotate(45)" />
                )}
                {n.kind === 'CASE' && (
                  <rect
                    x={isCenter ? -18 : -14}
                    y={-10}
                    width={isCenter ? 36 : 28}
                    height={20}
                    rx={3}
                  />
                )}
                <text y={isCenter ? 34 : 28} textAnchor="middle">
                  {short(n.kind === 'CASE' ? n.code : n.label)}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="dl-map__legend">
          <span className="dl-map__key dl-map__key--malicious">{t('vMalicious')}</span>
          <span className="dl-map__key dl-map__key--suspicious">{t('vSuspicious')}</span>
          <span className="dl-map__key dl-map__key--clean">{t('vClean')}</span>
          <span className="dl-map__key dl-map__key--unknown">{t('vUnknown')}</span>
          <span className="dl-map__key dl-map__key--ioc">{t('indicator')}</span>
          <span className="dl-map__key dl-map__key--case">{t('kindCase')}</span>
          {hidden && <span className="dl-map__hidden">{t('notShown', { list: hidden })}</span>}
        </p>
      </div>
      <div className="dl-map__list">
        {groups.map(({ kind, title }) => {
          const items = nodes.filter((n) => n.kind === kind);
          if (!items.length) return null;
          return (
            <HpsmSection key={kind} title={`${title} (${items.length})`}>
              <ul>
                {items.map((n) => (
                  <li key={n.id} data-node={n.id}>
                    {n.id === center ? (
                      <strong>{t('thisOne', { label: n.label })}</strong>
                    ) : (
                      <Link className="dl-link" to={nodeHref(n)}>
                        {n.kind === 'IOC' ? `${n.iocKind} ${n.value}` : n.label}
                      </Link>
                    )}
                    {n.kind === 'ENTRY' && (
                      <>
                        {' '}
                        <VerdictTag verdict={n.verdict} />
                      </>
                    )}
                    {n.id !== center && linked(n.id) && (
                      <span className="dl-map__why">{linked(n.id)}</span>
                    )}
                    {n.kind === 'ENTRY' && n.id !== center && (
                      <span className="dl-map__expand">
                        {n.id in expanded ? (
                          <span className="dl-map__done">
                            {t('expanded')}
                            {expanded[n.id] ? ` ${t('notShownParen', { n: expanded[n.id] })}` : ''}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="dl-link-button"
                            disabled={busy !== null}
                            onClick={() => void expand(n)}
                          >
                            {busy === n.id ? t('expanding') : t('expand')}
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </HpsmSection>
          );
        })}
      </div>
    </div>
  );
}
