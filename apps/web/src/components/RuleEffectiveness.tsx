import { Checkbox, TableCell, TableHeader } from '@carbon/react';
import { useState } from 'react';

import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';
import { StatusText } from './tags';

/**
 * Eficacia das regras (plano pos-revisao, item 2.3): em quantas amostras a regra disparou nos
 * ultimos dias e quantas delas terminaram limpas. Usado nas listas de regras de triagem e YARA
 * (da equipe e dos pacotes).
 */
export interface RuleEffectiveness {
  fired: number;
  clean: number;
}

type SortKey = 'fired' | 'clean';
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null;

/** Disparou bastante e, na maior parte, em amostra que terminou limpa: candidata a ajuste. */
const NOISY_MIN_FIRED = 3;
const NOISY_SHARE = 0.5;

const share = (e?: RuleEffectiveness) => (e && e.fired ? e.clean / e.fired : -1);

/** Ordenacao pelas duas colunas e o filtro "so as que nunca dispararam". */
export function useRuleEffectiveness<T extends { effectiveness?: RuleEffectiveness }>(rules: T[]) {
  const [sort, setSort] = useState<Sort>(null);
  const [neverOnly, setNeverOnly] = useState(false);
  const never = rules.filter((r) => (r.effectiveness?.fired ?? 0) === 0).length;
  const value = (r: T) =>
    sort?.key === 'clean' ? share(r.effectiveness) : (r.effectiveness?.fired ?? 0);
  const filtered = neverOnly ? rules.filter((r) => (r.effectiveness?.fired ?? 0) === 0) : rules;
  const rows = sort
    ? [...filtered].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * (value(a) - value(b)))
    : filtered;
  // Clicar na coluna ativa inverte a ordem; outra coluna comeca pelo maior.
  const toggle = (key: SortKey) =>
    setSort((current) =>
      current?.key === key
        ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' },
    );
  return { rows, sort, toggle, neverOnly, setNeverOnly, never };
}

export function EffectivenessHeaders({
  days,
  sort,
  onSort,
}: {
  days: number;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const header = (key: SortKey, label: string, help: string) => {
    const active = sort?.key === key;
    return (
      <TableHeader
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className={`hpsm-sort${active ? ' is-active' : ''}`}
          title={help}
          onClick={() => onSort(key)}
        >
          {label}
          <span className="hpsm-sort__arrow" aria-hidden="true">
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
          </span>
        </button>
      </TableHeader>
    );
  };
  return (
    <>
      {header('fired', t('effFired', { days }), t('effFiredHelp', { days }))}
      {header('clean', t('effClean'), t('effCleanHelp', { days }))}
    </>
  );
}

export function EffectivenessCells({ value }: { value?: RuleEffectiveness }) {
  const fired = value?.fired ?? 0;
  const ratio = share(value);
  const noisy = fired >= NOISY_MIN_FIRED && ratio >= NOISY_SHARE;
  const percent =
    ratio < 0 ? '—' : new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(ratio);
  return (
    <>
      <TableCell>{fired.toLocaleString(intlLocale())}</TableCell>
      <TableCell>
        {noisy ? (
          <span title={t('effNoisy')}>
            <StatusText tone="orange">{percent}</StatusText>
          </span>
        ) : (
          percent
        )}
      </TableCell>
    </>
  );
}

export function NeverFiredFilter({
  id,
  days,
  checked,
  count,
  onChange,
}: {
  id: string;
  days: number;
  checked: boolean;
  count: number;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      id={id}
      labelText={t('effNeverOnly', { n: count, days })}
      checked={checked}
      onChange={(_, { checked: value }) => onChange(value)}
    />
  );
}
