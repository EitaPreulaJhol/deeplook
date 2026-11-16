import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

import { t } from '../i18n/shell';

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
  /** Um dialogo novo por pedido: dois seguidos nao dividem o estado (o texto digitado). */
  seq: number;
}

export interface PromptOptions {
  title: string;
  /** Texto acima do campo (opcional). */
  message?: ReactNode;
  /** Rotulo do campo (ex.: "Nome"). */
  label: string;
  defaultValue?: string;
  maxLength?: number;
  /** Rotulo do botao de confirmar (padrao "OK"). */
  confirmLabel?: string;
  /** Aceita o campo vazio (ex.: motivo opcional); o retorno e "" em vez de null. */
  optional?: boolean;
}

type PromptFn = (options: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
  seq: number;
}

/**
 * Caixa de confirmacao no estilo HPSM ("Deseja realmente...? [Sim] [Nao]").
 * Uso: `if (await confirm({ title, message, danger: true })) { ... }`.
 */
let dialogSeq = 0;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve, seq: ++dialogSeq })),
    [],
  );
  const prompt = useCallback<PromptFn>(
    (options) =>
      new Promise<string | null>((resolve) =>
        setPendingPrompt({ ...options, resolve, seq: ++dialogSeq }),
      ),
    [],
  );

  const finish = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };
  const finishPrompt = (value: string | null) => {
    pendingPrompt?.resolve(value);
    setPendingPrompt(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      <PromptContext.Provider value={prompt}>
        {children}
        {/* A chave remonta o dialogo a cada pedido: um prompt aberto logo depois de outro (os dois
            setState no mesmo render) nao herda o texto digitado no anterior. */}
        {pending && <ConfirmDialog key={pending.seq} {...pending} onClose={finish} />}
        {pendingPrompt && (
          <PromptDialog key={pendingPrompt.seq} {...pendingPrompt} onClose={finishPrompt} />
        )}
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  // i18n-ok: erro de programacao (provider faltando), so para quem desenvolve
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>.');
  return ctx;
}

/**
 * Caixa que pede um texto (ex.: nome da visao salva): `const nome = await
 * prompt({ title, label: 'Nome' })` devolve o texto aparado ou null (Cancelar/Esc).
 */
export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  // i18n-ok: erro de programacao (provider faltando), so para quem desenvolve
  if (!ctx) throw new Error('usePrompt precisa estar dentro de <ConfirmProvider>.');
  return ctx;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = t('yes'),
  cancelLabel = t('no'),
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

function PromptDialog({
  title,
  message,
  label,
  defaultValue = '',
  maxLength = 60,
  confirmLabel = 'OK',
  optional = false,
  onClose,
}: PromptOptions & { onClose: (value: string | null) => void }) {
  const titleId = useId();
  const inputId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();

  // Foco no campo com o texto selecionado; ao fechar, volta para onde estava.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed || optional) onClose(trimmed);
  };

  // Esc = Cancelar; Tab circula so dentro da caixa (modal).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(null);
    } else if (event.key === 'Tab') {
      const focusables = [
        ...(boxRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []),
      ];
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      const next = (index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
      event.preventDefault();
      focusables[next]?.focus();
    }
  };

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        ref={boxRef}
        className="hpsm-modal__box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="hpsm-modal__head">
          {title}
        </h2>
        <form onSubmit={submit}>
          <div className="hpsm-modal__prompt">
            {message && <div className="hpsm-modal__message">{message}</div>}
            <label className="hpsm-modal__label" htmlFor={inputId}>
              {label}:{!optional && <span className="hpsm-field__req">*</span>}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              className="hpsm-modal__input"
              value={value}
              maxLength={maxLength}
              required={!optional}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="hpsm-modal__actions">
            <button
              type="submit"
              className="dl-btn dl-btn--primary"
              disabled={!trimmed && !optional}
            >
              {confirmLabel}
            </button>
            <button type="button" className="dl-btn" onClick={() => onClose(null)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
