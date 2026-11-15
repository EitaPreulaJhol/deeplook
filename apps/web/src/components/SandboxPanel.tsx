import { Button } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { SandboxSession } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { useConfirm } from './HpsmConfirm';
import { HpsmSection } from './HpsmForm';
import { IconRefresh, IconScreen, IconTrash } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { SandboxArtifacts } from './SandboxArtifacts';
import { SandboxHistory } from './SandboxHistory';
import { openConsoleWindow } from './sandboxOpen';
import {
  isSandboxActive,
  isSandboxWorking,
  SANDBOX_PHASE_LABELS,
  SANDBOX_STATUS_LABELS,
  useSandboxCountdown,
} from './sandboxStatus';
import { StatusText } from './tags';

interface Props {
  entryId: string;
  /**
   * Arquivo expurgado pela retencao: nao da para abrir ambiente, mas os artefatos do ultimo (que
   * ficam com a amostra) continuam na tela, com este aviso.
   */
  purgedNote?: string;
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
export function SandboxPanel({ entryId, purgedNote }: Props) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

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

  if (query.isLoading) return <HpsmLoading text={t('consultingEnv')} />;

  // As execucoes anteriores da amostra, em todos os estados que ja tem um ambiente.
  const history = session ? <SandboxHistory entryId={entryId} currentId={session.id} /> : null;

  // Sem como abrir ambiente (sandbox desligado ou arquivo expurgado): o motivo e, se houve um
  // ambiente que ja acabou, os artefatos dele.
  if (!enabled || purgedNote) {
    const past = session && !isSandboxActive(session.status) && session.status !== 'FAILED';
    return (
      <HpsmSection title={t('title')}>
        <p className={purgedNote ? 'dl-static-empty' : 'dl-page-subtitle'}>
          {purgedNote ?? t('disabled')}
        </p>
        {past && <SandboxArtifacts sessionId={session.id} running={false} />}
        {history}
      </HpsmSection>
    );
  }

  const consoleEnabled = query.data?.consoleEnabled ?? true;

  // ---- Sem ambiente ativo: convite para abrir ----
  if (!session) {
    return (
      <HpsmSection title={t('title')}>
        <div className="dl-sandbox__head">
          <StatusText>{t('noActive')}</StatusText>
        </div>
        <p className="dl-page-subtitle">{t('intro')}</p>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {popupBlocked && <HpsmMessage kind="warning">{t('popupBlocked')}</HpsmMessage>}
        <p className="dl-hint-muted">{t('openFromToolbar')}</p>
        {history}
      </HpsmSection>
    );
  }

  // ---- Encerrando ----
  if (session.status === 'STOPPING') {
    return (
      <HpsmSection title={t('title')}>
        <div className="dl-sandbox__head">
          <StatusText tone="gray">{SANDBOX_STATUS_LABELS.STOPPING}</StatusText>
        </div>
        <HpsmLoading text={t('shuttingDown')} />
        {history}
      </HpsmSection>
    );
  }

  // ---- Provisionando ----
  if (isSandboxWorking(session.status)) {
    const steps = ['gerando-iso', 'enviando-iso', 'clonando', 'configurando', 'iniciando'];
    const current = steps.indexOf(session.phase ?? '');

    return (
      <HpsmSection title={t('title')}>
        <div className="dl-sandbox__head">
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
        {history}
      </HpsmSection>
    );
  }

  // ---- Ambiente pronto: console + ações ----
  if (session.status === 'RUNNING') {
    return (
      <HpsmSection title={t('title')}>
        <div className="dl-sandbox__head">
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
        {history}
      </HpsmSection>
    );
  }

  // ---- Encerrado / expirado / falhou ----
  const failed = session.status === 'FAILED';

  return (
    <HpsmSection title={t('title')}>
      <div className="dl-sandbox__head">
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
      <p className="dl-hint-muted">{t('openFromToolbar')}</p>
      {!failed && <SandboxArtifacts sessionId={session.id} running={false} />}
      {history}
    </HpsmSection>
  );
}
