import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';
import { HpsmMessageBar, MessageSlotProvider } from './messages';
import { WorkspaceProvider, WorkspaceTabs } from './workspace';

/** Preferencia local: navegador recolhido (so conveniencia de cada usuario). */
const NAV_COLLAPSED_KEY = 'dl-nav-collapsed';

function loadNavCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(loadNavCollapsed);
  // Barra de mensagens: guardada em estado para as paginas re-renderizarem
  // (via portal) assim que ela montar.
  const [messageSlot, setMessageSlot] = useState<HTMLElement | null>(null);

  const toggleNavCollapsed = () => {
    setNavCollapsed((value) => {
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        /* sem armazenamento: vale so ate recarregar */
      }
      return !value;
    });
  };

  return (
    <Theme theme="g10">
      <WorkspaceProvider>
        <div className="dl-shell">
          <HpsmTopBar onToggleSidebar={() => setSidebarOpen((value) => !value)} />

          <div className="dl-shell__body">
            <HpsmSidebar
              open={sidebarOpen}
              collapsed={navCollapsed}
              onToggleCollapsed={toggleNavCollapsed}
              onNavigate={() => setSidebarOpen(false)}
            />

            <div
              className={`hpsm-backdrop${sidebarOpen ? ' is-open' : ''}`}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />

            <main className="dl-content">
              <WorkspaceTabs />
              <HpsmMessageBar slotRef={setMessageSlot} />
              <MessageSlotProvider value={messageSlot}>
                <div className="dl-content__body">{children}</div>
              </MessageSlotProvider>
            </main>
          </div>
        </div>
      </WorkspaceProvider>
    </Theme>
  );
}
