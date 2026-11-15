import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { t } from '../i18n/sandbox';

/** Abre a janela dedicada do console (popup). Retorna false se foi bloqueada. */
export function openConsoleWindow(entryId: string): boolean {
  const win = window.open(
    `/sandbox/entry/${entryId}/console`,
    `deeplook-console-${entryId}`,
    'popup=yes,width=1280,height=900',
  );
  return !!win;
}

/** A escolha da caixa de execucao automatica fica lembrada neste navegador. */
const AUTO_RUN_KEY = 'dl.sandbox.autoRun';
export function readAutoRun(): boolean {
  try {
    return window.localStorage.getItem(AUTO_RUN_KEY) === 'true';
  } catch {
    return false;
  }
}
export function saveAutoRun(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_RUN_KEY, String(value));
  } catch {
    /* sem armazenamento: so nao lembra */
  }
}

/** Resultado de abrir o ambiente: o aviso, quando houver (popup bloqueado ou erro da API). */
export type OpenResult = { kind: 'ok' } | { kind: 'warning' | 'error'; text: string };

/**
 * Abre o ambiente isolado da amostra: a janela do console no mesmo gesto do clique (senao o
 * navegador a bloqueia), depois o pedido com a escolha da execucao automatica. Usado pelo dialogo
 * que o botao da barra de ferramentas da amostra abre (SandboxLaunchDialog).
 */
export function useOpenSandbox(entryId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const open = async (autoRun = readAutoRun(), withConsole = true): Promise<OpenResult> => {
    // Dentro da propria janela do console, nao: abri-la pelo nome dela a recarregaria e cancelaria
    // o pedido; ela mesma passa a mostrar o ambiente novo.
    const opened = withConsole ? openConsoleWindow(entryId) : true;
    setBusy(true);
    try {
      await api.post(`/entries/${entryId}/sandbox`, { autoRun });
      // Abrir entra no historico da amostra; o painel e o indicador da aba se atualizam.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sandbox', 'entry', entryId] }),
        queryClient.invalidateQueries({ queryKey: ['entry', entryId] }),
      ]);
      return opened ? { kind: 'ok' } : { kind: 'warning', text: t('popupBlocked') };
    } catch (err) {
      return { kind: 'error', text: (err as Error).message };
    } finally {
      setBusy(false);
    }
  };
  return { open, busy };
}
