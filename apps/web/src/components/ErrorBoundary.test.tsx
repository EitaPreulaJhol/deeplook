// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

/** Componente que quebra enquanto `broken` for verdadeiro. */
let broken = true;
function Bomb() {
  if (broken) throw new Error('campo inesperado da amostra');
  return <p>conteúdo da tela</p>;
}

let consoleError: ReturnType<typeof vi.spyOn>;

/**
 * O React dispara o erro de render como evento no DOM; sem cancelar, o jsdom imprime a
 * pilha de cada erro que o boundary captura de propósito e o log do teste vira ruído.
 */
const swallow = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
  broken = true;
  window.addEventListener('error', swallow);
  // O React e o próprio boundary escrevem no console quando a tela quebra: silencia e confere.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', swallow);
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('sem falha, mostra o conteúdo e nada mais', () => {
    broken = false;
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo da tela')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('com falha, troca o conteúdo por um aviso com o motivo e registra no console', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Esta tela não pôde ser exibida');
    expect(alert.textContent).toContain('campo inesperado da amostra');
    expect(screen.queryByText('conteúdo da tela')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '[deeplook] erro ao desenhar a tela',
      expect.any(Error),
      expect.any(String),
    );
  });

  it('os detalhes técnicos trazem a pilha, para colar num relato', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Detalhes técnicos')).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toContain('campo inesperado da amostra');
  });

  it('variante "page": painel no lugar do conteúdo, com "Tentar de novo"', () => {
    const { container } = render(
      <ErrorBoundary variant="page">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(container.querySelector('.dl-errbox--page')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('as outras abas continuam abertas');
    expect(screen.getByText('Tentar de novo')).toBeTruthy();
  });

  it('variante "app": tela cheia, sem "Tentar de novo", com recarregar e voltar ao início', () => {
    const { container } = render(
      <ErrorBoundary variant="app">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(container.querySelector('.dl-errbox--page')).toBeNull();
    expect(screen.queryByText('Tentar de novo')).toBeNull();
    expect(screen.getByText('Recarregar a página')).toBeTruthy();
    expect(screen.getByText('Voltar ao início')).toBeTruthy();
  });
});

describe('ErrorBoundary: recuperação', () => {
  it('"Tentar de novo" chama onReset e volta ao conteúdo quando a causa passou', () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary variant="page" onReset={onReset}>
        <Bomb />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByText('Tentar de novo'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('conteúdo da tela')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('se ainda quebra depois de tentar de novo, o aviso volta (sem laço)', () => {
    render(
      <ErrorBoundary variant="page">
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('Tentar de novo'));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('trocar a `key` (o AppShell usa a rota) limpa o aviso sozinho', () => {
    const { rerender } = render(
      <ErrorBoundary key="/entries/1" variant="page">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    broken = false;
    rerender(
      <ErrorBoundary key="/history" variant="page">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo da tela')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
