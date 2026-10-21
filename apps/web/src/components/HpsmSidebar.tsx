import { useQuery } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import type { IconComponent } from './icons';
import { IconAdd, IconFolder, IconHistory, IconHome, IconKey, IconPage } from './icons';
import type { StatusTone } from './tags';

interface SidebarProps {
  /** Controle do drawer no mobile (a sidebar fica off-canvas). */
  open: boolean;
  /** Fecha o drawer apos navegar (mobile). */
  onNavigate?: () => void;
}

interface NavLeaf {
  to: string;
  label: string;
  /** Icone 16px; filas usam a bolinha de status (`tone`) no lugar. */
  icon?: IconComponent;
  tone?: StatusTone;
  /** Contador da fila: um status ou `mine` (atribuidas a mim e abertas). */
  count?: EntryStatus | 'mine';
}

interface NavFolder {
  id: string;
  label: string;
  /** Quem ve a pasta: analistas/admins (`triage`) ou so admins (`admin`). */
  access?: 'triage' | 'admin';
  children: NavLeaf[];
}

/* Itens soltos no topo da arvore, antes das pastas. */
const ROOT_LEAVES: NavLeaf[] = [{ to: '/inicio', label: 'Página Inicial', icon: IconHome }];

/* Arvore do "Navegador do Sistema": pastas com as telas da aplicacao. */
const TREE: NavFolder[] = [
  {
    // Filas de trabalho dos analistas (como as filas do HPSM), com contadores.
    id: 'filas',
    label: 'Filas',
    access: 'triage',
    children: [
      { to: '/history?assignee=me', label: 'Atribuídas a mim', tone: 'orange', count: 'mine' },
      { to: '/history?status=PENDING', label: 'Pendentes', tone: 'gray', count: 'PENDING' },
      { to: '/history?status=IN_REVIEW', label: 'Em análise', tone: 'blue', count: 'IN_REVIEW' },
      { to: '/history?status=COMPLETED', label: 'Concluídas', tone: 'green', count: 'COMPLETED' },
    ],
  },
  {
    id: 'amostras',
    label: 'Amostras',
    children: [
      { to: '/history', label: 'Histórico Global', icon: IconHistory },
      { to: '/me', label: 'Meus Uploads', icon: IconPage },
      { to: '/submit', label: 'Enviar Amostra', icon: IconAdd },
    ],
  },
  {
    id: 'admin',
    label: 'Administração',
    access: 'admin',
    children: [
      { to: '/admin', label: 'Usuários', icon: IconPage },
      { to: '/admin?tab=keys', label: 'Chaves de ativação', icon: IconKey },
    ],
  },
];

/**
 * Folha ativa: a mais especifica cujo caminho e parametros batem com a URL.
 * Ex.: /history?status=PENDING&q=x destaca "Pendentes"; /history?verdict=CLEAN
 * destaca "Histórico Global"; /admin?tab=keys destaca "Chaves de ativação".
 */
function activeLeaf(leaves: NavLeaf[], pathname: string, search: string): string | null {
  const current = new URLSearchParams(search);
  let best: { to: string; params: number } | null = null;
  for (const leaf of leaves) {
    const [path, query = ''] = leaf.to.split('?');
    if (path !== pathname) continue;
    const params = [...new URLSearchParams(query)];
    if (!params.every(([key, value]) => current.get(key) === value)) continue;
    if (!best || params.length > best.params) best = { to: leaf.to, params: params.length };
  }
  return best?.to ?? null;
}

export function HpsmSidebar({ open, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());

  const isAdmin = user?.role === 'ADMIN';
  const canTriage = isAdmin || user?.role === 'ANALYST';

  // Contadores das filas: atualizam a cada minuto (e apos cada triagem).
  const countsQuery = useQuery({
    queryKey: ['entries', 'counts'],
    queryFn: () =>
      api.get<{ counts: Record<EntryStatus, number>; mine: number }>('/entries/counts'),
    enabled: canTriage,
    refetchInterval: 60_000,
  });
  const counts = countsQuery.data
    ? { ...countsQuery.data.counts, mine: countsQuery.data.mine }
    : undefined;

  const folders = TREE.filter(
    (folder) => !folder.access || (folder.access === 'admin' ? isAdmin : canTriage),
  );
  const active = activeLeaf(
    [...ROOT_LEAVES, ...folders.flatMap((folder) => folder.children)],
    pathname,
    search,
  );

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(to);
    onNavigate?.();
  };

  const toggleFolder = (id: string) => {
    setClosedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Folha da arvore; na raiz ganha um espaco no lugar do +/- das pastas.
  const renderLeaf = (leaf: NavLeaf, root = false) => {
    const isActive = leaf.to === active;
    const count = leaf.count && counts ? counts[leaf.count] : undefined;
    return (
      <a
        href={leaf.to}
        className={`hpsm-tree__row hpsm-tree__leaf${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={go(leaf.to)}
      >
        {root && <span className="hpsm-tree__spacer" aria-hidden="true" />}
        {leaf.icon ? (
          <leaf.icon size={16} />
        ) : (
          <span className={`hpsm-tree__bullet hpsm-status hpsm-status--${leaf.tone ?? 'gray'}`}>
            <span className="hpsm-status__bullet" aria-hidden="true" />
          </span>
        )}
        <span className="hpsm-tree__label">{leaf.label}</span>
        {count !== undefined && <span className="hpsm-tree__count">({count})</span>}
      </a>
    );
  };

  const classes = ['hpsm-sidebar', open && 'is-open'].filter(Boolean).join(' ');

  return (
    <aside className={classes} aria-label="Navegação principal">
      <div className="hpsm-sidebar__head">
        <span className="hpsm-sidebar__title">Navegador do Sistema</span>
      </div>

      <nav className="hpsm-tree">
        <ul className="hpsm-tree__list">
          {ROOT_LEAVES.map((leaf) => (
            <li key={leaf.to}>{renderLeaf(leaf, true)}</li>
          ))}
          {folders.map((folder) => {
            const expanded = !closedFolders.has(folder.id);
            const childrenId = `hpsm-tree-${folder.id}`;
            return (
              <li key={folder.id}>
                <button
                  type="button"
                  className="hpsm-tree__row hpsm-tree__folder"
                  aria-expanded={expanded}
                  aria-controls={childrenId}
                  onClick={() => toggleFolder(folder.id)}
                >
                  <span className="hpsm-tree__toggle" aria-hidden="true">
                    {expanded ? '−' : '+'}
                  </span>
                  <IconFolder size={16} />
                  <span className="hpsm-tree__label">{folder.label}</span>
                </button>
                <ul id={childrenId} className="hpsm-tree__children" hidden={!expanded}>
                  {folder.children.map((leaf) => (
                    <li key={leaf.to}>{renderLeaf(leaf)}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
