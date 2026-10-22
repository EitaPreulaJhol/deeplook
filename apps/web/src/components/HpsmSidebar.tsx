import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Favorite } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { favoriteHref, useFavorites } from './favorites';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { HpsmContextMenu } from './HpsmContextMenu';
import type { IconComponent } from './icons';
import {
  IconAdd,
  IconBell,
  IconChart,
  IconFilter,
  IconFolder,
  IconHistory,
  IconHome,
  IconKey,
  IconPage,
  IconScreen,
  IconTrash,
} from './icons';
import { HpsmMessage } from './messages';
import { useNotificationCount } from './notifications';
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
  /**
   * Contador ao lado do nome: um status, `mine` (atribuidas a mim e abertas),
   * `late` (atrasadas), `reviews` (relatorios para revisar) ou `unread` (caixa de entrada).
   */
  count?: EntryStatus | 'mine' | 'late' | 'reviews' | 'unread';
}

interface NavFolder {
  id: string;
  label: string;
  /** Quem ve a pasta: analistas/admins (`triage`) ou so admins (`admin`). */
  access?: 'triage' | 'admin';
  children: NavLeaf[];
}

/* Itens soltos no topo da arvore, antes das pastas. */
const ROOT_LEAVES: NavLeaf[] = [
  { to: '/inicio', label: 'Página Inicial', icon: IconHome },
  { to: '/painel', label: 'Painel', icon: IconChart },
  { to: '/inbox', label: 'Caixa de entrada', icon: IconBell, count: 'unread' },
];

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
      // Nao concluidas ha mais de SLA_LATE_HOURS no status atual.
      { to: '/history?age=late', label: 'Atrasadas', tone: 'red', count: 'late' },
      // Relatorios de outros analistas aguardando aprovacao.
      { to: '/revisoes', label: 'Relatórios para revisar', icon: IconPage, count: 'reviews' },
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
      { to: '/admin?tab=templates', label: 'Modelos de relatório', icon: IconPage },
      { to: '/admin?tab=status', label: 'Status do sistema', icon: IconScreen },
      { to: '/admin?tab=audit', label: 'Auditoria', icon: IconHistory },
      { to: '/admin?tab=trash', label: 'Lixeira', icon: IconTrash },
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

/** Favorito como folha da arvore (visao salva = funil; amostra fixada = pagina). */
function favoriteLeaf(favorite: Favorite): NavLeaf {
  return {
    to: favoriteHref(favorite),
    label: favorite.label,
    icon: favorite.kind === 'VIEW' ? IconFilter : IconPage,
  };
}

