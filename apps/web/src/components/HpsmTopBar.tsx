import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { HpsmInboxMenu } from './HpsmInboxMenu';
import { HpsmQuickSearch } from './HpsmQuickSearch';
import { HpsmUserMenu } from './HpsmUserMenu';
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
    navigate('/');
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

      <a className="hpsm-topbar__brand" href="/" onClick={goHome}>
        <img src="/icons/magnifier.svg" alt="" className="dl-logo" />
        <span>DeepLook</span>
      </a>

      <span className="hpsm-topbar__spacer" />

      {user && <HpsmQuickSearch />}

      {/* O nome abre o submenu do usuario (Minha conta, Senha, Preferencias, Sair). */}
      <div className="hpsm-topbar__links">
        {user && <HpsmInboxMenu />}
        {user && (
          <span className="hpsm-topbar__user">
            <HpsmUserMenu name={user.displayName} onLogout={handleLogout} />
            <span className="hpsm-topbar__role">({roleLabel(user.role)})</span>
          </span>
        )}
      </div>
    </header>
  );
}
