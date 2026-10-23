import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { DEFAULT_ENTRY_SORT, type EntrySort, type EntrySortKey } from './EntriesTable';

const SORT_KEYS: EntrySortKey[] = [
  'title',
  'type',
  'owner',
  'assignee',
  'status',
  'priority',
  'age',
  'verdict',
  'reports',
  'createdAt',
];

export type EntryFilterKey =
  | 'type'
  | 'status'
  | 'verdict'
  | 'priority'
  | 'assignee'
  | 'age'
  | 'submittedFrom'
  | 'completedFrom';

/** Espera apos a ultima tecla antes de aplicar a busca por texto. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Estado das listas de amostras (busca, filtros, ordenacao e pagina) guardado na
 * URL (`?q=&status=&sort=&dir=&offset=`). Assim a aba de documento reabre a lista
 * exatamente como estava e a busca pode ser compartilhada por link. Valores
 * padrao nao aparecem na URL.
 */
export function useEntryListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const filters: Record<EntryFilterKey, string> = {
    type: searchParams.get('type') ?? '',
    status: searchParams.get('status') ?? '',
    verdict: searchParams.get('verdict') ?? '',
    priority: searchParams.get('priority') ?? '',
    assignee: searchParams.get('assignee') ?? '',
    age: searchParams.get('age') ?? '',
    // Periodo (links do Painel): instante ISO; sem controle proprio, vira etiqueta.
    submittedFrom: searchParams.get('submittedFrom') ?? '',
    completedFrom: searchParams.get('completedFrom') ?? '',
  };
  const sortKey = searchParams.get('sort') as EntrySortKey | null;
  const sort: EntrySort =
    sortKey && SORT_KEYS.includes(sortKey)
      ? { key: sortKey, dir: searchParams.get('dir') === 'asc' ? 'asc' : 'desc' }
      : DEFAULT_ENTRY_SORT;
  const offset = Math.max(0, Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  /** Aplica mudancas na URL (null/'' remove o parametro); por padrao volta a pagina 1. */
  const update = useCallback(
    (changes: Record<string, string | null>, resetOffset = true) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (resetOffset) next.delete('offset');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Campo de busca: o texto digitado so vai para a URL apos a pausa. O ref guarda
  // o ultimo valor escrito para nao sobrescrever o que o usuario ainda digita.
  const [draftQ, setDraftQ] = useState(q);
  const writtenQ = useRef(q);

  useEffect(() => {
    if (draftQ === q) return;
    const id = window.setTimeout(() => {
      writtenQ.current = draftQ;
      update({ q: draftQ.trim() ? draftQ : null });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [draftQ, q, update]);

  // A busca mudou por fora (Limpar, voltar/avancar): reflete no campo.
  useEffect(() => {
    if (q !== writtenQ.current) {
      writtenQ.current = q;
      setDraftQ(q);
    }
  }, [q]);

  return {
    q,
    draftQ,
    setDraftQ,
    filters,
    setFilter: (key: EntryFilterKey, value: string) => update({ [key]: value || null }),
    sort,
    setSort: (next: EntrySort) => {
      const isDefault = next.key === DEFAULT_ENTRY_SORT.key && next.dir === DEFAULT_ENTRY_SORT.dir;
      update({ sort: isDefault ? null : next.key, dir: isDefault ? null : next.dir });
    },
    offset,
    setOffset: (next: number) => update({ offset: next > 0 ? String(next) : null }, false),
    clear: () => {
      writtenQ.current = '';
      setDraftQ('');
      update({
        q: null,
        type: null,
        status: null,
        verdict: null,
        priority: null,
        assignee: null,
        age: null,
        submittedFrom: null,
        completedFrom: null,
      });
    },
  };
}
