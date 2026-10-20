import type { ReactNode } from 'react';

import type { IconComponent } from './icons';

/** Barra de acoes do registro (Voltar, Salvar, Cancelar...) no topo do form. */
export function HpsmToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="hpsm-toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/** Divisoria vertical entre grupos de acoes. */
export function HpsmToolbarDivider() {
  return <span className="hpsm-toolbar__divider" aria-hidden="true" />;
}

interface HpsmToolbarButtonProps {
  label: string;
  icon?: IconComponent;
  /** Renderiza um link (ex.: download) em vez de botao. */
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

/** Botao pequeno da toolbar: icone 16px + texto, sem moldura ate o hover. */
export function HpsmToolbarButton({
  label,
  icon: Icon,
  href,
  onClick,
  disabled,
  title,
}: HpsmToolbarButtonProps) {
  const content = (
    <>
      {Icon && <Icon size={16} />}
      <span>{label}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a className="hpsm-toolbar__action" href={href} title={title}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="hpsm-toolbar__action"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {content}
    </button>
  );
}
