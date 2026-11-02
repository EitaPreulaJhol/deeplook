import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Rede de segurança do render (item 1.1 do plano de melhorias).
 *
 * Sem isto, uma exceção em qualquer componente desmonta a árvore inteira do
 * React e o usuário fica com a tela branca, sem mensagem nem saída — perdendo
 * as abas de documento abertas. São dois usos:
 *
 * - `variant="app"` no `main.tsx`, por fora dos provedores: pega até a falha
 *   que acontece antes de existir sessão ou roteador;
 * - `variant="page"` no `AppShell`, em volta do conteúdo: a casca (topo,
 *   navegador e abas) continua de pé e só o miolo é trocado pelo aviso.
 *
 * Não usa hook de roteador nem componente do Carbon de propósito: um aviso de
 * erro que depende do que acabou de quebrar não aparece. As classes do Carbon
 * entram direto no `className`, só para o botão sair com a cara do HPSM.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** `app`: tela cheia, fora da casca. `page`: painel no lugar do conteúdo. */
  variant?: 'app' | 'page';
  /** Chamado por "Tentar de novo", antes de o conteúdo voltar a ser renderizado. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

const EMPTY: ErrorBoundaryState = { error: null, componentStack: null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = EMPTY;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    // O smoke test reprova erro inesperado no console, entao este log so sai
    // quando a tela realmente quebrou — que e exatamente o que ele deve pegar.
    console.error('[deeplook] erro ao desenhar a tela', error, info.componentStack);
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState(EMPTY);
  };

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const page = this.props.variant !== 'app';
    const detail = [error.stack ?? String(error), componentStack].filter(Boolean).join('\n');

    return (
      <div className={`dl-errbox${page ? ' dl-errbox--page' : ''}`} role="alert">
        <div className="dl-errbox__panel">
          <div className="dl-errbox__head">
            <span className="dl-errbox__icon" aria-hidden="true">
              ×
            </span>
            <span>Esta tela não pôde ser exibida</span>
          </div>

          <p className="dl-errbox__text">
            Houve uma falha ao desenhar o conteúdo. Nada do que estava gravado se perdeu
            {page ? ', e as outras abas continuam abertas.' : '.'}
          </p>

          <p className="dl-errbox__reason">{error.message || 'Erro desconhecido.'}</p>

          <div className="dl-errbox__actions">
            {page && (
              <button type="button" className="cds--btn cds--btn--secondary" onClick={this.reset}>
                Tentar de novo
              </button>
            )}
            <button
              type="button"
              className="cds--btn cds--btn--secondary"
              onClick={() => window.location.reload()}
            >
              Recarregar a página
            </button>
            <button
              type="button"
              className="cds--btn cds--btn--secondary"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Voltar ao início
            </button>
          </div>

          {detail && (
            <details className="dl-errbox__details">
              <summary>Detalhes técnicos</summary>
              <pre>{detail}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
