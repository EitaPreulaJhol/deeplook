import type { KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { IconComponent } from './icons';

export interface ContextMenuItem {
  label: string;
  icon?: IconComponent;
  action: () => void;
  disabled?: boolean;
  /** Separador antes do item. */
  separated?: boolean;
}

interface HpsmContextMenuProps {
  /** Canto superior esquerdo (coordenadas da janela). */
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  /** `restoreFocus`: Esc devolve o foco a quem abriu o menu. */
  onClose: (restoreFocus: boolean) => void;
}

/**
 * Menu de contexto no estilo HPSM (clique direito ou Shift+F10). Setas e
 * Home/End navegam, Enter executa, Esc fecha; clique fora ou Tab tambem fecham.
 */
export function HpsmContextMenu({ x, y, label, items, onClose }: HpsmContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState({ x, y });
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((i) => i >= 0);

  // Nao deixa o menu sair da janela (perto da borda direita/inferior).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    setPosition({
      x: Math.max(0, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(0, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    itemRefs.current[enabled[0]]?.focus();
    // So no primeiro render: o foco inicial vai para o primeiro item ativo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose(false);
    };
    const onScroll = () => onClose(false);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent) => {
    const current = enabled.indexOf(
      itemRefs.current.findIndex((el) => el === document.activeElement),
    );
    const focusAt = (i: number) => itemRefs.current[enabled[i]]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current >= enabled.length - 1 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current <= 0 ? enabled.length - 1 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(enabled.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        onClose(true);
        break;
      case 'Tab':
        event.preventDefault();
        onClose(true);
        break;
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="hpsm-ctxmenu"
      role="menu"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <div key={item.label} role="none">
          {item.separated && <div className="hpsm-usermenu__sep" role="separator" />}
          <button
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
            className="hpsm-usermenu__item"
            disabled={item.disabled}
            onClick={() => {
              onClose(false);
              item.action();
            }}
          >
            {item.icon ? (
              <item.icon size={16} />
            ) : (
              <span className="hpsm-ctxmenu__noicon" aria-hidden="true" />
            )}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
