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

/**
 * Duracoes oferecidas no dialogo de inicio, ate o teto (SANDBOX_TTL_MINUTES), que sempre entra e e o
 * padrao.
 */
export function durationChoices(ttlMinutes: number): number[] {
  const steps = [15, 30, 60, 120, 240, 480, 720, 1440].filter((m) => m < ttlMinutes);
  return [...steps, ttlMinutes];
}

/** "15 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
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

/**
 * Opcoes do dialogo de inicio (plans/ajustes-usabilidade, item 5). Sem duracao, vale o
 * SANDBOX_TTL_MINUTES; sem `capture`, a captura de rede segue ligada (quando configurada).
 */
export interface LaunchOptions {
  autoRun?: boolean;
  minutes?: number;
  capture?: boolean;
  /** Dump de memoria depois da execucao automatica (plans/novas-analises, item 3). */
  memoryDump?: boolean;
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
  const open = async (
    { autoRun = readAutoRun(), minutes, capture }: LaunchOptions = {},
    withConsole = true,
  ): Promise<OpenResult> => {
    // Dentro da propria janela do console, nao: abri-la pelo nome dela a recarregaria e cancelaria
    // o pedido; ela mesma passa a mostrar o ambiente novo.
    const opened = withConsole ? openConsoleWindow(entryId) : true;
    setBusy(true);
    try {
      await api.post(`/entries/${entryId}/sandbox`, { autoRun, minutes, capture });
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
