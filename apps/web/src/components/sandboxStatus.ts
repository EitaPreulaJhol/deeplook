import { useEffect, useState } from 'react';

import type { SandboxStatus } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/sandbox';

/** Rotulos dos estados do ambiente isolado (painel + janela do console). */
export const SANDBOX_STATUS_LABELS: Record<SandboxStatus, string> = localized(() => ({
  REQUESTED: t('stRequested'),
  PROVISIONING: t('stProvisioning'),
  RUNNING: t('stRunning'),
  STOPPING: t('stStopping'),
  STOPPED: t('stStopped'),
  EXPIRED: t('stExpired'),
  FAILED: t('stFailed'),
}));

/** Rotulos das fases do provisionamento. */
export const SANDBOX_PHASE_LABELS: Record<string, string> = localized(() => ({
  'na-fila': t('phQueue'),
  'gerando-iso': t('phIso'),
  'enviando-iso': t('phUpload'),
  clonando: t('phClone'),
  configurando: t('phConfig'),
  iniciando: t('phStart'),
  encerrando: t('phStop'),
}));

/** Provisionamento/parada em andamento (usado no polling das telas). */
export function isSandboxWorking(status?: SandboxStatus): boolean {
  return status === 'REQUESTED' || status === 'PROVISIONING' || status === 'STOPPING';
}

/** Sessao ainda ativa (nao finalizada). */
export function isSandboxActive(status?: SandboxStatus): boolean {
  return !!status && status !== 'STOPPED' && status !== 'EXPIRED' && status !== 'FAILED';
}

/** Contador do tempo restante do ambiente (atualiza a cada segundo). */
export function useSandboxCountdown(expiresAt?: string | null): string {
  const [left, setLeft] = useState('');

  useEffect(() => {
    if (!expiresAt) {
      setLeft('');
      return;
    }
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setLeft('expirado');
        return;
      }
      const total = Math.floor(ms / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      setLeft(h > 0 ? `${h}h ${m}min` : `${m}min ${String(s).padStart(2, '0')}s`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return left;
}

/** Minutos restantes ate `expiresAt` (arredondado para cima). */
function minutesUntil(expiresAt?: string | null): number | null {
  return expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000) : null;
}

/**
 * Minutos restantes do ambiente, atualizados a cada 15s (precisao suficiente
 * para o titulo da aba e o aviso de expiracao). null quando nao ha prazo.
 */
export function useMinutesLeft(expiresAt?: string | null): number | null {
  const [left, setLeft] = useState(() => minutesUntil(expiresAt));

  useEffect(() => {
    setLeft(minutesUntil(expiresAt));
    if (!expiresAt) return;
    const id = window.setInterval(() => setLeft(minutesUntil(expiresAt)), 15_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return left;
}
