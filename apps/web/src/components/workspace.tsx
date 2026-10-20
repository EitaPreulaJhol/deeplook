import type { MouseEvent, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Abas de documento da area de trabalho (estilo HP Service Manager): cada
 * lista/registro aberto vira uma aba no topo do conteudo, com "x" para fechar.
 * A aba e identificada pelo pathname; a URL completa (com ?tab=...) e guardada
 * para reabrir no mesmo ponto. A lista sobrevive a recarga via sessionStorage.
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
}

const STORAGE_KEY = 'dl-workspace-tabs';
/** Limite de abas abertas; ao passar, a mais antiga (fora a ativa) e fechada. */
const MAX_TABS = 10;
const HOME_URL = '/history';

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Titulo padrao de cada rota (null = rota sem aba, ex.: redirecionamentos). */
function routeTitle(pathname: string): string | null {
  if (pathname === '/history') return 'Histórico Global';
  if (pathname === '/me') return 'Meus Uploads';
  if (pathname === '/submit') return 'Enviar Amostra';
  if (pathname === '/admin') return 'Administração';
  if (pathname.startsWith('/entries/')) return 'Amostra';
  return null;
}

function loadTabs(): WorkspaceTab[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
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

function saveTabs(tabs: WorkspaceTab[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    /* armazenamento indisponivel: as abas so nao sobrevivem a recarga */
  }
}

/** Esquece as abas abertas (logout: o proximo usuario comeca do zero). */
export function clearWorkspaceTabs() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada a limpar */
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(loadTabs);

  // Toda navegacao abre (ou atualiza) a aba da rota atual.
  useEffect(() => {
    const title = routeTitle(pathname);
    if (!title) return;
    const url = pathname + search;
    setTabs((current) => {
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
  }, [pathname, search]);

  useEffect(() => saveTabs(tabs), [tabs]);

  const setTitle = useCallback((path: string, title: string) => {
    setTabs((current) =>
      current.some((t) => t.path === path && t.title !== title)
        ? current.map((t) => (t.path === path ? { ...t, title } : t))
        : current,
    );
  }, []);

  // Fechar a aba ativa leva para a vizinha (direita, senao esquerda).
  const close = useCallback(
    (path: string) => {
      const index = tabs.findIndex((t) => t.path === path);
      if (index < 0) return;
      const rest = tabs.filter((t) => t.path !== path);
      setTabs(rest);
      if (path === pathname) {
        const neighbor = rest[index] ?? rest[index - 1];
        navigate(neighbor ? neighbor.url : HOME_URL);
      }
    },
    [tabs, pathname, navigate],
  );

  return (
    <WorkspaceContext.Provider value={{ tabs, setTitle, close }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de <WorkspaceProvider>.');
  return ctx;
}

/** Define o titulo da aba da rota atual (ex.: o nome da amostra aberta). */
export function useWorkspaceTitle(title?: string) {
  const { setTitle } = useWorkspace();
  const { pathname } = useLocation();
  useEffect(() => {
    if (title) setTitle(pathname, title);
  }, [title, pathname, setTitle]);
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
