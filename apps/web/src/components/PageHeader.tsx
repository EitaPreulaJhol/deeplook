import { Close, Renew, Settings } from '@carbon/icons-react';
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
        {/* Controles de painel do HPSM (decorativos, nao clicaveis). */}
        <span className="dl-panel-controls" aria-hidden="true">
          <Renew size={14} />
          <Settings size={14} />
          <Close size={14} />
        </span>
      </div>
    </header>
  );
}
