import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { getLocale, isLocale, LOCALES, setLocale, t } from '../i18n';
import { t as tr } from '../i18n/shell';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  /** Link para a outra tela de acesso, abaixo da caixa a direita (ex.: "Criar conta"). */
  altLink?: { to: string; label: string };
  /** Esconde "Voltar para o inicio" (telas de quem ja esta logado, ex.: troca obrigatoria). */
  hideBack?: boolean;
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
      <span className="hpsm-topbar__spacer" />
      <LanguageSelect />
    </header>
  );
}

/** Idioma nas paginas publicas (antes do login): fica guardado nesta maquina. */
export function LanguageSelect() {
  return (
    <label className="dl-lang">
      <span className="cds--visually-hidden">{t('lang.label')}</span>
      <select
        value={getLocale()}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rodape legal das paginas publicas. */
export function PublicLegal() {
  return (
    <footer className="dl-public__legal">
      <a href="#" onClick={(event) => event.preventDefault()}>
        {t('auth.terms')}
      </a>
      <span aria-hidden="true">|</span>
      <a href="#" onClick={(event) => event.preventDefault()}>
        {t('auth.privacy')}
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
export function AuthLayout({ title, subtitle, altLink, hideBack, children }: AuthLayoutProps) {
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
          {!hideBack && (
            <Link className="dl-public__link" to="/home">
              {tr('backToStart')}
            </Link>
          )}
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
