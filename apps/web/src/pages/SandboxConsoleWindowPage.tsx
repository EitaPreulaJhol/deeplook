import { Button, Theme, Tile } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { SandboxSession, SandboxStatus } from '../api/types';
import { useConfirm } from '../components/HpsmConfirm';
import { IconRefresh, IconScreen, IconTrash } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { SandboxConsole, type SandboxConsoleHandle } from '../components/SandboxConsole';
import {
  isSandboxActive,
  isSandboxWorking,
  SANDBOX_PHASE_LABELS,
  SANDBOX_STATUS_LABELS,
  useSandboxCountdown,
} from '../components/sandboxStatus';
import { StatusText, type StatusTone } from '../components/tags';
import { t } from '../i18n/sandbox';

function statusTone(status: SandboxStatus): StatusTone {
  if (status === 'RUNNING') return 'green';
  if (status === 'FAILED') return 'red';
  if (status === 'STOPPED' || status === 'EXPIRED') return 'gray';
  return 'blue';
}

/**
 * Janela dedicada do console do ambiente isolado (aberta via `window.open`).
 * Traz a toolbar de controle da VM (estender prazo, capturar tela, descartar)
 * junto do noVNC, para o analista operar a VM sem sair da amostra.
 */
export function SandboxConsoleWindowPage() {
  const { entryId = '' } = useParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const consoleRef = useRef<SandboxConsoleHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Mesma queryKey do painel (chaves consistentes entre as telas). Cada janela
  // tem seu proprio cache, por isso o refetch no foco: ao voltar para o painel
  // (ou para a janela) o estado do ambiente e atualizado.
  const query = useQuery({
    queryKey: ['sandbox', 'entry', entryId],
    queryFn: () =>
      api.get<{ enabled: boolean; consoleEnabled: boolean; session: SandboxSession | null }>(
        `/entries/${entryId}/sandbox`,
      ),
    refetchInterval: (q) => (isSandboxWorking(q.state.data?.session?.status) ? 2000 : false),
    refetchOnWindowFocus: true,
  });

  const session = query.data?.session ?? null;
  const consoleEnabled = query.data?.consoleEnabled ?? true;
  const countdown = useSandboxCountdown(session?.expiresAt);
  const running = session?.status === 'RUNNING';

  useEffect(() => {
    document.title = session?.entry?.title
      ? t('consoleTitle', { title: session.entry.title })
      : 'Console · DeepLook';
  }, [session?.entry?.title]);

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const capture = () => {
    setError(null);
    const handle = consoleRef.current;
    if (!handle) {
      setError(t('consoleNotReady'));
      return;
    }
    void handle.captureScreen().then((ok) => {
      if (!ok) setError(t('captureNotRendered'));
    });
  };

  const body = () => {
    if (query.isLoading) return <HpsmLoading text={t('consultingEnv')} />;
    if (query.isError || !session) {
      return <HpsmMessage kind="error">{t('envNotFound')}</HpsmMessage>;
    }
    if (running) {
      if (!consoleEnabled) {
        return <p className="dl-page-subtitle">{t('consoleDisabled')}</p>;
      }
      return (
        <SandboxConsole
          ref={consoleRef}
          sessionId={session.id}
          wsPath={`/api/sandbox/${session.id}/console/ws`}
          onDisconnected={refresh}
        />
      );
    }
    return (
      <Tile>
        <div className="dl-sandbox__head">
          <h3>{t('title')}</h3>
          <StatusText tone={statusTone(session.status)}>
            {SANDBOX_STATUS_LABELS[session.status]}
          </StatusText>
        </div>
        <p className="dl-page-subtitle">
          {session.phase
            ? (SANDBOX_PHASE_LABELS[session.phase] ?? session.phase)
            : t('waitingProvisioning')}
        </p>
        {session.lastError && (
          <HpsmMessage kind="error">{t('envFailed', { error: session.lastError })}</HpsmMessage>
        )}
        {!isSandboxActive(session.status) && (
          <Button
            disabled={busy !== null}
            onClick={() => run('open', () => api.post(`/entries/${entryId}/sandbox`))}
          >
            {t('openNewEnv')}
          </Button>
        )}
      </Tile>
    );
  };

  return (
    <Theme theme="g10">
      <div className="dl-console-window">
        <div className="dl-console-window__head">
          <div>
            <h2 className="dl-console-window__title">{session?.entry?.title ?? t('title')}</h2>
            <div className="dl-taglist">
              {session && (
                <StatusText tone={statusTone(session.status)}>
                  {SANDBOX_STATUS_LABELS[session.status]}
                </StatusText>
              )}
              {session?.vmid && (
                <StatusText>
                  VM {session.vmid} · {session.node}
                </StatusText>
              )}
              {countdown && <StatusText>{t('expiresIn', { time: countdown })}</StatusText>}
            </div>
          </div>

          {session && isSandboxActive(session.status) && (
            <div className="dl-toolbar">
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
                kind="ghost"
                renderIcon={IconScreen}
                disabled={busy !== null || !running}
                onClick={capture}
              >
                {t('captureScreen')}
              </Button>
              <Button
                size="sm"
                kind="danger--ghost"
                renderIcon={IconTrash}
                disabled={busy !== null}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: t('discardEnv'),
                      message: t('discardConfirm'),
                      confirmLabel: t('discard'),
                      danger: true,
                    }))
                  )
                    return;
                  void run('dispose', async () => {
                    await api.del(`/sandbox/${session.id}`);
                    window.setTimeout(() => window.close(), 1500);
                  });
                }}
              >
                {t('discardEnv')}
              </Button>
            </div>
          )}
        </div>

        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}

        <div className="dl-console-window__body">{body()}</div>
      </div>
    </Theme>
  );
}
