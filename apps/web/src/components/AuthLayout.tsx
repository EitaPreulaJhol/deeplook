import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  /** Link para a outra tela de acesso, abaixo da caixa a direita (ex.: "Criar conta"). */
  altLink?: { to: string; label: string };
  children: ReactNode;
}

/** Barra azul do topo das paginas publicas (mesma do app logado). */
export function PublicMasthead() {
  return (
    <header className="hpsm-topbar">
      <Link className="hpsm-topbar__brand" to="/home">
        <img src="/icons/magnifier.svg" alt="" className="dl-logo" />
        <span>DeepLook</span>
      </Link>
    </header>
  );
}

/** Rodape legal das paginas publicas. */
export function PublicLegal() {
  return (
    <footer className="dl-public__legal">
      <a href="#" onClick={(event) => event.preventDefault()}>
        Termos de uso
      </a>
      <span aria-hidden="true">|</span>
      <a href="#" onClick={(event) => event.preventDefault()}>
        Privacidade e cookies
      </a>
      <span aria-hidden="true">|</span>
      <span>DeepLook © 2026</span>
    </footer>
  );
}

/**
 * Layout das telas de autenticacao no estilo da tela de login do HP Service
 * Manager: masthead azul e uma caixa centralizada com cabecalho proprio.
 */
export function AuthLayout({ title, subtitle, altLink, children }: AuthLayoutProps) {
  return (
    <div className="dl-public">
      <PublicMasthead />

      <main className="dl-public__main">
        <section className="dl-box dl-auth" aria-labelledby="dl-auth-title">
          <h1 id="dl-auth-title" className="dl-box__head">
            {title}
          </h1>
          <div className="dl-box__body">
            {subtitle && <p className="dl-auth__subtitle">{subtitle}</p>}
            {children}
          </div>
        </section>

        <nav className="dl-public__nav">
          <Link className="dl-public__link" to="/home">
            ← Voltar para o início
          </Link>
          {altLink && (
            <Link className="dl-public__link" to={altLink.to}>
              {altLink.label}
            </Link>
          )}
        </nav>
      </main>

      <PublicLegal />
    </div>
  );
}
