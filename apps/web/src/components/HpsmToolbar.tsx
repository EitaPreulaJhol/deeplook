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
  /** Acao perigosa (descartar, excluir): texto em vermelho. */
  danger?: boolean;
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
  danger,
}: HpsmToolbarButtonProps) {
  const className = `hpsm-toolbar__action${danger ? ' hpsm-toolbar__action--danger' : ''}`;
  const content = (
    <>
      {Icon && <Icon size={16} />}
      <span>{label}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a className={className} href={href} title={title}>
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
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
 * Botao que abre um menu de acoes (More Actions do HPSM). Clique, Enter, Espaco ou seta para baixo
 * abrem; Esc fecha e devolve o foco ao botao. `className` da a aparencia (item de toolbar, botao de
 * linha de tabela...); `menuLabel` e o nome do menu e do botao para leitor de tela.
 */
export function HpsmMenuButton({
  label,
  items,
  className,
  caretClassName = 'hpsm-toolbar__caret',
  menuLabel = label,
}: {
  label: string;
  items: ContextMenuItem[];
  className: string;
  caretClassName?: string;
  menuLabel?: string;
}) {
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
        className={className}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-label={menuLabel === label ? undefined : menuLabel}
        // O menu fecha com mousedown fora dele; aqui o proprio botao alterna.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (position ? close(false) : open())}
        onKeyDown={onKeyDown}
      >
        <span>{label}</span>
        <span className={caretClassName} aria-hidden="true">
          ▾
        </span>
      </button>
      {position && (
        <HpsmContextMenu
          x={position.x}
          y={position.y}
          label={menuLabel}
          items={items}
          onClose={close}
        />
      )}
    </>
  );
}

/** Botao "Mais ▾" da toolbar: as acoes menos usadas da tela. */
export function HpsmToolbarMenu({ label, items }: { label: string; items: ContextMenuItem[] }) {
  return <HpsmMenuButton label={label} items={items} className="hpsm-toolbar__action" />;
}
