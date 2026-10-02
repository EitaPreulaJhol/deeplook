import { Logout } from '@carbon/icons-react';
import {
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  Theme,
} from '@carbon/react';
import type { MouseEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { AppFooter } from './AppFooter';
import { RoleTag } from './tags';

/* Navegacao do app logado: a landing (/home) e publica, entao nao entra aqui. */
const NAV = [
  { to: '/history', label: 'Histórico Global' },
  { to: '/me', label: 'Meus Uploads' },
  { to: '/submit', label: 'Enviar Amostra' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Theme theme="g100">
      <Header aria-label="DeepLook">
        <HeaderName href="/history" onClick={go('/history')} prefix="">
          <span className="dl-brand">
            <img src="/deeplook.svg" alt="" className="dl-logo" />
            DeepLook
          </span>
        </HeaderName>
        <HeaderNavigation aria-label="Navegação principal">
          {NAV.map((item) => (
            <HeaderMenuItem
              key={item.to}
              href={item.to}
              isActive={pathname === item.to}
              onClick={go(item.to)}
            >
              {item.label}
            </HeaderMenuItem>
          ))}
          {user?.role === 'ADMIN' && (
            <HeaderMenuItem href="/admin" isActive={pathname === '/admin'} onClick={go('/admin')}>
              Administração
            </HeaderMenuItem>
          )}
        </HeaderNavigation>
        <HeaderGlobalBar>
          {user && (
            <div className="dl-header__user">
              <span className="dl-header__user-name">{user.displayName}</span>
              <RoleTag role={user.role} />
            </div>
          )}
          <HeaderGlobalAction
            aria-label={`Sair (${user?.displayName ?? ''})`}
            tooltipAlignment="end"
            onClick={handleLogout}
          >
            <Logout size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>
      <div className="dl-content">{children}</div>
      <AppFooter />
    </Theme>
  );
}
