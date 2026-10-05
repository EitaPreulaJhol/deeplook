import { Add, Logout, Menu } from '@carbon/icons-react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { RoleTag } from './tags';

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
        <Menu size={18} />
      </button>

      <a className="hpsm-topbar__brand" href="/history" onClick={goHome}>
        <img src="/deeplook.svg" alt="" className="dl-logo" />
        <span>DeepLook</span>
      </a>

      <span className="hpsm-topbar__spacer" />

      <div className="hpsm-topbar__tools">
        {user && (
          <div className="hpsm-topbar__user">
            <span className="hpsm-topbar__user-name">{user.displayName}</span>
            <RoleTag role={user.role} />
          </div>
        )}

        <button type="button" className="hpsm-topbar__iconbtn" onClick={() => navigate('/submit')}>
          <Add size={16} />
          <span>Enviar amostra</span>
        </button>

        <button
          type="button"
          className="hpsm-topbar__iconbtn"
          aria-label={`Sair (${user?.displayName ?? ''})`}
          onClick={handleLogout}
        >
          <Logout size={16} />
          <span>Sair</span>
        </button>
      </div>
    </header>
  );
}
