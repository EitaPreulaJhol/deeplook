import { Theme } from '@carbon/react';
import type { ReactNode } from 'react';
import { Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { t } from '../i18n/shell';
import { BroadcastBanner } from './BroadcastBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { HpsmSidebar } from './HpsmSidebar';
import { HpsmTopBar } from './HpsmTopBar';
import { HpsmLoading, HpsmMessageBar, MessageSlotProvider } from './messages';
import { PasswordExpiryNotice } from './PasswordExpiryNotice';
import { ShortcutsProvider } from './shortcuts';
import { WorkspaceProvider, WorkspaceTabs } from './workspace';

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Trocar de tela limpa o aviso de erro: o boundary remonta com a rota nova.
  const { pathname } = useLocation();
  // Barra de mensagens: guardada em estado para as paginas re-renderizarem
  // (via portal) assim que ela montar.
  const [messageSlot, setMessageSlot] = useState<HTMLElement | null>(null);

  // Menu aberto no celular (item 133): o foco entra nele, e o Esc fecha e devolve o foco.
  useEffect(() => {
    if (!sidebarOpen) return;
    document.querySelector<HTMLElement>('#dl-sidebar a')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      document.querySelector<HTMLElement>('.hpsm-menu-toggle')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  return (
    <Theme theme="g10">
      <WorkspaceProvider>
        <ShortcutsProvider>
          <div className="dl-shell">
            {/* Primeiro Tab (item 132): sem isto sao dezenas de links ate o conteudo. */}
            <a
              className="dl-skip"
              href="#dl-conteudo"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById('dl-conteudo')?.focus();
              }}
            >
              {t('skipToContent')}
            </a>
            <HpsmTopBar
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
            />

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
                  <div id="dl-conteudo" className="dl-content__body" tabIndex={-1}>
                    {/* So o miolo cai (item 1.1): topo, navegador e abas ficam. */}
                    <ErrorBoundary key={pathname} variant="page">
                      {/* Paginas sob demanda (item 6.10): so o miolo espera o pacote. */}
                      <Suspense fallback={<HpsmLoading text={t('loadingDots')} />}>
                        {children}
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                </main>
              </div>
            </MessageSlotProvider>
          </div>
        </ShortcutsProvider>
      </WorkspaceProvider>
    </Theme>
  );
}
