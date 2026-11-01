import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Barra de mensagens unica da area de trabalho (estilo HP Service Manager):
 * avisos e erros de qualquer pagina aparecem empilhados no topo do conteudo,
 * logo abaixo das abas de documento. Cada <HpsmMessage> e renderizado por
 * portal nessa barra; fora da casca do app (ex.: janela do console) a
 * mensagem aparece no proprio lugar.
 */
const MessageSlotContext = createContext<HTMLElement | null>(null);

export const MessageSlotProvider = MessageSlotContext.Provider;

/** Barra onde as mensagens sao montadas (fica oculta quando vazia). */
export function HpsmMessageBar({ slotRef }: { slotRef: (node: HTMLDivElement | null) => void }) {
  return <div ref={slotRef} className="hpsm-msgbar" aria-live="polite" />;
}

export type HpsmMessageKind = 'error' | 'warning' | 'info' | 'success';

const GLYPHS: Record<HpsmMessageKind, string> = {
  error: '×',
  warning: '!',
  info: 'i',
  success: '✓',
};

interface HpsmMessageProps {
  kind: HpsmMessageKind;
  children: ReactNode;
}

/** Indicador "Carregando..." do HPSM: caixinha com o giro de pontos + texto. */
export function HpsmLoading({ text, className }: { text: string; className?: string }) {
  return (
    <div className={['hpsm-loading', className].filter(Boolean).join(' ')} role="status">
      <span className="hpsm-loading__spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/** Uma mensagem da barra: icone do tipo + texto + "x" para dispensar. */
export function HpsmMessage({ kind, children }: HpsmMessageProps) {
  const slot = useContext(MessageSlotContext);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const message = (
    <div
      className={`hpsm-msg hpsm-msg--${kind}`}
      role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}
    >
      <span className="hpsm-msg__icon" aria-hidden="true">
        {GLYPHS[kind]}
      </span>
      <span className="hpsm-msg__text">{children}</span>
      <button
        type="button"
        className="hpsm-msg__close"
        aria-label="Dispensar mensagem"
        title="Dispensar"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );

  return slot ? createPortal(message, slot) : message;
}
