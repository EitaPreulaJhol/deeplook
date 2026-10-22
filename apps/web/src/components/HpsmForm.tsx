import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import { CopyButton } from './CopyButton';

interface HpsmSectionProps {
  title: string;
  /** Comeca aberta (padrao) ou recolhida. */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** Secao de formulario recolhivel (+/-), como os grupos dos forms do HPSM. */
export function HpsmSection({ title, defaultOpen = true, className, children }: HpsmSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={['hpsm-section', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="hpsm-section__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="hpsm-section__toggle" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
        <span>{title}</span>
      </button>
      <div id={bodyId} className="hpsm-section__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Grade de campos: uma coluna, ou duas em telas largas (`columns={2}`). */
export function HpsmForm({ columns = 1, children }: { columns?: 1 | 2; children: ReactNode }) {
  return <div className={`hpsm-form${columns === 2 ? ' hpsm-form--2col' : ''}`}>{children}</div>;
}

interface HpsmFieldProps {
  label: string;
  /** id do controle (o rotulo foca o campo ao ser clicado). */
  htmlFor?: string;
  required?: boolean;
  /** Ocupa a linha inteira na grade de duas colunas. */
  wide?: boolean;
  /** Alinha o rotulo ao topo (campos de varias linhas). */
  top?: boolean;
  /** Texto de ajuda abaixo do controle. */
  help?: ReactNode;
  /** Campo destacado em vermelho (validacao). */
  invalid?: boolean;
  children: ReactNode;
}

/**
 * Linha rotulo/campo no estilo HPSM: rotulo a esquerda (alinhado a direita,
 * com dois-pontos) e o controle ao lado. Os controles do Carbon usam
 * `hideLabel`, que mantem o nome acessivel; por isso o rotulo visivel fica
 * fora da arvore de acessibilidade (sem leitura duplicada).
 */
export function HpsmField({
  label,
  htmlFor,
  required,
  wide,
  top,
  help,
  invalid,
  children,
}: HpsmFieldProps) {
  const classes = [
    'hpsm-field',
    wide && 'hpsm-field--wide',
    top && 'hpsm-field--top',
    invalid && 'hpsm-field--invalid',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <label
        className="hpsm-field__label"
        htmlFor={htmlFor}
        aria-hidden={htmlFor ? true : undefined}
      >
        {label}:{required && <span className="hpsm-field__req">*</span>}
      </label>
      <div className="hpsm-field__control">
        {children}
        {help && <div className="hpsm-field__help">{help}</div>}
      </div>
    </div>
  );
}

/** Valor somente leitura dentro de uma caixa cinza (campo travado do HPSM). */
export function HpsmReadonly({
  multiline,
  mono,
  copyable,
  children,
}: {
  multiline?: boolean;
  mono?: boolean;
  /** Mostra o botao de copiar: o texto copiado e o que esta sendo copiado. */
  copyable?: { value: string; label: string };
  children: ReactNode;
}) {
  const classes = [
    'hpsm-readonly',
    multiline && 'hpsm-readonly--multiline',
    mono && 'dl-mono',
    copyable && 'hpsm-readonly--copyable',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      {copyable ? <span className="hpsm-readonly__text">{children}</span> : children}
      {copyable && <CopyButton value={copyable.value} label={copyable.label} />}
    </div>
  );
}

export interface RequiredField {
  /** id do controle (recebe o foco quando for o primeiro invalido). */
  id: string;
  /** Nome mostrado na mensagem ("Preencha ou corrija: ..."). */
  label: string;
  /** O valor atual e valido? */
  ok: boolean;
}

/**
 * Validacao no estilo HPSM: `check()` no salvar destaca os campos invalidos
 * (borda/rotulo vermelhos), monta a mensagem para a barra e foca o primeiro.
 * O destaque acompanha os valores: some quando o campo e corrigido.
 */
export function useRequiredFields(fields: RequiredField[]) {
  const [shown, setShown] = useState(false);
  const missing = fields.filter((f) => !f.ok);

  return {
    /** true se tudo esta valido; senao destaca, foca o 1o invalido e devolve false. */
    check: () => {
      if (missing.length === 0) return true;
      setShown(true);
      document.getElementById(missing[0].id)?.focus();
      return false;
    },
    isInvalid: (id: string) => shown && missing.some((f) => f.id === id),
    message:
      shown && missing.length > 0
        ? `Preencha ou corrija os campos destacados: ${missing.map((f) => f.label).join(', ')}.`
        : null,
    reset: () => setShown(false),
  };
}
