import { Button } from '@carbon/react';
import RFB from '@novnc/novnc';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { t } from '../i18n/sandbox';

type ConsoleStatus = 'connecting' | 'connected' | 'closed' | 'error';

interface Props {
  /** Caminho do websocket do console (ex.: /api/sandbox/<id>/console/ws). */
  wsPath: string;
  /** Id da sessao (para buscar a senha VNC em /console/credentials). */
  sessionId: string;
  /** Avisa o painel quando o console cai (para atualizar o estado da VM). */
  onDisconnected?: () => void;
}

/** Metodos imperativos que o painel pode chamar no console. */
export interface SandboxConsoleHandle {
  /** Captura a tela atual e abre o PNG numa nova aba. `false` se falhou. */
  captureScreen: () => Promise<boolean>;
}

function wsUrl(path: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${path}`;
}

/**
 * Console noVNC embutido. O navegador fala com o nosso proxy
 * (`/api/sandbox/<id>/console/ws`), que repassa para o vncwebsocket do PVE
 * com o ticket que fica somente no backend.
 */
export const SandboxConsole = forwardRef<SandboxConsoleHandle, Props>(function SandboxConsole(
  { wsPath, sessionId, onDisconnected }: Props,
  ref,
) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const disconnectRef = useRef(onDisconnected);
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  const [message, setMessage] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    disconnectRef.current = onDisconnected;
  }, [onDisconnected]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    setStatus('connecting');
    setMessage(null);

    let rfb: RFB | null = null;
    try {
      rfb = new RFB(holder, wsUrl(wsPath), { wsProtocols: ['binary'], shared: true });
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.clipViewport = false;
      rfb.focusOnClick = true;
      rfb.background = '#161616';

      rfb.addEventListener('connect', () => {
        setStatus('connected');
        setMessage(null);
      });
      rfb.addEventListener('disconnect', (event) => {
        const detail = (event as CustomEvent<{ clean?: boolean; name?: string }>).detail;
        setStatus('closed');
        setMessage(
          detail?.clean
            ? t('consoleSessionEnded')
            : t('consoleDisconnected', { detail: detail?.name ? ` (${detail.name})` : '' }),
        );
        disconnectRef.current?.();
      });

      // O vncwebsocket do PVE exige auth VNC: o noVNC pede a senha e nos a
      // buscamos no backend (efemera). O ticket do Proxmox nunca vem ao navegador.
      rfb.addEventListener('credentialsrequired', () => {
        void (async () => {
          try {
            const res = await fetch(`/api/sandbox/${sessionId}/console/credentials`, {
              credentials: 'include',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { password?: string };
            if (!data.password) throw new Error(t('passwordUnavailable'));
            rfb?.sendCredentials({ password: data.password });
          } catch (err) {
            setStatus('error');
            setMessage(t('authFailed', { error: (err as Error).message }));
          }
        })();
      });

      rfbRef.current = rfb;
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message);
    }

    return () => {
      rfbRef.current = null;
      try {
        rfb?.disconnect();
      } catch {
        /* ja desconectado */
      }
      // Sem innerHTML: com Trusted Types na CSP, ate a string vazia e recusada.
      holder.replaceChildren();
    };
  }, [wsPath, sessionId, nonce]);

  const connected = status === 'connected';

  /**
   * Captura a tela do console. O noVNC desenha num <canvas> 2D; lemos os pixels
   * direto no navegador — isso independe do Proxmox (que removeu o endpoint
   * server-side de screenshot no PVE 9). Preferimos o buffer interno do noVNC
   * (tamanho real do framebuffer), que segue valido mesmo com o painel oculto.
   */
  const captureScreen = async (): Promise<boolean> => {
    const priv = rfbRef.current as unknown as {
      _screen?: { _backbuffer?: HTMLCanvasElement };
    } | null;
    const canvas = priv?._screen?._backbuffer ?? holderRef.current?.querySelector('canvas') ?? null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      setMessage(t('noImageYet'));
      return false;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setMessage(t('captureFailedConsole'));
      return false;
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  };

  useImperativeHandle(ref, () => ({ captureScreen }));

  return (
    <div className="dl-sandbox-console">
      <div className="dl-sandbox-console__bar">
        <span className={`dl-sandbox-console__state dl-sandbox-console__state--${status}`}>
          {status === 'connecting' && t('connecting')}
          {status === 'connected' && t('connected')}
          {status === 'closed' && t('disconnected')}
          {status === 'error' && t('consoleFailure')}
        </span>
        <div className="dl-sandbox-console__actions">
          <input
            className="dl-sandbox-console__paste"
            type="text"
            placeholder={t('pastePlaceholder')}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <Button
            size="sm"
            kind="ghost"
            disabled={!connected || pasteText.length === 0}
            onClick={() => {
              rfbRef.current?.clipboardPasteFrom(pasteText);
              setPasteText('');
            }}
          >
            {t('paste')}
          </Button>
          <Button
            size="sm"
            kind="ghost"
            disabled={!connected}
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
          >
            Ctrl+Alt+Del
          </Button>
          <Button size="sm" kind="tertiary" onClick={() => setNonce((n) => n + 1)}>
            {t('reconnect')}
          </Button>
        </div>
      </div>
      {message && <div className="dl-sandbox-console__message">{message}</div>}
      <div ref={holderRef} className="dl-sandbox-console__screen" />
    </div>
  );
});
