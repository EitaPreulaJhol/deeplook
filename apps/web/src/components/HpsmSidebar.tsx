import type { CarbonIconType } from '@carbon/icons-react';
import { Catalog, ChevronLeft, Folder, Settings } from '@carbon/icons-react';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

interface SidebarProps {
  /** Controle do drawer no mobile (a sidebar fica off-canvas). */
  open: boolean;
  /** Fecha o drawer apos navegar (mobile). */
  onNavigate?: () => void;
}

interface NavLeaf {
  to: string;
  label: string;
  icon: CarbonIconType;
}

/* Menu principal: amostras (todas as contas). */
const PRIMARY: NavLeaf[] = [
  { to: '/history', label: 'Histórico Global', icon: Catalog },
  { to: '/me', label: 'Meus Uploads', icon: Folder },
];

export function HpsmSidebar({ open, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(to);
    onNavigate?.();
  };

  const classes = ['hpsm-sidebar', collapsed ? 'is-collapsed' : '', open ? 'is-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <aside className={classes} aria-label="Navegação principal">
      <div className="hpsm-sidebar__bar">
        <button
          type="button"
          className="hpsm-sidebar__bar-btn hpsm-sidebar__collapse"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-pressed={collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <nav className="hpsm-nav">
        <div className="hpsm-nav__group-label">Amostras</div>
        <ul className="hpsm-nav__list">
          {PRIMARY.map((item) => (
            <li key={item.to}>
              <a
                href={item.to}
                className={`hpsm-nav__item${pathname === item.to ? ' is-active' : ''}`}
                onClick={go(item.to)}
              >
                <span className="hpsm-nav__icon">
                  <item.icon size={16} />
                </span>
                <span className="hpsm-nav__label">{item.label}</span>
              </a>
            </li>
          ))}
        </ul>

        {isAdmin && (
          <>
            <div className="hpsm-nav__divider" />
            <div className="hpsm-nav__group-label">Administração</div>
            <ul className="hpsm-nav__list">
              <li>
                <a
                  href="/admin"
                  className={`hpsm-nav__item${pathname === '/admin' ? ' is-active' : ''}`}
                  onClick={go('/admin')}
                >
                  <span className="hpsm-nav__icon">
                    <Settings size={16} />
                  </span>
                  <span className="hpsm-nav__label">Administração</span>
                </a>
              </li>
            </ul>
          </>
        )}
      </nav>
    </aside>
  );
}
