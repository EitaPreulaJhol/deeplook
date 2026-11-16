import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Favorite } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useOwnSamplesOnly } from '../auth/sampleAccess';
import { t } from '../i18n';
import { t as tr } from '../i18n/frame';
import { favoriteHref, useFavorites } from './favorites';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { HpsmContextMenu } from './HpsmContextMenu';
import type { IconComponent } from './icons';
import {
  IconAdd,
  IconBell,
  IconChart,
  IconDownload,
  IconEye,
  IconFilter,
  IconFolder,
  IconHelp,
  IconHistory,
  IconHome,
  IconKey,
  IconPage,
  IconScreen,
  IconSettings,
  IconTrash,
} from './icons';
import { HpsmMessage } from './messages';
import { useNotificationCount } from './notifications';
import type { StatusTone } from './tags';
import { type TeamView, useTeamViews } from './teamViews';

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
  count?: EntryStatus | 'mine' | 'late' | 'reviews' | 'unread' | 'cases' | 'mycases';
  /** Contador ja calculado (visoes da equipe). */
  value?: number | null;
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
  {
    to: '/inicio',
    get label() {
      return t('nav.home');
    },
    icon: IconHome,
  },
  {
    to: '/painel',
    get label() {
      return t('nav.dashboard');
    },
    icon: IconChart,
  },
  {
    to: '/inbox',
    get label() {
      return t('nav.inbox');
    },
    icon: IconBell,
    count: 'unread',
  },
  // Artigos da equipe sobre malware, golpes e procedimentos (item 63).
  {
    to: '/kb',
    get label() {
      return t('nav.kb');
    },
    icon: IconHelp,
  },
  // Busca em amostras, relatorios, comentarios, base e casos (item 68).
  {
    to: '/busca',
    get label() {
      return t('nav.search');
    },
    icon: IconFilter,
  },
];

