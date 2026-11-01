import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { useConfirm } from './HpsmConfirm';
import { HpsmInboxMenu } from './HpsmInboxMenu';
import { HpsmQuickSearch } from './HpsmQuickSearch';
import { HpsmUserMenu } from './HpsmUserMenu';
import { IconMenu } from './icons';
import { roleLabel } from './tags';
import { discardUnsavedChanges, hasUnsavedChanges } from './useUnsavedChanges';
import { clearWorkspaceTabs } from './workspace';

interface TopBarProps {
  /** Abre/fecha o drawer da navegação no mobile. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function HpsmTopBar({ sidebarOpen, onToggleSidebar }: TopBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    navigate('/');
  };

  // Com formulario alterado, o Sair pergunta antes (o mesmo aviso de trocar de tela).
  const handleLogout = async () => {
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: 'Alterações não salvas',
        message: 'Há alterações não salvas nesta tela. Deseja sair mesmo assim e descartá-las?',
        confirmLabel: 'Sair',
        cancelLabel: 'Continuar editando',
        danger: true,
      });
      if (!ok) return;
    }
    await discardUnsavedChanges(async () => {
      await logout();
      clearWorkspaceTabs();
      navigate('/login');
    });
  };

  return (
    <header className="hpsm-topbar">
      <button
        type="button"
        className="hpsm-topbar__iconbtn hpsm-menu-toggle"
        aria-label={sidebarOpen ? 'Fechar navegação' : 'Abrir navegação'}
        aria-expanded={sidebarOpen}
        aria-controls="dl-sidebar"
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