export function HpsmSidebar({ open, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());
  const favs = useFavorites();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [menu, setMenu] = useState<{ favorite: Favorite; x: number; y: number } | null>(null);
  const [favError, setFavError] = useState<string | null>(null);
  const favRefs = useRef(new Map<string, HTMLAnchorElement>());

  // O erro de uma acao nos Favoritos some ao trocar de tela.
  useEffect(() => setFavError(null), [pathname, search]);

  const isAdmin = user?.role === 'ADMIN';
  const canTriage = isAdmin || user?.role === 'ANALYST';

  // Contadores das filas: atualizam a cada minuto (e apos cada triagem).
  const countsQuery = useQuery({
    queryKey: ['entries', 'counts'],
    queryFn: () =>
      api.get<{
        counts: Record<EntryStatus, number>;
        mine: number;
        late: number;
        reviews: number;
      }>('/entries/counts'),
    enabled: canTriage,
    refetchInterval: 60_000,
  });
  const unread = useNotificationCount();
  const counts = {
    ...(countsQuery.data
      ? {
          ...countsQuery.data.counts,
          mine: countsQuery.data.mine,
          late: countsQuery.data.late,
          reviews: countsQuery.data.reviews,
        }
      : {}),
    unread,
  } as Partial<Record<NonNullable<NavLeaf['count']>, number>>;

  const folders = TREE.filter(
    (folder) => !folder.access || (folder.access === 'admin' ? isAdmin : canTriage),
  );
  const favoriteLeaves = favs.favorites.map(favoriteLeaf);
  const active = activeLeaf(
    [...ROOT_LEAVES, ...favoriteLeaves, ...folders.flatMap((folder) => folder.children)],
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

  /** Executa uma acao dos Favoritos; erro da API vai para a barra de mensagens. */
  const runFav = async (action: () => Promise<unknown>) => {
    setFavError(null);
    try {
      await action();
    } catch (err) {
      setFavError((err as Error).message);
    }
  };

  const renameFavorite = async (favorite: Favorite) => {
    const label = await prompt({
      title: 'Renomear favorito',
      label: 'Nome',
      defaultValue: favorite.label,
      confirmLabel: 'Renomear',
    });
    if (label && label !== favorite.label) await runFav(() => favs.rename(favorite.id, label));
  };

  const removeFavorite = async (favorite: Favorite) => {
    const ok = await confirm({
      title: 'Remover favorito',
      message: `Remover "${favorite.label}" dos Favoritos?`,
    });
    if (ok) await runFav(() => favs.remove(favorite.id));
  };

  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      if (restoreFocus && menu) favRefs.current.get(menu.favorite.id)?.focus();
      setMenu(null);
    },
    [menu],
  );

  // Teclado no favorito: Shift+F10 / tecla Menu abrem o menu de contexto,
  // F2 renomeia e Delete remove (como no navegador do HPSM).
  const onFavoriteKeyDown = (favorite: Favorite) => (event: KeyboardEvent<HTMLAnchorElement>) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ favorite, x: rect.left + 16, y: rect.bottom });
    } else if (event.key === 'F2') {
      event.preventDefault();
      void renameFavorite(favorite);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void removeFavorite(favorite);
    }
  };

  // Folha da arvore; na raiz ganha um espaco no lugar do +/- das pastas.
  const renderLeaf = (leaf: NavLeaf, root = false, favorite?: Favorite) => {
    const isActive = leaf.to === active;
    const count = leaf.count ? counts[leaf.count] : undefined;
    return (
      <a
        href={leaf.to}
        className={`hpsm-tree__row hpsm-tree__leaf${isActive ? ' is-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={go(leaf.to)}
        {...(favorite && {
          ref: (el: HTMLAnchorElement | null) => {
            if (el) favRefs.current.set(favorite.id, el);
            else favRefs.current.delete(favorite.id);
          },
          title: `${leaf.label} (clique direito: renomear, mover, remover)`,
          'aria-keyshortcuts': 'Shift+F10 F2 Delete',
          onContextMenu: (event: MouseEvent) => {
            event.preventDefault();
            setMenu({ favorite, x: event.clientX, y: event.clientY });
          },
          onKeyDown: onFavoriteKeyDown(favorite),
        })}
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

  // Pasta da arvore (+/- recolhe e expande).
  const renderFolder = (id: string, label: string, children: ReactNode) => {
    const expanded = !closedFolders.has(id);
    const childrenId = `hpsm-tree-${id}`;
    return (
      <li key={id}>
        <button
          type="button"
          className="hpsm-tree__row hpsm-tree__folder"
          aria-expanded={expanded}
          aria-controls={childrenId}
          onClick={() => toggleFolder(id)}
        >
          <span className="hpsm-tree__toggle" aria-hidden="true">
            {expanded ? '−' : '+'}
          </span>
          <IconFolder size={16} />
          <span className="hpsm-tree__label">{label}</span>
        </button>
        <ul id={childrenId} className="hpsm-tree__children" hidden={!expanded}>
          {children}
        </ul>
      </li>
    );
  };

  const menuIndex = menu ? favs.favorites.findIndex((f) => f.id === menu.favorite.id) : -1;
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
          {/* Visoes salvas e amostras fixadas pelo usuario. */}
          {renderFolder(
            'favoritos',
            'Favoritos',
            favs.favorites.length === 0
              ? !favs.loading && (
                  <li className="hpsm-tree__empty">
                    Vazio. Use “Salvar visão” nas listas ou “Fixar” numa amostra.
                  </li>
                )
              : favs.favorites.map((favorite, index) => (
                  <li key={favorite.id} className="hpsm-tree__fav">
                    {renderLeaf(favoriteLeaves[index], false, favorite)}
                    <button
                      type="button"
                      className="hpsm-tree__remove"
                      aria-label={`Remover "${favorite.label}" dos Favoritos`}
                      title="Remover dos Favoritos"
                      onClick={() => void removeFavorite(favorite)}
                    >
                      ×
                    </button>
                  </li>
                )),
          )}
          {folders.map((folder) =>
            renderFolder(
              folder.id,
              folder.label,
              folder.children.map((leaf) => <li key={leaf.to}>{renderLeaf(leaf)}</li>),
            ),
          )}
        </ul>
      </nav>

      {favError && <HpsmMessage kind="error">{favError}</HpsmMessage>}

      {menu && (
        <HpsmContextMenu
          x={menu.x}
          y={menu.y}
          label={`Favorito ${menu.favorite.label}`}
          onClose={closeMenu}
          items={[
            { label: 'Abrir', action: () => navigate(favoriteHref(menu.favorite)) },
            { label: 'Renomear… (F2)', action: () => void renameFavorite(menu.favorite) },
            {
              label: 'Mover para cima',
              disabled: menuIndex <= 0,
              separated: true,
              action: () => void runFav(() => favs.move(menu.favorite.id, -1)),
            },
            {
              label: 'Mover para baixo',
              disabled: menuIndex >= favs.favorites.length - 1,
              action: () => void runFav(() => favs.move(menu.favorite.id, 1)),
            },
            {
              label: 'Remover dos Favoritos (Del)',
              icon: IconTrash,
              separated: true,
              action: () => void removeFavorite(menu.favorite),
            },
          ]}
        />
      )}
    </aside>
  );
}
