import type { ReactNode } from 'react';
import { useId, useState } from 'react';

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
  children: ReactNode;
}

/**
 * Linha rotulo/campo no estilo HPSM: rotulo a esquerda (alinhado a direita,
 * com dois-pontos) e o controle ao lado. Os controles do Carbon usam
 * `hideLabel`, que mantem o nome acessivel; por isso o rotulo visivel fica
 * fora da arvore de acessibilidade (sem leitura duplicada).
 */
export function HpsmField({ label, htmlFor, required, wide, top, help, children }: HpsmFieldProps) {
  const classes = ['hpsm-field', wide && 'hpsm-field--wide', top && 'hpsm-field--top']
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
  children,
}: {
  multiline?: boolean;
  mono?: boolean;
  children: ReactNode;
}) {
  const classes = ['hpsm-readonly', multiline && 'hpsm-readonly--multiline', mono && 'dl-mono']
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}
