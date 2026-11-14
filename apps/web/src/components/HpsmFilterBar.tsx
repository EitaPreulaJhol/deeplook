import { Button } from '@carbon/react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/entry';
import { currentViewUrl, useFavorites } from './favorites';
import { usePrompt } from './HpsmConfirm';
import type { HpsmMessageKind } from './messages';
import { HpsmMessage } from './messages';
import { useTeamViews } from './teamViews';

/**
 * Linha de filtro fixa acima da lista (como os seletores "Fila:" / "Visao:"
 * do HP Service Manager). A lista se atualiza sozinha ao mudar um filtro.
 */
export function HpsmFilterBar({
  onClear,
  exportHref,
  viewName,
  chips = [],
  children,
}: {
  onClear: () => void;
  /** URL do CSV com os mesmos filtros (mostra o botao "Exportar CSV"). */
  exportHref?: string;
  /** Nome sugerido para "Salvar visão" (mostra o botao; a visao vai para os Favoritos). */
  viewName?: string;
  /** Filtros sem controle na barra (ex.: periodo vindo do Painel), removiveis. */
  chips?: { label: string; onRemove: () => void }[];
  children: ReactNode;
}) {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const { addView } = useFavorites();
  // Visoes da equipe (item 62): so analistas, so no Historico Global.
  const canShare = (user?.role === 'ANALYST' || user?.role === 'ADMIN') && pathname === '/history';
  const team = useTeamViews(false);
  const prompt = usePrompt();
  const [notice, setNotice] = useState<{ kind: HpsmMessageKind; text: string } | null>(null);

  // O aviso da ultima visao salva some quando os filtros mudam.
  useEffect(() => setNotice(null), [search]);

  const saveView = async () => {
    const label = await prompt({
      title: t('saveView'),
      message: t('saveViewHelp'),
      label: t('name'),
      defaultValue: viewName,
      confirmLabel: t('save'),
    });
    if (!label) return;
    try {
      await addView(label, currentViewUrl(pathname, search));
      setNotice({ kind: 'success', text: t('viewSaved', { label }) });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  };

  const shareView = async () => {
    const label = await prompt({
      title: t('shareView'),
      message: t('shareViewHelp'),
      label: t('name'),
      defaultValue: viewName,
      confirmLabel: t('share'),
    });
    if (!label) return;
    try {
      await team.share(label, currentViewUrl(pathname, search));
      setNotice({ kind: 'success', text: t('viewShared', { label }) });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <div className="hpsm-filterbar" role="search">
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.kind}>
          {notice.text}
        </HpsmMessage>
      )}
      {children}
      {chips.map((chip) => (
        <span key={chip.label} className="hpsm-filterbar__chip">
          {chip.label}
          <button
            type="button"
            className="hpsm-filterbar__chip-x"
            aria-label={t('removeFilter', { label: chip.label })}
            title={t('removeFilterTitle')}
            onClick={chip.onRemove}
          >
            ×
          </button>
        </span>
      ))}
      {/* Botoes num bloco so: quebram de linha juntos e ficam mais proximos entre si que os filtros. */}
      <span className="hpsm-filterbar__actions">
        <Button kind="secondary" size="sm" onClick={onClear}>
          {t('clear')}
        </Button>
        {viewName !== undefined && (
          <Button
            kind="secondary"
            size="sm"
            onClick={() => void saveView()}
            title={t('saveViewTitle')}
          >
            {t('saveView')}
          </Button>
        )}
        {viewName !== undefined && canShare && (
          <Button
            kind="secondary"
            size="sm"
            onClick={() => void shareView()}
            title={t('shareViewTitle')}
          >
            {t('shareView')}
          </Button>
        )}
        {exportHref && (
          <Button kind="secondary" size="sm" href={exportHref} title={t('exportCsvTitle')}>
            {t('exportCsv')}
          </Button>
        )}
      </span>
    </div>
  );
}

/** Rotulo + controle de um filtro (o controle do Carbon usa `hideLabel`). */
export function HpsmFilterItem({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="hpsm-filterbar__item">
      <label className="hpsm-filterbar__label" htmlFor={htmlFor} aria-hidden="true">
        {label}:
      </label>
      {children}
    </div>
  );
}
