// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactElement, Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';
import { lazyPage } from './lazyPage';

/** Mesma defesa do ErrorBoundary.test: o jsdom imprimiria a pilha do erro capturado. */
const swallow = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  window.addEventListener('error', swallow);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', swallow);
  vi.restoreAllMocks();
});

describe('lazyPage', () => {
  it('mostra o fallback enquanto o pacote baixa e depois a página (export nomeado)', async () => {
    let release!: (module: { Hello: () => ReactElement }) => void;
    const load = () =>
      new Promise<{ Hello: () => ReactElement }>((resolve) => {
        release = resolve;
      });
    const Page = lazyPage(load, 'Hello');

    render(
      <Suspense fallback={<p>carregando…</p>}>
        <Page />
      </Suspense>,
    );
    expect(screen.getByText('carregando…')).toBeTruthy();

    release({ Hello: () => <p>página pronta</p> });
    expect(await screen.findByText('página pronta')).toBeTruthy();
    expect(screen.queryByText('carregando…')).toBeNull();
  });

  it('repassa as props à página', async () => {
    const Page = lazyPage(
      () => Promise.resolve({ Greeting: ({ name }: { name: string }) => <p>oi, {name}</p> }),
      'Greeting',
    );
    render(
      <Suspense fallback={null}>
        <Page name="Bruno" />
      </Suspense>,
    );
    expect(await screen.findByText('oi, Bruno')).toBeTruthy();
  });

  it('pacote que não baixa (deploy novo) vai parar no ErrorBoundary, com o motivo', async () => {
    const Page = lazyPage(
      () => Promise.reject(new Error('Failed to fetch dynamically imported module')) as never,
      'Qualquer',
    );
    render(
      <ErrorBoundary variant="page">
        <Suspense fallback={<p>carregando…</p>}>
          <Page />
        </Suspense>
      </ErrorBoundary>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Esta tela não pôde ser exibida');
    expect(alert.textContent).toContain('Failed to fetch dynamically imported module');
    // O botão que de fato resolve, nesse caso, é recarregar a página.
    expect(screen.getByText('Recarregar a página')).toBeTruthy();
  });
});
