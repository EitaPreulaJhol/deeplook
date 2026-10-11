import { Button, InlineLoading, InlineNotification, Tag, Theme, Tile } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { SandboxSession, SandboxStatus } from '../api/types';
import { IconRefresh, IconScreen, IconTrash } from '../components/icons';
import { SandboxConsole, type SandboxConsoleHandle } from '../components/SandboxConsole';
import {
  isSandboxActive,
  isSandboxWorking,
  SANDBOX_PHASE_LABELS,
  SANDBOX_STATUS_LABELS,
  useSandboxCountdown,
} from '../components/sandboxStatus';

function statusTagType(status: SandboxStatus): 'green' | 'red' | 'warm-gray' | 'cool-gray' {
  if (status === 'RUNNING') return 'green';
  if (status === 'FAILED') return 'red';
  if (status === 'STOPPED' || status === 'EXPIRED') return 'warm-gray';
  return 'cool-gray';
}

/**
 * Janela dedicada do console do ambiente isolado (aberta via `window.open`).
 * Traz a toolbar de controle da VM (estender prazo, capturar tela, descartar)
 * junto do noVNC, para o analista operar a VM sem sair da amostra.
 */
export function SandboxConsoleWindowPage() {
  const { entryId = '' } = useParams();
  const queryClient = useQueryClient();
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
      ? `Console · ${session.entry.title}`
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
      setError('O console ainda não está disponível para captura.');
      return;
    }
    void handle.captureScreen().then((ok) => {
      if (!ok) setError('Não foi possível capturar a tela (o console ainda não renderizou).');
    });
  };

  const body = () => {
    if (query.isLoading) return <InlineLoading description="Consultando o ambiente..." />;
    if (query.isError || !session) {
      return (
        <InlineNotification
          kind="error"
          title="Erro"
          subtitle="Ambiente não encontrado para esta amostra."
          lowContrast
        />
      );
    }
    if (running) {
      if (!consoleEnabled) {
        return <p className="dl-page-subtitle">O console está desabilitado neste servidor.</p>;
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
          <h3>Ambiente isolado</h3>
          <Tag type={statusTagType(session.status)} size="sm">
            {SANDBOX_STATUS_LABELS[session.status]}
          </Tag>
        </div>
        <p className="dl-page-subtitle">
          {session.phase
            ? (SANDBOX_PHASE_LABELS[session.phase] ?? session.phase)
            : 'Aguardando o provisionamento...'}
        </p>
        {session.lastError && (
          <InlineNotification
            kind="error"
            title="Falha no ambiente"
            subtitle={session.lastError}
            lowContrast
            className="dl-note dl-mb-md"
          />
        )}
        {!isSandboxActive(session.status) && (
          <Button
            disabled={busy !== null}
            onClick={() => run('open', () => api.post(`/entries/${entryId}/sandbox`))}
          >
            Abrir novo ambiente
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
            <h2 className="dl-console-window__title">
              {session?.entry?.title ?? 'Ambiente isolado'}
            </h2>
            <div className="dl-taglist">
              {session && (
                <Tag type={statusTagType(session.status)} size="sm">
                  {SANDBOX_STATUS_LABELS[session.status]}
                </Tag>
              )}
              {session?.vmid && (
                <Tag type="outline" size="sm">
                  VM {session.vmid} · {session.node}
                </Tag>
              )}
              {countdown && (
                <Tag type="cool-gray" size="sm">
                  expira em {countdown}
                </Tag>
              )}
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
                Estender prazo
              </Button>
              <Button
                size="sm"
                kind="ghost"
                renderIcon={IconScreen}
                disabled={busy !== null || !running}
                onClick={capture}
              >
                Capturar tela
              </Button>
              <Button
                size="sm"
                kind="danger--ghost"
                renderIcon={IconTrash}
                disabled={busy !== null}
                onClick={() =>
                  run('dispose', async () => {
                    await api.del(`/sandbox/${session.id}`);
                    window.setTimeout(() => window.close(), 1500);
                  })
                }
              >
                Descartar ambiente
              </Button>
            </div>
          )}
        </div>

        {error && (
          <InlineNotification
            kind="error"
            title="Erro"
            subtitle={error}
            lowContrast
            className="dl-note"
          />
        )}

        <div className="dl-console-window__body">{body()}</div>
      </div>
    </Theme>
  );
}
