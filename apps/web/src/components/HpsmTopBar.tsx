import { Help, Locked, Logout, Menu, Search } from '@carbon/icons-react';
import type { FormEvent, MouseEvent } from 'react';
import { useState } from 'react';
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
  const [term, setTerm] = useState('');

  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    navigate('/history');
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = term.trim();
    navigate(q ? `/history?q=${encodeURIComponent(q)}` : '/history');
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
        <form className="hpsm-search hpsm-topbar__search--command" onSubmit={handleSearch}>
          <input
            type="text"
            aria-label="Buscar amostras"
            placeholder="Buscar..."
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button type="submit" className="hpsm-topbar__iconbtn" aria-label="Buscar">
            <Search size={16} />
          </button>
        </form>

        <button
          type="button"
          className="hpsm-topbar__iconbtn"
          aria-label="Ajuda"
          title="Ajuda"
          onClick={() => navigate('/home')}
        >
          <Help size={16} />
        </button>

        <span className="hpsm-topbar__iconbtn" aria-hidden="true" title="Sessão segura">
          <Locked size={16} />
        </span>

        {user && (
          <div className="hpsm-topbar__user">
            <span className="hpsm-topbar__user-name">{user.displayName}</span>
            <RoleTag role={user.role} />
          </div>
        )}

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
