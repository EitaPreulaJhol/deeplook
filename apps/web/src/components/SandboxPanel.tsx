import { Button, Checkbox, Tile } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { SandboxSession } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { useConfirm } from './HpsmConfirm';
import { IconRefresh, IconScreen, IconTrash } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { SandboxArtifacts } from './SandboxArtifacts';
import {
  isSandboxWorking,
  SANDBOX_PHASE_LABELS,
  SANDBOX_STATUS_LABELS,
  useSandboxCountdown,
} from './sandboxStatus';
import { StatusText } from './tags';

/** Abre a janela dedicada do console (popup). Retorna false se foi bloqueada. */
function openConsoleWindow(entryId: string): boolean {
  const win = window.open(
    `/sandbox/entry/${entryId}/console`,
    `deeplook-console-${entryId}`,
    'popup=yes,width=1280,height=900',
  );
  return !!win;
}

interface Props {
  entryId: string;
}

/** A escolha da caixa de execucao automatica fica lembrada neste navegador. */
const AUTO_RUN_KEY = 'dl.sandbox.autoRun';
function readAutoRun(): boolean {
  try {
    return window.localStorage.getItem(AUTO_RUN_KEY) === 'true';
  } catch {
    return false;
  }
}
function saveAutoRun(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_RUN_KEY, String(value));
  } catch {
    /* sem armazenamento: so nao lembra */
  }
}

/**
 * Estado da execucao automatica da amostra no ambiente (nada se nao foi pedida). Fica no proprio
 * painel, junto do ambiente: o HpsmMessage iria para a barra do topo da pagina.
 */
function AutoRunStatus({ session }: { session: SandboxSession }) {
  const line = (text: string, tone?: 'warn' | 'error') => (
    <p
      className={`dl-sandbox__autorun${tone ? ` dl-sandbox__autorun--${tone}` : ''}`}
      role={tone ? 'alert' : 'status'}
    >
      {text}
    </p>
  );
  switch (session.autoRun) {
    case 'PENDING':
      return line(t('autoRunPending'));
    case 'RUNNING':
      return line(t('autoRunRunning'));
    case 'DONE': {
      const time = session.autoRunAt
        ? new Date(session.autoRunAt).toLocaleTimeString(intlLocale())
        : '—';
      const user = session.autoRunUser ?? '?';
      return (
        <>
          {line(t('autoRunDone', { time, user }))}
          {user === 'SYSTEM' && line(t('autoRunSystem'), 'warn')}
          {session.autoRunSysmon === false && line(t('autoRunNoSysmon'), 'warn')}
        </>
      );
    }
    case 'FAILED':
      return line(t('autoRunFailed', { error: session.autoRunError ?? '?' }), 'error');
    default:
      return null;
  }
}

/**
 * Painel do ambiente isolado no Proxmox: abre o clone do template com a
 * amostra dentro (ISO read-only). O console noVNC roda numa janela dedicada
 * (com a toolbar de controle da VM), nao mais embutido na pagina.
 */
