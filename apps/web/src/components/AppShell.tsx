import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';
import { HpsmMessageBar, MessageSlotProvider } from './messages';
import { WorkspaceProvider, WorkspaceTabs } from './workspace';

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Barra de mensagens: guardada em estado para as paginas re-renderizarem
  // (via portal) assim que ela montar.
  const [messageSlot, setMessageSlot] = useState<HTMLElement | null>(null);

  return (
    <Theme theme="g10">
      <WorkspaceProvider>
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
