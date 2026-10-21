import { Button, Tile } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { SandboxSession } from '../api/types';
import { useConfirm } from './HpsmConfirm';
import { IconRefresh, IconScreen, IconTrash } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
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

  const query = useQuery({
    queryKey: ['sandbox', 'entry', entryId],
    queryFn: () =>
      api.get<{ enabled: boolean; consoleEnabled: boolean; session: SandboxSession | null }>(
        `/entries/${entryId}/sandbox`,
      ),
    refetchInterval: (q) => (isSandboxWorking(q.state.data?.session?.status) ? 2500 : false),
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
      await api.post(`/entries/${entryId}/sandbox`);
      if (!opened) setPopupBlocked(true);
    });
  };

  if (query.isLoading) return <HpsmLoading text="Consultando o ambiente..." />;

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
          <StatusText>nenhum ambiente ativo</StatusText>
        </div>
        <p className="dl-page-subtitle">
          Cria um clone do template no Proxmox com a amostra dentro (CD-ROM somente leitura) e abre
          o console em uma janela dedicada. O ambiente é destruído automaticamente no fim do prazo.
        </p>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {popupBlocked && (
          <HpsmMessage kind="warning">
            Pop-up bloqueado. Permita pop-ups para este site e clique em “Abrir ambiente isolado”
            novamente.
          </HpsmMessage>
        )}
        <Button renderIcon={IconScreen} disabled={busy !== null} onClick={openEnvironment}>
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
          <StatusText tone="gray">{SANDBOX_STATUS_LABELS.STOPPING}</StatusText>
        </div>
        <HpsmLoading text="Desligando a VM e apagando a ISO da amostra..." />
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
          <h3>Ambiente isolado</h3>
          <StatusText tone="blue">{SANDBOX_STATUS_LABELS[session.status]}</StatusText>
        </div>
        <p className="dl-page-subtitle">
          {SANDBOX_PHASE_LABELS[session.phase ?? ''] ?? 'preparando o ambiente'}...
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
        <HpsmLoading text="Isso leva alguns instantes." />
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
            <StatusText tone="green">{SANDBOX_STATUS_LABELS.RUNNING}</StatusText>
            <StatusText>
              VM {session.vmid} · {session.node}
            </StatusText>
            {countdown && <StatusText>expira em {countdown}</StatusText>}
          </div>
        </div>
        <p className="dl-page-subtitle">
          A amostra está no CD-ROM da VM (somente leitura), junto com o SHA-256 e um LEIA-ME. O
          console abre em uma janela dedicada (com a toolbar de controle da VM). Não exponha esta VM
          à rede.
        </p>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {popupBlocked && (
          <HpsmMessage kind="warning">
            Pop-up bloqueado. Permita pop-ups para este site e clique em “Abrir console” novamente.
          </HpsmMessage>
        )}
        <div className="dl-toolbar dl-mb-md">
          <Button
            size="sm"
            renderIcon={IconScreen}
            disabled={busy !== null || !consoleEnabled}
            onClick={openConsole}
          >
            Abrir console (nova janela)
          </Button>
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
            kind="danger--ghost"
            renderIcon={IconTrash}
            disabled={busy !== null}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Descartar ambiente',
                  message:
                    'Deseja realmente descartar o ambiente? A VM e a ISO da amostra serão destruídas e o console será desconectado.',
                  confirmLabel: 'Descartar',
                  danger: true,
                })
              )
                void run('dispose', () => api.del(`/sandbox/${session.id}`));
            }}
          >
            Descartar ambiente
          </Button>
        </div>
      </Tile>
    );
  }

  // ---- Encerrado / expirado / falhou ----
  const failed = session.status === 'FAILED';

  return (
    <Tile className="dl-mb-lg">
      <div className="dl-sandbox__head">
        <h3>Ambiente isolado</h3>
        <StatusText tone={failed ? 'red' : 'gray'}>
          {SANDBOX_STATUS_LABELS[session.status]}
        </StatusText>
      </div>
      {session.lastError && (
        <HpsmMessage kind="error">Falha no ambiente: {session.lastError}</HpsmMessage>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
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
