import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Cabecalho padrao das paginas: barra de painel no estilo HP Service Manager. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="dl-page-head">
      <div className="dl-page-head__title">
        <h1 className="dl-page-header">{title}</h1>
        {subtitle && <p className="dl-page-subtitle">{subtitle}</p>}
      </div>
      <div className="dl-page-head__right">
        {actions && <div className="dl-page-head__actions">{actions}</div>}
      </div>
    </header>
  );
}
