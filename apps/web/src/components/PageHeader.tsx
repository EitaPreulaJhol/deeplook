import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Cabecalho padrao das paginas do app (mesmo desenho em todas as telas). */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="dl-page-head">
      <div>
        <h1 className="dl-page-header">{title}</h1>
        {subtitle && <p className="dl-page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="dl-page-head__actions">{actions}</div>}
    </header>
  );
}
