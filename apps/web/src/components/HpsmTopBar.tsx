import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { IconMenu } from './icons';
import { roleLabel } from './tags';
import { clearWorkspaceTabs } from './workspace';

interface TopBarProps {
  /** Abre/fecha o drawer da navegação no mobile. */
  onToggleSidebar: () => void;
}

export function HpsmTopBar({ onToggleSidebar }: TopBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    navigate('/history');
  };

  const handleLogout = async () => {
    await logout();
    clearWorkspaceTabs();
    navigate('/login');
  };

  return (
    <header className="hpsm-topbar">
      <button
        type="button"
        className="hpsm-topbar__iconbtn hpsm-menu-toggle"
        aria-label="Abrir navegação"
        onClick={onToggleSidebar}
      >
        <IconMenu size={18} />
      </button>

      <a className="hpsm-topbar__brand" href="/history" onClick={goHome}>
        <img src="/deeplook.svg" alt="" className="dl-logo" />
        <span>DeepLook</span>
      </a>

      <span className="hpsm-topbar__spacer" />

      {/* Links de texto separados por "|", como no masthead do HPSM. */}
      <div className="hpsm-topbar__links">
        {user && (
          <>
            <span className="hpsm-topbar__user">
              <span className="hpsm-topbar__user-name">{user.displayName}</span> (
              {roleLabel(user.role)})
            </span>
            <span className="hpsm-topbar__pipe" aria-hidden="true">
              |
            </span>
          </>
        )}
        <button type="button" className="hpsm-topbar__link" onClick={handleLogout}>
          Sair
        </button>
      </div>
    </header>
  );
}
