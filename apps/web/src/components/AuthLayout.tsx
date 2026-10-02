import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Layout padrao das telas de autenticacao (login e cadastro). */
export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="dl-auth">
      <main className="dl-auth__main">
        <header className="dl-auth__brand">
          <img src="/deeplook.svg" alt="" className="dl-logo" />
          <span>DeepLook</span>
        </header>

        <section className="dl-auth__card">
          <h2 className="dl-auth__title">{title}</h2>
          {subtitle && <p className="dl-auth__subtitle">{subtitle}</p>}
          {children}
        </section>

        <nav className="dl-auth__nav">
          <Link className="dl-auth__back" to="/home">
            ← Voltar para o início
          </Link>
        </nav>
      </main>

      <footer className="dl-auth__legal">
        <div className="dl-auth__legal-links">
          <a href="#" onClick={(event) => event.preventDefault()}>
            Termos de uso
          </a>
          <span aria-hidden="true">•</span>
          <a href="#" onClick={(event) => event.preventDefault()}>
            Privacidade e cookies
          </a>
        </div>
      </footer>
    </div>
  );
}
