import type { KeyboardEvent, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export interface ConfirmOptions {
  /** Titulo do cabecalho da caixa. */
  title: string;
  /** Pergunta / explicacao. */
  message: ReactNode;
  /** Rotulo do botao de confirmar (padrao "Sim"). */
  confirmLabel?: string;
  /** Rotulo do botao de cancelar (padrao "Não"). */
  cancelLabel?: string;
  /** Acao destrutiva: texto do botao de confirmar em vermelho. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Caixa de confirmacao no estilo HPSM ("Deseja realmente...? [Sim] [Nao]").
 * Uso: `if (await confirm({ title, message, danger: true })) { ... }`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const finish = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog {...pending} onClose={finish} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>.');
  return ctx;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Sim',
  cancelLabel = 'Não',
  danger,
  onClose,
}: ConfirmOptions & { onClose: (value: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Foco inicial em "Nao" (escolha segura); ao fechar, volta para onde estava.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Esc = Nao; Tab circula so entre os dois botoes (modal).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const next =
        document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
      next?.focus();
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {title}
        </h2>
        <div className="hpsm-modal__body">
          <span className="hpsm-modal__icon" aria-hidden="true">
            !
          </span>
          <div id={messageId} className="hpsm-modal__message">
            {message}
          </div>
        </div>
        <div className="hpsm-modal__actions">
          <button
            ref={confirmRef}
            type="button"
            className={`dl-btn dl-btn--primary${danger ? ' dl-btn--danger' : ''}`}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
          <button ref={cancelRef} type="button" className="dl-btn" onClick={() => onClose(false)}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
