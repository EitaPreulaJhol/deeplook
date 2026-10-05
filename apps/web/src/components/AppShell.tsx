import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { AppFooter } from './AppFooter';
import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';

export function AppShell({ children }: { children: ReactNode }) {
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

          <main className="dl-content">{children}</main>
        </div>

        <AppFooter />
      </div>
    </Theme>
  );
}
