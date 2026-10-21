import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { IconComponent } from './icons';
import { IconKey, IconLogout, IconPage, IconSettings } from './icons';

interface MenuItem {
  label: string;
  icon: IconComponent;
  action: () => void;
  /** Separador antes do item. */
  separated?: boolean;
}

interface HpsmUserMenuProps {
  name: string;
  onLogout: () => void;
}

/**
 * Nome do usuario no masthead que abre um submenu (Minha conta, Alterar senha,
 * Preferencias, Sair). Teclado: Enter/Espaco/seta abrem, setas e Home/End
 * navegam, Esc fecha e devolve o foco ao nome; Tab ou clique fora fecham.
 */
export function HpsmUserMenu({ name, onLogout }: HpsmUserMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const items: MenuItem[] = [
    { label: 'Minha conta', icon: IconPage, action: () => navigate('/user') },
    { label: 'Alterar senha', icon: IconKey, action: () => navigate('/user?tab=senha') },
    { label: 'Preferências', icon: IconSettings, action: () => navigate('/user?tab=preferencias') },
    { label: 'Sair', icon: IconLogout, action: onLogout, separated: true },
  ];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Ao abrir, o foco vai para o primeiro item.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Clique fora fecha o menu.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const last = items.length - 1;
    const focusAt = (index: number) => itemRefs.current[index]?.focus();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current >= last ? 0 : current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current <= 0 ? last : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(last);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div className="hpsm-usermenu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="hpsm-topbar__user-name"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
      >
        {name}
        <span className="hpsm-usermenu__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          className="hpsm-usermenu__panel"
          role="menu"
          aria-label="Menu do usuário"
          onKeyDown={onMenuKeyDown}
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
                onClick={() => {
                  close(false);
                  item.action();
                }}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
