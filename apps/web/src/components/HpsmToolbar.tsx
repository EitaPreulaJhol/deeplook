import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';

import type { ContextMenuItem } from './HpsmContextMenu';
import { HpsmContextMenu } from './HpsmContextMenu';
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
  /** Botao liga/desliga (ex.: Fixar): aparece afundado quando ativo. */
  pressed?: boolean;
}

/** Botao pequeno da toolbar: icone 16px + texto, sem moldura ate o hover. */
export function HpsmToolbarButton({
  label,
  icon: Icon,
  href,
  onClick,
  disabled,
  title,
  pressed,
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
      aria-pressed={pressed}
    >
      {content}
    </button>
  );
}

/**
 * Botao "Mais ▾" da toolbar (More Actions do HPSM): abre um menu com as acoes
 * menos usadas. Clique, Enter, Espaco ou seta para baixo abrem; Esc fecha e
 * devolve o foco ao botao.
 */
export function HpsmToolbarMenu({ label, items }: { label: string; items: ContextMenuItem[] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ x: rect.left, y: rect.bottom + 1 });
  };
  const close = useCallback((restoreFocus: boolean) => {
    setPosition(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="hpsm-toolbar__action"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        // O menu fecha com mousedown fora dele; aqui o proprio botao alterna.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (position ? close(false) : open())}
        onKeyDown={onKeyDown}
      >
        <span>{label}</span>
        <span className="hpsm-toolbar__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {position && (
        <HpsmContextMenu
          x={position.x}
          y={position.y}
          label={label}
          items={items}
          onClose={close}
        />
      )}
    </>
  );
}
