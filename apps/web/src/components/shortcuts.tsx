import type { MutableRefObject, ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useWorkspace } from './workspace';

/**
 * Atalhos de teclado do app (listados na Pagina Inicial):
 *   /       foca a busca da lista (fora de campos de texto)
 *   Ctrl+K  foca o "Ir para…" do masthead
 *   Alt+N   abre "Enviar Amostra"
 *   Alt+W   fecha a aba de documento atual
 *   Ctrl+S  salva o formulario aberto (quem registrou useSaveShortcut)
 */
type SaveHandler = () => void;

const SaveContext = createContext<MutableRefObject<SaveHandler | null> | null>(null);

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const saveRef = useRef<SaveHandler | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { close } = useWorkspace();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Com um dialogo aberto, o teclado e dele.
      if (document.querySelector('[role="alertdialog"]')) return;
      const mod = event.ctrlKey || event.metaKey;

      if (mod && !event.altKey && event.key.toLowerCase() === 's') {
        if (saveRef.current) {
          event.preventDefault();
          saveRef.current();
        }
        return;
      }
      if (mod && !event.altKey && event.key.toLowerCase() === 'k') {
        const quick = document.getElementById('dl-quick-search');
        if (quick) {
          event.preventDefault();
          quick.focus();
        }
        return;
      }
      if (event.altKey && !mod && event.code === 'KeyN') {
        event.preventDefault();
        navigate('/submit');
        return;
      }
      if (event.altKey && !mod && event.code === 'KeyW') {
        event.preventDefault();
        close(pathname);
        return;
      }
      if (event.key === '/' && !mod && !event.altKey && !isEditable(event.target)) {
        const search = document.querySelector<HTMLInputElement>('.hpsm-filterbar #q');
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, close, pathname]);

  return <SaveContext.Provider value={saveRef}>{children}</SaveContext.Provider>;
}

/** Registra a acao de salvar da tela para o Ctrl+S (enquanto `enabled`). */
export function useSaveShortcut(handler: SaveHandler, enabled = true) {
  const saveRef = useContext(SaveContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!saveRef || !enabled) return;
    const run = () => latest.current();
    saveRef.current = run;
    return () => {
      if (saveRef.current === run) saveRef.current = null;
    };
  }, [saveRef, enabled]);
}
