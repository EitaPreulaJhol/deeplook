import type { MouseEvent, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

/**
 * Abas de documento da area de trabalho (estilo HP Service Manager): cada
 * lista/registro aberto vira uma aba no topo do conteudo, com "x" para fechar.
 * A aba e identificada pelo pathname; a URL completa (com ?tab=...) e guardada
 * para reabrir no mesmo ponto. A lista sobrevive a recarga via sessionStorage;
 * com a preferencia "Reabrir abas ao entrar", uma copia por usuario fica no
 * localStorage e e restaurada no proximo login.
 */
interface WorkspaceTab {
  /** Chave da aba (pathname). */
  path: string;
  /** Ultima URL visitada nesta aba (pathname + search). */
  url: string;
  title: string;
}

interface WorkspaceContextValue {
  tabs: WorkspaceTab[];
  setTitle: (path: string, title: string) => void;
  close: (path: string) => void;
  /** Desiste do fechamento em andamento (a navegacao foi bloqueada). */
  cancelClose: () => void;
}

const STORAGE_KEY = 'dl-workspace-tabs';
/** Limite de abas abertas; ao passar, a mais antiga (fora a ativa) e fechada. */
const MAX_TABS = 10;
/** Sem abas restantes: a raiz leva a pagina inicial das preferencias. */
const HOME_URL = '/';

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Titulo padrao de cada rota (null = rota sem aba, ex.: redirecionamentos). */
function routeTitle(pathname: string): string | null {
  if (pathname === '/inicio') return 'Página Inicial';
  if (pathname === '/user') return 'Minha Conta';
  if (pathname === '/history') return 'Histórico Global';
  if (pathname === '/me') return 'Meus Uploads';
  if (pathname === '/submit') return 'Enviar Amostra';
  if (pathname === '/admin') return 'Administração';
  if (pathname.startsWith('/entries/')) return 'Amostra';
  if (pathname.startsWith('/iocs/')) return 'Indicador';
  if (pathname === '/inbox') return 'Caixa de entrada';
  if (pathname === '/painel') return 'Painel';
  if (pathname === '/revisoes') return 'Relatórios para revisar';
  if (pathname === '/yara') return 'Regras YARA';
  if (pathname === '/permitidos') return 'Indicadores permitidos';
  if (pathname === '/casos') return 'Casos';
  if (pathname.startsWith('/casos/')) return 'Caso';
  if (pathname === '/kb') return 'Base de conhecimento';
  if (pathname === '/kb/novo') return 'Novo artigo';
  if (pathname.startsWith('/kb/')) return 'Artigo';
  if (pathname === '/comparar') return 'Comparar amostras';
  return null;
}

/** Copia das abas guardada entre logins (uma por usuario). */
function restoreKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

function loadTabs(storage: Storage, key: string): WorkspaceTab[] {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (t): t is WorkspaceTab =>
            typeof t?.path === 'string' &&
            typeof t?.url === 'string' &&
            typeof t?.title === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function saveTabs(tabs: WorkspaceTab[], userId: string | undefined, restore: boolean) {
  try {
    const json = JSON.stringify(tabs);
    window.sessionStorage.setItem(STORAGE_KEY, json);
    if (userId) {
      if (restore) window.localStorage.setItem(restoreKey(userId), json);
      else window.localStorage.removeItem(restoreKey(userId));
    }
  } catch {
    /* armazenamento indisponivel: as abas so nao sobrevivem a recarga */
  }
}

/** Esquece as abas desta sessao do navegador (logout). A copia de "reabrir ao
 *  entrar" fica guardada por usuario, entao outro usuario nao a ve. */
export function clearWorkspaceTabs() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada a limpar */
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const { user, preferences } = useAuth();
  const userId = user?.id;
  const restore = preferences.restoreTabs;

  // Abas desta sessao (F5) ou, num login novo, as da sessao anterior.
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    try {
      const current = loadTabs(window.sessionStorage, STORAGE_KEY);
      if (current.length > 0 || !userId || !restore) return current;
      return loadTabs(window.localStorage, restoreKey(userId));
    } catch {
      return [];
    }
  });

  // Aba ativa sendo fechada: so sai da faixa depois que a navegacao acontece
  // (ela pode ser bloqueada por alteracoes nao salvas).
  // Ultimo titulo definido por tela (useWorkspaceTitle), por caminho.
  const knownTitles = useRef(new Map<string, string>());
  const pendingClose = useRef<string | null>(null);

  // Toda navegacao abre (ou atualiza) a aba da rota atual.
  useEffect(() => {
    const closing = pendingClose.current;
    if (closing && closing !== pathname) {
      pendingClose.current = null;
      setTabs((current) => current.filter((t) => t.path !== closing));
    }
    const base = routeTitle(pathname);
    if (!base) return;
    // Titulo pedido pela tela antes de a aba existir (o efeito da pagina roda
    // antes deste): usa ele no lugar do titulo padrao da rota.
    const title = knownTitles.current.get(pathname) ?? base;
    const url = pathname + search;
    // Navegacao que troca o registro da aba (ex.: Anterior/Proxima da amostra).
    const replaceTab = (state as { replaceTab?: string } | null)?.replaceTab;
    setTabs((current) => {
      // A aba de origem vira a do novo registro; se ele ja tinha aba propria,
      // a de origem fecha e a existente e reaproveitada.
      if (replaceTab && replaceTab !== pathname && current.some((t) => t.path === replaceTab)) {
        if (current.some((t) => t.path === pathname)) {
          return current
            .filter((t) => t.path !== replaceTab)
            .map((t) => (t.path === pathname ? { ...t, url } : t));
        }
        return current.map((t) => (t.path === replaceTab ? { path: pathname, url, title } : t));
      }
      const existing = current.find((t) => t.path === pathname);
      if (existing) {
        return existing.url === url
          ? current
          : current.map((t) => (t.path === pathname ? { ...t, url } : t));
      }
      let next = [...current, { path: pathname, url, title }];
      while (next.length > MAX_TABS) {
        const oldest = next.findIndex((t) => t.path !== pathname);
        next = next.filter((_, i) => i !== oldest);
      }
      return next;
    });
  }, [pathname, search, state]);

  useEffect(() => saveTabs(tabs, userId, restore), [tabs, userId, restore]);

  const setTitle = useCallback((path: string, title: string) => {
    knownTitles.current.set(path, title);
    setTabs((current) =>
      current.some((t) => t.path === path && t.title !== title)
        ? current.map((t) => (t.path === path ? { ...t, title } : t))
        : current,
    );
  }, []);

  // Fechar a aba ativa leva para a vizinha (direita, senao esquerda); a aba so
  // e removida quando a navegacao se completa (ver pendingClose).
  const close = useCallback(
    (path: string) => {
      const index = tabs.findIndex((t) => t.path === path);
      if (index < 0) return;
      const rest = tabs.filter((t) => t.path !== path);
      if (path !== pathname) {
        setTabs(rest);
        return;
      }
      const neighbor = rest[index] ?? rest[index - 1];
      pendingClose.current = path;
      navigate(neighbor ? neighbor.url : HOME_URL);
    },
    [tabs, pathname, navigate],
  );

  const cancelClose = useCallback(() => {
    pendingClose.current = null;
  }, []);

  return (
    <WorkspaceContext.Provider value={{ tabs, setTitle, close, cancelClose }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de <WorkspaceProvider>.');
  return ctx;
}

/** Define o titulo da aba da rota atual (ex.: o nome da amostra aberta);
 *  `titleOnLeave` e aplicado quando a tela e desmontada. */
export function useWorkspaceTitle(title?: string, titleOnLeave?: string) {
  const { setTitle } = useWorkspace();
  const { pathname } = useLocation();
  useEffect(() => {
    if (title) setTitle(pathname, title);
  }, [title, pathname, setTitle]);
  // Titulo com informacao viva (ex.: prazo do sandbox): ao sair da tela a aba
  // volta ao titulo simples, para nao ficar com um valor parado.
  useEffect(
    () => () => {
      if (titleOnLeave) setTitle(pathname, titleOnLeave);
    },
    [titleOnLeave, pathname, setTitle],
  );
}

/** Faixa de abas de documento no topo da area de conteudo. */
export function WorkspaceTabs() {
  const { tabs, close } = useWorkspace();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (tabs.length === 0) return null;

  const open = (tab: WorkspaceTab) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(tab.url);
  };

  return (
    <nav className="hpsm-doctabs" aria-label="Registros abertos">
      {tabs.map((tab) => {
        const active = tab.path === pathname;
        return (
          <div
            key={tab.path}
            className={`hpsm-doctab${active ? ' is-active' : ''}`}
            // Clique do meio fecha a aba, como no navegador.
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                close(tab.path);
              }
            }}
          >
            <a
              href={tab.url}
              className="hpsm-doctab__link"
              aria-current={active ? 'page' : undefined}
              title={tab.title}
              onClick={open(tab)}
            >
              {tab.title}
            </a>
            <button
              type="button"
              className="hpsm-doctab__close"
              aria-label={`Fechar ${tab.title}`}
              title="Fechar"
              onClick={() => close(tab.path)}
            >
              ×
            </button>
          </div>
        );
      })}
    </nav>
  );
}
