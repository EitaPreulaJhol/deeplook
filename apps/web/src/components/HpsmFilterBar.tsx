import { Button } from '@carbon/react';
import type { ReactNode } from 'react';

/**
 * Linha de filtro fixa acima da lista (como os seletores "Fila:" / "Visao:"
 * do HP Service Manager). A lista se atualiza sozinha ao mudar um filtro.
 */
export function HpsmFilterBar({ onClear, children }: { onClear: () => void; children: ReactNode }) {
  return (
    <div className="hpsm-filterbar" role="search">
      {children}
      <Button kind="secondary" size="sm" onClick={onClear}>
        Limpar
      </Button>
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
