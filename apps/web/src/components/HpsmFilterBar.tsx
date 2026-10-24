import { Button } from '@carbon/react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
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
      title: 'Salvar visão',
      message: 'A busca, os filtros e a ordenação atuais vão para a pasta Favoritos do navegador.',
      label: 'Nome',
      defaultValue: viewName,
      confirmLabel: 'Salvar',
    });
    if (!label) return;
    try {
      await addView(label, currentViewUrl(pathname, search));
      setNotice({ kind: 'success', text: `Visão "${label}" salva nos Favoritos.` });
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    }
  };

  const shareView = async () => {
    const label = await prompt({
      title: 'Compartilhar visão',
      message:
        'A busca, os filtros e a ordenação atuais vão para a pasta Visões da equipe, no navegador de todos os analistas.',
      label: 'Nome',
      defaultValue: viewName,
      confirmLabel: 'Compartilhar',
    });
    if (!label) return;
    try {
      await team.share(label, currentViewUrl(pathname, search));
      setNotice({ kind: 'success', text: `Visão "${label}" compartilhada com a equipe.` });
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
            aria-label={`Remover o filtro: ${chip.label}`}
            title="Remover filtro"
            onClick={chip.onRemove}
          >
            ×
          </button>
        </span>
      ))}
      <Button kind="secondary" size="sm" onClick={onClear}>
        Limpar
      </Button>
      {viewName !== undefined && (
        <Button
          kind="secondary"
          size="sm"
          onClick={() => void saveView()}
          title="Guardar esta busca e filtros na pasta Favoritos do navegador"
        >
          Salvar visão
        </Button>
      )}
      {viewName !== undefined && canShare && (
        <Button
          kind="secondary"
          size="sm"
          onClick={() => void shareView()}
          title="Mostrar esta busca e filtros na pasta Visões da equipe de todos os analistas"
        >
          Compartilhar visão
        </Button>
      )}
      {exportHref && (
        <Button
          kind="secondary"
          size="sm"
          href={exportHref}
          title="Baixar a lista filtrada (todas as páginas) em CSV"
        >
          Exportar CSV
        </Button>
      )}
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
