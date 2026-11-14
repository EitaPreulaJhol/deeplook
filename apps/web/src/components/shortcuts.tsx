import type { MutableRefObject, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { DecoderDialog } from './DecoderDialog';
import { HpsmShortcutsHelp } from './HpsmShortcutsHelp';
import { useWorkspace } from './workspace';

type SaveHandler = () => void;

const SaveContext = createContext<MutableRefObject<SaveHandler | null> | null>(null);
const HelpContext = createContext<(() => void) | null>(null);
const DecoderContext = createContext<((text?: string) => void) | null>(null);

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
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  // Decodificador (item 85): abre com o texto pedido (ou o selecionado na tela).
  const [decoder, setDecoder] = useState<string | null>(null);
  const openDecoder = useCallback(
    (text?: string) => setDecoder(text ?? window.getSelection()?.toString() ?? ''),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // F1 abriria a ajuda do navegador.
      if (event.key === 'F1') event.preventDefault();
      // Com um dialogo aberto, o teclado e dele.
      if (document.querySelector('.hpsm-modal')) return;
      const mod = event.ctrlKey || event.metaKey;

      if (
        event.key === 'F1' ||
        (event.key === '?' && !mod && !event.altKey && !isEditable(event.target))
      ) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

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
      if (mod && event.shiftKey && !event.altKey && event.code === 'KeyD') {
        event.preventDefault();
        openDecoder();
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
  }, [navigate, close, pathname, openDecoder]);

  return (
    <SaveContext.Provider value={saveRef}>
      <HelpContext.Provider value={openHelp}>
        <DecoderContext.Provider value={openDecoder}>
          {children}
          {helpOpen && <HpsmShortcutsHelp onClose={() => setHelpOpen(false)} />}
          {decoder !== null && <DecoderDialog initial={decoder} onClose={() => setDecoder(null)} />}
        </DecoderContext.Provider>
      </HelpContext.Provider>
    </SaveContext.Provider>
  );
}

/** Abre a caixa "Atalhos de teclado" (ex.: pelo menu do usuario). */
export function useShortcutsHelp(): () => void {
  const open = useContext(HelpContext);
  // i18n-ok: erro de programacao (provider faltando), so para quem desenvolve
  if (!open) throw new Error('useShortcutsHelp precisa estar dentro de <ShortcutsProvider>.');
  return open;
}

/** Abre o Decodificador (item 85) com o texto (sem texto: o selecionado na tela). */
export function useDecoder(): (text?: string) => void {
  const open = useContext(DecoderContext);
  // i18n-ok: erro de programacao (provider faltando), so para quem desenvolve
  if (!open) throw new Error('useDecoder precisa estar dentro de <ShortcutsProvider>.');
  return open;
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
