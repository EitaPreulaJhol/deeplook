import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { KbArticleSummary } from './kb';
import { kbCategoryLabel, kbHref } from './kb';

export interface KbRef {
  id: string;
  title: string;
}

/**
 * Campo "Artigos da base" do relatorio (item 63): busca na base de
 * conhecimento (setas + Enter ou clique) e cada artigo vira uma etiqueta.
 */
export function KbPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: KbRef[];
  onChange: (next: KbRef[]) => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  const query = useQuery({
    queryKey: ['kb', 'picker', q],
    queryFn: () => api.get<{ items: KbArticleSummary[] }>(`/kb?limit=8&q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
    staleTime: 30_000,
  });
  const options = (q ? (query.data?.items ?? []) : []).filter(
    (a) => !value.some((v) => v.id === a.id),
  );
  const showList = open && options.length > 0;

  const add = (article: KbArticleSummary) => {
    onChange([...value, { id: article.id, title: article.title }]);
    setText('');
    setQ('');
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
          placeholder="Busque pelo título, resumo ou tag"
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
            {options.map((a, i) => (
              <li
                key={a.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(a);
                }}
                onMouseEnter={() => setActive(i)}
                title={a.summary}
              >
                {a.title} <span className="dl-kb-picker__cat">{kbCategoryLabel(a.category)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <ul className="dl-attack-picker__chips" aria-label="Artigos escolhidos">
          {value.map((v) => (
            <li key={v.id}>
              <span>{v.title}</span>
              <button
                type="button"
                className="dl-attack-picker__remove"
                aria-label={`Remover ${v.title}`}
                onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Artigos citados no relatorio (links para a base). */
export function KbLinks({ articles }: { articles: KbRef[] }) {
  return (
    <ul className="dl-attack-list">
      {articles.map((a) => (
        <li key={a.id}>
          <Link className="dl-link" to={kbHref(a.id)}>
            {a.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
