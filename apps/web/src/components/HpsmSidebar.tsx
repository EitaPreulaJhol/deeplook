import type { MouseEvent } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import type { IconComponent } from './icons';
import { IconAdd, IconFolder, IconHistory, IconHome, IconKey, IconPage } from './icons';

interface SidebarProps {
  /** Controle do drawer no mobile (a sidebar fica off-canvas). */
  open: boolean;
  /** Fecha o drawer apos navegar (mobile). */
  onNavigate?: () => void;
}

interface NavLeaf {
  to: string;
  label: string;
  icon: IconComponent;
}

interface NavFolder {
  id: string;
  label: string;
  adminOnly?: boolean;
  children: NavLeaf[];
}

/* Itens soltos no topo da arvore, antes das pastas. */
const ROOT_LEAVES: NavLeaf[] = [{ to: '/inicio', label: 'Página Inicial', icon: IconHome }];

/* Arvore do "Navegador do Sistema": pastas com as telas da aplicacao. */
const TREE: NavFolder[] = [
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
    adminOnly: true,
    children: [
      { to: '/admin', label: 'Usuários', icon: IconPage },
      { to: '/admin?tab=keys', label: 'Chaves de ativação', icon: IconKey },
    ],
  },
];

/** Folha ativa: mesmo pathname e mesma aba (`?tab=`) da URL atual. */
function isLeafActive(to: string, pathname: string, search: string): boolean {
  const [path, query = ''] = to.split('?');
  const leafTab = new URLSearchParams(query).get('tab') ?? '';
  const currentTab = new URLSearchParams(search).get('tab') ?? '';
  return path === pathname && leafTab === currentTab;
}

export function HpsmSidebar({ open, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());

  const isAdmin = user?.role === 'ADMIN';

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
    const active = isLeafActive(leaf.to, pathname, search);
    return (
      <a
        href={leaf.to}
        className={`hpsm-tree__row hpsm-tree__leaf${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={go(leaf.to)}
      >
        {root && <span className="hpsm-tree__spacer" aria-hidden="true" />}
        <leaf.icon size={16} />
        <span className="hpsm-tree__label">{leaf.label}</span>
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
          {TREE.filter((folder) => !folder.adminOnly || isAdmin).map((folder) => {
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
