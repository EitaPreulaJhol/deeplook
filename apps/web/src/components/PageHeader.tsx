import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

/** Pop-up aberto por um icone no canto direito do cabecalho. */
interface PageHeaderPopover {
  icon: ReactNode;
  label: string;
  content: ReactNode;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  popover?: PageHeaderPopover;
}

/** Cabecalho padrao das paginas: barra de painel no estilo HP Service Manager. */
export function PageHeader({ title, subtitle, actions, popover }: PageHeaderProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fecha o pop-up ao clicar fora dele ou pressionar Esc.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <header className="dl-page-head">
      <div className="dl-page-head__title">
        <h1 className="dl-page-header">{title}</h1>
        {subtitle && <p className="dl-page-subtitle">{subtitle}</p>}
      </div>
      <div className="dl-page-head__right">
        {actions && <div className="dl-page-head__actions">{actions}</div>}
        {popover && (
          <div className="dl-head-popover" ref={popoverRef}>
            <button
              type="button"
              className="dl-head-popover__toggle"
              aria-label={popover.label}
              title={popover.label}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {popover.icon}
            </button>
            {open && <div className="dl-head-popover__panel">{popover.content}</div>}
          </div>
        )}
      </div>
    </header>
  );
}
