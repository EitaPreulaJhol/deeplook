import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

import { useConfirm } from './HpsmConfirm';
import { useWorkspace } from './workspace';

/**
 * Aviso de alteracoes nao salvas (padrao HPSM). Enquanto `dirty` for true:
 * - qualquer navegacao interna que troque de tela ou de aba (outra rota, outra
 *   `?tab=`, fechar a aba de documento, Voltar) pede confirmacao;
 * - recarregar/fechar a janela dispara o aviso nativo do navegador.
 *
 * Chame `allowNavigation()` antes de navegar apos salvar com sucesso.
 */
export function useUnsavedChanges(dirty: boolean) {
  const confirm = useConfirm();
  const { cancelClose } = useWorkspace();
  const bypass = useRef(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !bypass.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

  // O objeto do blocker muda a cada render; o ref evita reabrir o dialogo.
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    confirm({
      title: 'Alterações não salvas',
      message: 'Há alterações não salvas nesta tela. Deseja sair e descartar as alterações?',
      confirmLabel: 'Descartar',
      cancelLabel: 'Continuar editando',
      danger: true,
    }).then((discard) => {
      if (!active) return;
      const current = blockerRef.current;
      if (current.state !== 'blocked') return;
      if (discard) {
        current.proceed();
      } else {
        cancelClose();
        current.reset();
      }
    });
    return () => {
      active = false;
    };
  }, [blocker.state, confirm, cancelClose]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return {
    /** Libera a proxima navegacao (ex.: depois de salvar e redirecionar). */
    allowNavigation: () => {
      bypass.current = true;
    },
  };
}