/* Arvore do "Navegador do Sistema": pastas com as telas da aplicacao. */
const TREE: NavFolder[] = [
  {
    // Filas de trabalho dos analistas (como as filas do HPSM), com contadores.
    id: 'filas',
    get label() {
      return t('nav.queues');
    },
    access: 'triage',
    children: [
      {
        to: '/history?assignee=me',
        get label() {
          return t('nav.assignedToMe');
        },
        tone: 'orange',
        count: 'mine',
      },
      {
        to: '/history?status=PENDING',
        get label() {
          return t('nav.pending');
        },
        tone: 'gray',
        count: 'PENDING',
      },
      {
        to: '/history?status=IN_REVIEW',
        get label() {
          return t('nav.inReview');
        },
        tone: 'blue',
        count: 'IN_REVIEW',
      },
      {
        to: '/history?status=COMPLETED',
        get label() {
          return t('nav.completed');
        },
        tone: 'green',
        count: 'COMPLETED',
      },
      // Nao concluidas ha mais de SLA_LATE_HOURS no status atual.
      {
        to: '/history?age=late',
        get label() {
          return t('nav.late');
        },
        tone: 'red',
        count: 'late',
      },
      // Relatorios de outros analistas aguardando aprovacao.
      {
        to: '/revisoes',
        get label() {
          return t('nav.reviews');
        },
        icon: IconPage,
        count: 'reviews',
      },
    ],
  },
  {
    // Casos (item 55): amostras da mesma campanha agrupadas.
    id: 'casos',
    get label() {
      return t('nav.cases');
    },
    access: 'triage',
    children: [
      {
        to: '/casos?status=active',
        get label() {
          return t('nav.activeCases');
        },
        icon: IconFolder,
        count: 'cases',
      },
      {
        to: '/casos?status=active&assignee=me',
        get label() {
          return t('nav.myCases');
        },
        icon: IconFolder,
        count: 'mycases',
      },
      {
        to: '/casos',
        get label() {
          return t('nav.allCases');
        },
        icon: IconPage,
      },
    ],
  },
  {
    // Ferramentas de deteccao mantidas pelos analistas.
    id: 'deteccao',
    get label() {
      return t('nav.detection');
    },
    access: 'triage',
    children: [
      {
        to: '/yara',
        get label() {
          return t('nav.yara');
        },
        icon: IconFilter,
      },
      // Regras Sigma sobre o Sysmon do sandbox (plans/caca-e-formatos, item 1).
      {
        to: '/sigma',
        get label() {
          return t('nav.sigma');
        },
        icon: IconFilter,
      },
      // Busca nos eventos de todas as execucoes (plans/caca-e-formatos, item 2).
      {
        to: '/busca-sandbox',
        get label() {
          return t('nav.sandboxHunt');
        },
        icon: IconFilter,
      },
      // Lista de permissoes (item 69).
      {
        to: '/permitidos',
        get label() {
          return t('nav.allowlist');
        },
        icon: IconPage,
      },
      // Tags e prioridade automaticas (item 86).
      {
        to: '/regras-triagem',
        get label() {
          return t('nav.triage');
        },
        icon: IconFilter,
      },
      // Dominios parecidos com os da empresa (item 92).
      {
        to: '/dominios-empresa',
        get label() {
          return t('nav.companyDomains');
        },
        icon: IconEye,
      },
    ],
  },
  {
    // Resumo de um periodo para a gestao (item 77).
    id: 'gestao',
    get label() {
      return t('nav.management');
    },
    access: 'triage',
    children: [
      {
        to: '/gerencial',
        get label() {
          return t('nav.managementReport');
        },
        icon: IconChart,
      },
      // Grupos, regras e ausencias da atribuicao automatica (item 72).
      {
        to: '/atribuicao',
        get label() {
          return t('nav.assignment');
        },
        icon: IconSettings,
      },
      // Faixa de avisos para todos (item 88).
      {
        to: '/avisos',
        get label() {
          return t('nav.broadcasts');
        },
        icon: IconBell,
      },
    ],
  },
  {
    id: 'amostras',
    get label() {
      return t('nav.samples');
    },
    children: [
      {
        to: '/history',
        get label() {
          return t('nav.history');
        },
        icon: IconHistory,
      },
      {
        to: '/me',
        get label() {
          return t('nav.myUploads');
        },
        icon: IconPage,
      },
      {
        to: '/submit',
        get label() {
          return t('nav.submit');
        },
        icon: IconAdd,
      },
    ],
  },
  {
    id: 'admin',
    get label() {
      return t('nav.admin');
    },
    access: 'admin',
    children: [
      {
        to: '/admin',
        get label() {
          return t('nav.users');
        },
        icon: IconPage,
      },
      {
        to: '/admin?tab=keys',
        get label() {
          return t('nav.keys');
        },
        icon: IconKey,
      },
      {
        to: '/admin?tab=tokens',
        get label() {
          return t('nav.tokens');
        },
        icon: IconKey,
      },
      {
        to: '/admin?tab=templates',
        get label() {
          return t('nav.templates');
        },
        icon: IconPage,
      },
      {
        to: '/admin?tab=status',
        get label() {
          return t('nav.status');
        },
        icon: IconScreen,
      },
      {
        to: '/admin?tab=monitor',
        get label() {
          return t('nav.monitor');
        },
        icon: IconChart,
      },
      {
        to: '/admin?tab=audit',
        get label() {
          return t('nav.audit');
        },
        icon: IconHistory,
      },
      {
        to: '/admin?tab=trash',
        get label() {
          return t('nav.trash');
        },
        icon: IconTrash,
      },
      {
        to: '/admin?tab=backup',
        get label() {
          return t('nav.backup');
        },
        icon: IconDownload,
      },
      {
        to: '/admin?tab=settings',
        get label() {
          return t('nav.settings');
        },
        icon: IconSettings,
      },
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
  const { user, preferences, updatePreferences } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [closedFolders, setClosedFolders] = useState<Set<string>>(
    () => new Set(preferences.closedFolders),
  );
  // Grava pouco depois do ultimo clique (item 141): o estado da tela e o daqui, entao
  // a resposta de uma gravacao nao desfaz um clique mais novo.
  const pendingFolders = useRef<string[] | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const flushFolders = useRef(() => {});
  flushFolders.current = () => {
    window.clearTimeout(saveTimer.current);
    if (!pendingFolders.current) return;
    const closedList = pendingFolders.current;
    pendingFolders.current = null;
    // Falhou: so nao vale para a proxima sessao; nao interrompe quem esta navegando.
    updatePreferences({ closedFolders: closedList }).catch(() => undefined);
  };
  useEffect(() => () => flushFolders.current(), []);
  const favs = useFavorites();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [menu, setMenu] = useState<{ favorite: Favorite; x: number; y: number } | null>(null);
  const [teamMenu, setTeamMenu] = useState<{ view: TeamView; x: number; y: number } | null>(null);
  const [favError, setFavError] = useState<string | null>(null);
  const favRefs = useRef(new Map<string, HTMLAnchorElement>());

  // O erro de uma acao nos Favoritos some ao trocar de tela.
  useEffect(() => setFavError(null), [pathname, search]);

  const isAdmin = user?.role === 'ADMIN';
  const canTriage = isAdmin || user?.role === 'ANALYST';
  const team = useTeamViews(canTriage);

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
  const casesQuery = useQuery({
    queryKey: ['cases', 'counts'],
    queryFn: () => api.get<{ active: number; mine: number }>('/cases/counts'),
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
    ...(casesQuery.data ? { cases: casesQuery.data.active, mycases: casesQuery.data.mine } : {}),
    unread,
  } as Partial<Record<NonNullable<NavLeaf['count']>, number>>;

  const ownOnly = useOwnSamplesOnly();
  const folders = TREE.filter(
    (folder) => !folder.access || (folder.access === 'admin' ? isAdmin : canTriage),
  ).map((folder) =>
    ownOnly
      ? { ...folder, children: folder.children.filter((leaf) => leaf.to !== '/history') }
      : folder,
  );
  const favoriteLeaves = favs.favorites.map(favoriteLeaf);
  const teamLeaves: NavLeaf[] = team.views.map((view) => ({
    to: view.url,
    label: view.label,
    icon: IconFilter,
    value: view.count,
  }));
  const active = activeLeaf(
    [
      ...ROOT_LEAVES,
      ...favoriteLeaves,
      ...(canTriage ? teamLeaves : []),
      ...folders.flatMap((folder) => folder.children),
    ],
    pathname,
    search,
  );

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(to);
    onNavigate?.();
  };

  const toggleFolder = (id: string) => {
    const next = new Set(closedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setClosedFolders(next);
    pendingFolders.current = [...next];
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flushFolders.current(), 400);
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
      title: t('nav.renameFavorite'),
      label: t('nav.name'),
      defaultValue: favorite.label,
      confirmLabel: t('nav.renameAction'),
    });
    if (label && label !== favorite.label) await runFav(() => favs.rename(favorite.id, label));
  };

  const removeFavorite = async (favorite: Favorite) => {
    const ok = await confirm({
      title: t('nav.removeFavoriteTitle'),
      message: t('nav.removeFavoriteConfirm', { name: favorite.label }),
    });
    if (ok) await runFav(() => favs.remove(favorite.id));
  };

  const renameTeamView = async (view: TeamView) => {
    const label = await prompt({
      title: t('nav.renameTeamView'),
      label: t('nav.name'),
      defaultValue: view.label,
      confirmLabel: t('nav.renameAction'),
    });
    if (label && label !== view.label) await runFav(() => team.rename(view.id, label));
  };

  const removeTeamView = async (view: TeamView) => {
    const ok = await confirm({
      title: t('nav.removeTeamViewTitle'),
      message: t('nav.removeTeamViewConfirm', { name: view.label }),
      danger: true,
      confirmLabel: t('nav.remove'),
      cancelLabel: t('nav.cancel'),
    });
    if (ok) await runFav(() => team.remove(view.id));
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

  // Visao da equipe: quem compartilhou no title; menu so para quem pode alterar.
  const teamViewProps = (view: TeamView) => ({
    title:
      tr('nav.sharedBy', {
        label: view.label,
        name: view.createdBy?.displayName ?? tr('nav.someone'),
      }) + (view.canEdit ? ` ${tr('nav.rightClickTeam')}` : ''),
    ...(view.canEdit && {
      'aria-keyshortcuts': 'Shift+F10 F2 Delete',
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault();
        setTeamMenu({ view, x: event.clientX, y: event.clientY });
      },
      onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setTeamMenu({ view, x: rect.left + 16, y: rect.bottom });
        } else if (event.key === 'F2') {
          event.preventDefault();
          void renameTeamView(view);
        } else if (event.key === 'Delete') {
          event.preventDefault();
          void removeTeamView(view);
        }
      },
    }),
  });

  // Folha da arvore; na raiz ganha um espaco no lugar do +/- das pastas.
  const renderLeaf = (
    leaf: NavLeaf,
    root = false,
    favorite?: Favorite,
    extra?: ReturnType<typeof teamViewProps>,
  ) => {
    const isActive = leaf.to === active;
    const count = leaf.count ? counts[leaf.count] : (leaf.value ?? undefined);
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
          title: tr('nav.favHint', { label: leaf.label }),
          'aria-keyshortcuts': 'Shift+F10 F2 Delete',
          onContextMenu: (event: MouseEvent) => {
            event.preventDefault();
            setMenu({ favorite, x: event.clientX, y: event.clientY });
          },
          onKeyDown: onFavoriteKeyDown(favorite),
        })}
        {...extra}
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
    <aside id="dl-sidebar" className={classes} aria-label={t('nav.aria')}>
      <div className="hpsm-sidebar__head">
        <span className="hpsm-sidebar__title">{t('nav.title')}</span>
      </div>

      <nav className="hpsm-tree">
        <ul className="hpsm-tree__list">
          {ROOT_LEAVES.map((leaf) => (
            <li key={leaf.to}>{renderLeaf(leaf, true)}</li>
          ))}
          {/* Visoes salvas e amostras fixadas pelo usuario. */}
          {renderFolder(
            'favoritos',
            t('nav.favorites'),
            favs.favorites.length === 0
              ? !favs.loading && <li className="hpsm-tree__empty">{tr('nav.favEmpty')}</li>
              : favs.favorites.map((favorite, index) => (
                  <li key={favorite.id} className="hpsm-tree__fav">
                    {renderLeaf(favoriteLeaves[index], false, favorite)}
                    <button
                      type="button"
                      className="hpsm-tree__remove"
                      aria-label={t('nav.removeFavoriteAria', { name: favorite.label })}
                      title={t('nav.removeFromFavorites')}
                      onClick={() => void removeFavorite(favorite)}
                    >
                      ×
                    </button>
                  </li>
                )),
          )}
          {/* Visoes do Historico Global compartilhadas pelos analistas (item 62). */}
          {canTriage &&
            renderFolder(
              'equipe',
              t('nav.teamViews'),
              team.views.length === 0
                ? !team.loading && <li className="hpsm-tree__empty">{tr('nav.teamEmpty')}</li>
                : team.views.map((view, index) => (
                    <li key={view.id}>
                      {renderLeaf(teamLeaves[index], false, undefined, teamViewProps(view))}
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

      {teamMenu && (
        <HpsmContextMenu
          x={teamMenu.x}
          y={teamMenu.y}
          label={tr('nav.teamViewAria', { label: teamMenu.view.label })}
          onClose={() => setTeamMenu(null)}
          items={[
            { label: t('nav.open'), action: () => navigate(teamMenu.view.url) },
            { label: t('nav.rename'), action: () => void renameTeamView(teamMenu.view) },
            {
              label: t('nav.removeTeamView'),
              icon: IconTrash,
              separated: true,
              action: () => void removeTeamView(teamMenu.view),
            },
          ]}
        />
      )}
      {menu && (
        <HpsmContextMenu
          x={menu.x}
          y={menu.y}
          label={tr('nav.favoriteAria', { label: menu.favorite.label })}
          onClose={closeMenu}
          items={[
            { label: t('nav.open'), action: () => navigate(favoriteHref(menu.favorite)) },
            { label: t('nav.rename'), action: () => void renameFavorite(menu.favorite) },
            {
              label: t('nav.moveUp'),
              disabled: menuIndex <= 0,
              separated: true,
              action: () => void runFav(() => favs.move(menu.favorite.id, -1)),
            },
            {
              label: t('nav.moveDown'),
              disabled: menuIndex >= favs.favorites.length - 1,
              action: () => void runFav(() => favs.move(menu.favorite.id, 1)),
            },
            {
              label: t('nav.removeFavorite'),
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
