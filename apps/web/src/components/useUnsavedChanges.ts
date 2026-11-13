import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';

import { t } from '../i18n/shell';
import { useConfirm } from './HpsmConfirm';
import { useWorkspace } from './workspace';

/** Formularios com alteracoes pendentes agora (o "Sair" consulta antes de encerrar). */
const dirtyForms = new Set<symbol>();
/** Descarte confirmado (ex.: Sair): a proxima navegacao nao pergunta de novo. */
let discarding = false;

/** Ha algum formulario com alteracoes nao salvas na tela? */
export function hasUnsavedChanges(): boolean {
  return dirtyForms.size > 0;
}

/**
 * Libera as navegacoes ate `done` terminar, depois de a pessoa confirmar o
 * descarte por outro caminho (o "Sair" do menu do usuario).
 */
export async function discardUnsavedChanges(done: () => Promise<void>): Promise<void> {
  discarding = true;
  try {
    await done();
  } finally {
    dirtyForms.clear();
    discarding = false;
  }
}

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
  const [released, setReleased] = useState(false);
  const pending = dirty && !released;

  // Entra no registro enquanto houver alteracao pendente.
  useEffect(() => {
    if (!pending) return;
    const id = Symbol('form');
    dirtyForms.add(id);
    return () => {
      dirtyForms.delete(id);
    };
  }, [pending]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !bypass.current &&
      !discarding &&
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
      title: t('unsavedTitle'),
      message: t('unsavedMsg'),
      confirmLabel: t('discard'),
      cancelLabel: t('keepEditing'),
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
      setReleased(true);
    },
  };
}