export function SandboxPanel({ entryId }: Props) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [autoRun, setAutoRun] = useState(readAutoRun);

  const query = useQuery({
    queryKey: ['sandbox', 'entry', entryId],
    queryFn: () =>
      api.get<{ enabled: boolean; consoleEnabled: boolean; session: SandboxSession | null }>(
        `/entries/${entryId}/sandbox`,
      ),
    refetchInterval: (q) => {
      const s = q.state.data?.session;
      if (isSandboxWorking(s?.status)) return 2500;
      // Execucao automatica em andamento: acompanha ate rodar (ou falhar).
      return s?.status === 'RUNNING' && (s.autoRun === 'PENDING' || s.autoRun === 'RUNNING')
        ? 5000
        : false;
    },
    // A janela do console tem cache proprio: ao voltar o foco para esta aba, o
    // painel revalida (ex.: ambiente descartado na outra janela).
    refetchOnWindowFocus: true,
  });

  const enabled = query.data?.enabled ?? false;
  const session = query.data?.session ?? null;
  const countdown = useSandboxCountdown(session?.expiresAt);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sandbox', 'entry', entryId] });
    await queryClient.invalidateQueries({ queryKey: ['entry', entryId] });
  };

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
      await refresh();
      // Abrir/descartar entra no historico da amostra.
      await queryClient.invalidateQueries({ queryKey: ['entry', entryId, 'events'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Abre (ou foca) a janela do console desta amostra. */
  const openConsole = () => {
    setPopupBlocked(false);
    if (!openConsoleWindow(entryId)) setPopupBlocked(true);
  };

  /** Cria o ambiente e ja abre a janela do console (no mesmo gesto do clique). */
  const openEnvironment = () => {
    setPopupBlocked(false);
    const opened = openConsoleWindow(entryId);
    void run('open', async () => {
      await api.post(`/entries/${entryId}/sandbox`, { autoRun });
      if (!opened) setPopupBlocked(true);
    });
  };

  /** A caixa da execucao automatica, nos dois lugares de onde se abre um ambiente. */
  const autoRunBox = (
    <div className="dl-sandbox__autorun-box">
      <Checkbox
        id={`sandbox-autorun-${entryId}`}
        labelText={t('autoRunLabel')}
        helperText={t('autoRunHelp')}
        checked={autoRun}
        disabled={busy !== null}
        onChange={(_, { checked }) => {
          setAutoRun(checked);
          saveAutoRun(checked);
        }}
      />
    </div>
  );

  if (query.isLoading) return <HpsmLoading text={t('consultingEnv')} />;

  if (!enabled) {
    return (
      <Tile className="dl-mb-lg">
        <h3 className="dl-mb-md">{t('title')}</h3>
        <p className="dl-page-subtitle">{t('disabled')}</p>
      </Tile>
    );
  }

  const consoleEnabled = query.data?.consoleEnabled ?? true;

  // ---- Sem ambiente ativo: convite para abrir ----
  if (!session) {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>{t('title')}</h3>
          <StatusText>{t('noActive')}</StatusText>
        </div>
        <p className="dl-page-subtitle">{t('intro')}</p>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {popupBlocked && <HpsmMessage kind="warning">{t('popupBlocked')}</HpsmMessage>}
        {autoRunBox}
        <Button renderIcon={IconScreen} disabled={busy !== null} onClick={openEnvironment}>
          {busy === 'open' ? t('opening') : t('openEnv')}
        </Button>
      </Tile>
    );
  }

  // ---- Encerrando ----
  if (session.status === 'STOPPING') {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>{t('title')}</h3>
          <StatusText tone="gray">{SANDBOX_STATUS_LABELS.STOPPING}</StatusText>
        </div>
        <HpsmLoading text={t('shuttingDown')} />
      </Tile>
    );
  }

  // ---- Provisionando ----
  if (isSandboxWorking(session.status)) {
    const steps = ['gerando-iso', 'enviando-iso', 'clonando', 'configurando', 'iniciando'];
    const current = steps.indexOf(session.phase ?? '');

    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>{t('title')}</h3>
          <StatusText tone="blue">{SANDBOX_STATUS_LABELS[session.status]}</StatusText>
        </div>
        <p className="dl-page-subtitle">
          {SANDBOX_PHASE_LABELS[session.phase ?? ''] ?? t('preparing')}...
        </p>
        <ol className="dl-sandbox__steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
            >
              {SANDBOX_PHASE_LABELS[step]}
            </li>
          ))}
        </ol>
        <HpsmLoading text={t('takesMoment')} />
        {session.status === 'REQUESTED' && <p className="dl-page-subtitle">{t('waitingQueue')}</p>}
      </Tile>
    );
  }

  // ---- Ambiente pronto: console + ações ----
  if (session.status === 'RUNNING') {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>{t('title')}</h3>
          <div className="dl-taglist">
            <StatusText tone="green">{SANDBOX_STATUS_LABELS.RUNNING}</StatusText>
            <StatusText>
              VM {session.vmid} · {session.node}
            </StatusText>
            {countdown && <StatusText>{t('expiresIn', { time: countdown })}</StatusText>}
          </div>
        </div>
        <p className="dl-page-subtitle">{t('runningHelp')}</p>
        <AutoRunStatus session={session} />
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {popupBlocked && <HpsmMessage kind="warning">{t('popupBlockedConsole')}</HpsmMessage>}
        <div className="dl-toolbar dl-mb-md">
          <Button
            size="sm"
            renderIcon={IconScreen}
            disabled={busy !== null || !consoleEnabled}
            onClick={openConsole}
          >
            {t('openConsole')}
          </Button>
          <Button
            size="sm"
            kind="ghost"
            renderIcon={IconRefresh}
            disabled={busy !== null}
            onClick={() => run('extend', () => api.post(`/sandbox/${session.id}/extend`))}
          >
            {t('extendTime')}
          </Button>
          <Button
            size="sm"
            kind="danger--ghost"
            renderIcon={IconTrash}
            disabled={busy !== null}
            onClick={async () => {
              if (
                await confirm({
                  title: t('discardEnv'),
                  message: t('discardConfirm'),
                  confirmLabel: t('discard'),
                  danger: true,
                })
              )
                void run('dispose', () => api.del(`/sandbox/${session.id}`));
            }}
          >
            {t('discardEnv')}
          </Button>
        </div>
        <SandboxArtifacts sessionId={session.id} running />
      </Tile>
    );
  }

  // ---- Encerrado / expirado / falhou ----
  const failed = session.status === 'FAILED';

  return (
    <Tile className="dl-mb-lg">
      <div className="dl-sandbox__head">
        <h3>{t('title')}</h3>
        <StatusText tone={failed ? 'red' : 'gray'}>
          {SANDBOX_STATUS_LABELS[session.status]}
        </StatusText>
      </div>
      {session.lastError && (
        <HpsmMessage kind="error">{t('envFailed', { error: session.lastError })}</HpsmMessage>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <p className="dl-page-subtitle">
        {session.status === 'EXPIRED' ? t('envExpired') : t('envClosed')}
      </p>
      {!failed && <AutoRunStatus session={session} />}
      {autoRunBox}
      <Button
        renderIcon={IconScreen}
        disabled={busy !== null}
        onClick={() => run('open', () => api.post(`/entries/${entryId}/sandbox`, { autoRun }))}
      >
        {t('openNewEnv')}
      </Button>
      {!failed && <SandboxArtifacts sessionId={session.id} running={false} />}
    </Tile>
  );
}
