import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { AttackData, AttackTechnique } from '../api/types';

/**
 * MITRE ATT&CK (item 59): lista embutida na API (GET /api/attack), carregada
 * uma vez por sessao.
 */
export function useAttack(enabled = true) {
  return useQuery({
    queryKey: ['attack'],
    queryFn: () => api.get<AttackData>('/attack'),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Nome da tecnica e as taticas, para o title dos links. */
export function techniqueTitle(technique: AttackTechnique | undefined, data?: AttackData): string {
  if (!technique) return '';
  const tactics = technique.tactics
    .map((id) => data?.tactics.find((t) => t.id === id)?.name ?? id)
    .join(', ');
  return `${technique.id} ${technique.name}${tactics ? ` (${tactics})` : ''}`;
}

export function attackHref(id: string): string {
  return `/history?attack=${encodeURIComponent(id)}`;
}

/** Tecnicas como links para o Historico Global filtrado ("T1566.001 Spearphishing Attachment"). */
export function AttackTechniqueLinks({ ids }: { ids: string[] }) {
  const { data } = useAttack(ids.length > 0);
  return (
    <ul className="dl-attack-list">
      {ids.map((id) => {
        const technique = data?.techniques.find((t) => t.id === id);
        return (
          <li key={id}>
            <Link
              className="dl-link"
              to={attackHref(id)}
              title={`${techniqueTitle(technique, data) || id} — ver as amostras com esta técnica`}
            >
              <span className="dl-mono">{id}</span>
              {technique && <span className="dl-attack-list__name"> {technique.name}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Busca por codigo (T1566, T1566.001) ou por nome, ignorando acentos e caixa. */
export function searchTechniques(
  techniques: AttackTechnique[],
  text: string,
  limit = 8,
): AttackTechnique[] {
  const q = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return [];
  const byId = techniques.filter((t) => t.id.toLowerCase().startsWith(q));
  const byName = techniques.filter(
    (t) => !t.id.toLowerCase().startsWith(q) && t.name.toLowerCase().includes(q),
  );
  return [...byId, ...byName].slice(0, limit);
}

/**
 * Campo "Técnicas ATT&CK" do relatorio: digita codigo ou nome, escolhe na
 * lista (setas + Enter ou clique) e a tecnica vira uma etiqueta removivel.
 */
export function AttackPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { data, isLoading } = useAttack();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const options = useMemo(
    () => searchTechniques(data?.techniques ?? [], text).filter((t) => !value.includes(t.id)),
    [data, text, value],
  );
  const showList = open && options.length > 0;

  const add = (technique: AttackTechnique) => {
    // Mantem a ordem do ATT&CK (a mesma que a API grava).
    const order = data?.techniques.map((t) => t.id) ?? [];
    onChange([...value, technique.id].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    setText('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      add(options[Math.min(active, options.length - 1)]);
    } else if (event.key === 'Escape' && showList) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="dl-attack-picker">
      <div className="dl-attack-picker__box">
        <input
          id={id}
          className="dl-attack-picker__input"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={
            isLoading ? 'Carregando o ATT&CK...' : 'Código ou nome (ex.: T1566, phishing)'
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul id={listId} className="dl-attack-picker__list" role="listbox">
            {options.map((t, i) => (
              <li
                key={t.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                // mousedown (antes do blur do campo) para o clique valer.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(t);
                }}
                onMouseEnter={() => setActive(i)}
                title={techniqueTitle(t, data)}
              >
                <span className="dl-mono">{t.id}</span> {t.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <ul className="dl-attack-picker__chips" aria-label="Técnicas escolhidas">
          {value.map((techniqueId) => {
            const technique = data?.techniques.find((t) => t.id === techniqueId);
            return (
              <li key={techniqueId} title={techniqueTitle(technique, data)}>
                <span className="dl-mono">{techniqueId}</span>
                {technique && <span> {technique.name}</span>}
                <button
                  type="button"
                  className="dl-attack-picker__remove"
                  aria-label={`Remover ${techniqueId}`}
                  onClick={() => onChange(value.filter((v) => v !== techniqueId))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Filtro "ATT&CK" das listas: digita o codigo (com sugestoes do navegador) e o
 * filtro vale quando o codigo existe; apagar o campo tira o filtro.
 */
export function AttackFilterInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { data } = useAttack();
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // O filtro mudou por fora (Limpar, link do Painel): reflete no campo.
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  const listId = useId();
  const options = useMemo(() => {
    const found = searchTechniques(data?.techniques ?? [], draft, 30);
    return found.length ? found : (data?.techniques ?? []).filter((t) => !t.id.includes('.'));
  }, [data, draft]);
  const known = (text: string) => data?.techniques.find((t) => t.id === text.trim().toUpperCase());

  return (
    <>
      <input
        id={id}
        className="cds--text-input cds--text-input--sm dl-attack-filter"
        type="text"
        list={listId}
        autoComplete="off"
        placeholder="T1566"
        value={draft}
        title={techniqueTitle(known(draft), data) || 'Técnica MITRE ATT&CK (código)'}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const technique = known(next);
          if (technique) onChange(technique.id);
          else if (!next.trim()) onChange('');
        }}
      />
      <datalist id={listId}>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
