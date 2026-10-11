import { Button, InlineLoading, InlineNotification, Tag, Tile } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type { SandboxSession, SandboxStatus } from '../api/types';
import { IconRefresh, IconScreen, IconTrash } from './icons';
import { SandboxConsole, type SandboxConsoleHandle } from './SandboxConsole';

const PHASE_LABELS: Record<string, string> = {
  'na-fila': 'na fila do Proxmox',
  'gerando-iso': 'gerando a ISO com a amostra',
  'enviando-iso': 'enviando a ISO para o Proxmox',
  clonando: 'clonando o template da VM',
  configurando: 'configurando a VM isolada',
  iniciando: 'ligando a VM',
  encerrando: 'encerrando o ambiente',
};

const STATUS_LABELS: Record<SandboxStatus, string> = {
  REQUESTED: 'solicitado',
  PROVISIONING: 'provisionando',
  RUNNING: 'em execução',
  STOPPING: 'encerrando',
  STOPPED: 'encerrado',
  EXPIRED: 'expirado',
  FAILED: 'falhou',
};

function isWorking(status: SandboxStatus): boolean {
  return status === 'REQUESTED' || status === 'PROVISIONING' || status === 'STOPPING';
}

/** Contador do tempo restante do ambiente (atualiza a cada segundo). */
function useCountdown(expiresAt?: string): string {
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

/**
 * Painel do ambiente isolado no Proxmox: abre o clone do template com a
 * amostra dentro (ISO read-only), mostra o console e cuida do descarte.
 */
export function SandboxPanel({ entryId }: { entryId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const consoleRef = useRef<SandboxConsoleHandle | null>(null);

  const query = useQuery({
    queryKey: ['sandbox', 'entry', entryId],
    queryFn: () =>
      api.get<{ enabled: boolean; consoleEnabled: boolean; session: SandboxSession | null }>(
        `/entries/${entryId}/sandbox`,
      ),
    refetchInterval: (q) => {
      const status = q.state.data?.session?.status;
      return status && isWorking(status) ? 2500 : false;
    },
  });

  const enabled = query.data?.enabled ?? false;
  const session = query.data?.session ?? null;
  const countdown = useCountdown(session?.expiresAt);

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

  const openScreenshot = () => {
    setError(null);
    const handle = consoleRef.current;
    if (!handle) {
      setError('O console precisa estar aberto para capturar a tela.');
      return;
    }
    handle.captureScreen();
  };

  if (query.isLoading) return <InlineLoading description="Consultando o ambiente..." />;

  if (!enabled) {
    return (
      <Tile className="dl-mb-lg">
        <h3 className="dl-mb-md">Ambiente isolado</h3>
        <p className="dl-page-subtitle">
          O sandbox (VM isolada no Proxmox) não está habilitado neste servidor.
        </p>
      </Tile>
    );
  }

  const consoleEnabled = query.data?.consoleEnabled ?? true;

  // ---- Sem ambiente ativo: convite para abrir ----
  if (!session) {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>Ambiente isolado</h3>
          <Tag type="outline" size="sm">
            nenhum ambiente ativo
          </Tag>
        </div>
        <p className="dl-page-subtitle">
          Cria um clone do template no Proxmox com a amostra dentro (CD-ROM somente leitura) e abre o
          console no navegador. O ambiente é destruído automaticamente no fim do prazo.
        </p>
        {error && (
          <InlineNotification
            kind="error"
            title="Erro"
            subtitle={error}
            lowContrast
            className="dl-note dl-mb-md"
          />
        )}
        <Button
          renderIcon={IconScreen}
          disabled={busy !== null}
          onClick={() => run('open', () => api.post(`/entries/${entryId}/sandbox`))}
        >
          {busy === 'open' ? 'Abrindo...' : 'Abrir ambiente isolado'}
        </Button>
      </Tile>
    );
  }

  // ---- Encerrando ----
  if (session.status === 'STOPPING') {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>Ambiente isolado</h3>
          <Tag type="warm-gray" size="sm">
            {STATUS_LABELS.STOPPING}
          </Tag>
        </div>
        <InlineLoading description="Desligando a VM e apagando a ISO da amostra..." />
      </Tile>
    );
  }

  // ---- Provisionando ----
  if (isWorking(session.status)) {
    const steps = ['gerando-iso', 'enviando-iso', 'clonando', 'configurando', 'iniciando'];
    const current = steps.indexOf(session.phase ?? '');

    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>Ambiente isolado</h3>
          <Tag type="blue" size="sm">
            {STATUS_LABELS[session.status]}
          </Tag>
        </div>
        <p className="dl-page-subtitle">
          {PHASE_LABELS[session.phase ?? ''] ?? 'preparando o ambiente'}...
        </p>
        <ol className="dl-sandbox__steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
            >
              {PHASE_LABELS[step]}
            </li>
          ))}
        </ol>
        <InlineLoading description="Isso leva alguns instantes." />
        {session.status === 'REQUESTED' && (
          <p className="dl-page-subtitle">Aguardando uma vaga na fila de provisionamento.</p>
        )}
      </Tile>
    );
  }

  // ---- Ambiente pronto: console + ações ----
  if (session.status === 'RUNNING') {
    return (
      <Tile className="dl-mb-lg">
        <div className="dl-sandbox__head">
          <h3>Ambiente isolado</h3>
          <div className="dl-taglist">
            <Tag type="green" size="sm">
              {STATUS_LABELS.RUNNING}
            </Tag>
            <Tag type="outline" size="sm">
              VM {session.vmid} · {session.node}
            </Tag>
            {countdown && (
              <Tag type="cool-gray" size="sm">
                expira em {countdown}
              </Tag>
            )}
          </div>
        </div>
        <p className="dl-page-subtitle">
          A amostra está no CD-ROM da VM (somente leitura), junto com o SHA-256 e um LEIA-ME. Não
          exponha esta VM à rede.
        </p>
        {error && (
          <InlineNotification
            kind="error"
            title="Erro"
            subtitle={error}
            lowContrast
            className="dl-note dl-mb-md"
          />
        )}
        <div className="dl-toolbar dl-mb-md">
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
            disabled={busy !== null}
            onClick={openScreenshot}
          >
            Capturar tela
          </Button>
          <Button
            size="sm"
            kind="danger--ghost"
            renderIcon={IconTrash}
            disabled={busy !== null}
            onClick={() => run('dispose', () => api.del(`/sandbox/${session.id}`))}
          >
            Descartar ambiente
          </Button>
        </div>
        {consoleEnabled ? (
          <SandboxConsole
            ref={consoleRef}
            sessionId={session.id}
            wsPath={`/api/sandbox/${session.id}/console/ws`}
            onDisconnected={refresh}
          />
        ) : (
          <p className="dl-page-subtitle">O console está desabilitado neste servidor.</p>
        )}
      </Tile>
    );
  }

  // ---- Encerrado / expirado / falhou ----
  const failed = session.status === 'FAILED';

  return (
    <Tile className="dl-mb-lg">
      <div className="dl-sandbox__head">
        <h3>Ambiente isolado</h3>
        <Tag type={failed ? 'red' : 'warm-gray'} size="sm">
          {STATUS_LABELS[session.status]}
        </Tag>
      </div>
      {session.lastError && (
        <InlineNotification
          kind="error"
          title="Falha no ambiente"
          subtitle={session.lastError}
          lowContrast
          className="dl-note dl-mb-md"
        />
      )}
      {error && (
        <InlineNotification
          kind="error"
          title="Erro"
          subtitle={error}
          lowContrast
          className="dl-note dl-mb-md"
        />
      )}
      <p className="dl-page-subtitle">
        {session.status === 'EXPIRED'
          ? 'O prazo do ambiente terminou e a VM foi destruída.'
          : 'Ambiente encerrado: a VM e a ISO da amostra foram removidas.'}
      </p>
      <Button
        renderIcon={IconScreen}
        disabled={busy !== null}
        onClick={() => run('open', () => api.post(`/entries/${entryId}/sandbox`))}
      >
        Abrir novo ambiente
      </Button>
    </Tile>
  );
}

