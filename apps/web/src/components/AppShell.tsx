import { Close } from '@carbon/icons-react';
import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AppFooter } from './AppFooter';
import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';

const TITLES: Record<string, string> = {
  '/history': 'Histórico Global',
  '/me': 'Meus Uploads',
  '/submit': 'Enviar Amostra',
  '/admin': 'Administração',
};

/** Titulo da "aba" aberta com base na rota atual (estilo HPSM). */
function tabTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/entries/')) return 'Amostra';
  return 'DeepLook';
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Theme theme="g10">
      <div className="dl-shell">
        <HpsmTopBar onToggleSidebar={() => setSidebarOpen((value) => !value)} />

        <div className="dl-shell__body">
          <HpsmSidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

          <div
            className={`hpsm-backdrop${sidebarOpen ? ' is-open' : ''}`}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />

          <main className="dl-content">
            <div className="hpsm-tabbar" role="tablist" aria-label="Documentos abertos">
              <div className="hpsm-tab is-active" role="tab" aria-selected="true">
                <span className="hpsm-tab__label">{tabTitle(pathname)}</span>
                <button
                  type="button"
                  className="hpsm-tab__close"
                  aria-label="Fechar aba"
                  onClick={() => navigate('/history')}
                >
                  <Close size={12} />
                </button>
              </div>
            </div>

            {children}
          </main>
        </div>

        <AppFooter />
      </div>
    </Theme>
  );
}
