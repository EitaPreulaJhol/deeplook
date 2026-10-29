import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { BroadcastBanner } from './BroadcastBanner';
import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';
import { HpsmMessageBar, MessageSlotProvider } from './messages';
import { PasswordExpiryNotice } from './PasswordExpiryNotice';
import { ShortcutsProvider } from './shortcuts';
import { WorkspaceProvider, WorkspaceTabs } from './workspace';

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Barra de mensagens: guardada em estado para as paginas re-renderizarem
  // (via portal) assim que ela montar.
  const [messageSlot, setMessageSlot] = useState<HTMLElement | null>(null);

  return (
    <Theme theme="g10">
      <WorkspaceProvider>
        <ShortcutsProvider>
          <div className="dl-shell">
            <HpsmTopBar onToggleSidebar={() => setSidebarOpen((value) => !value)} />

            {/* A barra de mensagens recebe tambem os avisos do navegador (Favoritos). */}
            <MessageSlotProvider value={messageSlot}>
              <div className="dl-shell__body">
                <HpsmSidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

                <div
                  className={`hpsm-backdrop${sidebarOpen ? ' is-open' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                  aria-hidden="true"
                />

                <main className="dl-content">
                  <WorkspaceTabs />
                  {/* Avisos gerais da equipe (item 88). */}
                  <BroadcastBanner />
                  <HpsmMessageBar slotRef={setMessageSlot} />
                  <PasswordExpiryNotice />
                  <div className="dl-content__body">{children}</div>
                </main>
              </div>
            </MessageSlotProvider>
          </div>
        </ShortcutsProvider>
      </WorkspaceProvider>
    </Theme>
  );
}
