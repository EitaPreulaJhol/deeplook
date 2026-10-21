import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EntriesTable, entryListParams } from '../components/EntriesTable';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useEntryListState } from '../components/useEntryListState';

export function GlobalHistoryPage() {
  const { preferences } = useAuth();
  const pageSize = preferences.pageSize;
  // Busca, filtros, ordenacao e pagina ficam na URL (ver useEntryListState).
  const list = useEntryListState();
  const { q, draftQ, setDraftQ, sort, offset } = list;
  const { type, status, verdict } = list.filters;

  const params = new URLSearchParams();
  params.set('scope', 'all');
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  entryListParams(params, sort, offset, pageSize);

  const query = useQuery({
    queryKey: ['entries', 'all', q, type, status, verdict, sort.key, sort.dir, offset, pageSize],
    queryFn: () => api.get<{ items: Entry[]; total: number }>(`/entries?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Histórico Global" subtitle="Todas as amostras enviadas pela comunidade." />

      <HpsmFilterBar onClear={list.clear}>
        <HpsmFilterItem label="Buscar" htmlFor="q">
          <TextInput
            id="q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Título, hash, URL, arquivo..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label="Tipo" htmlFor="type">
          <Select
            id="type"
            labelText="Tipo"
            hideLabel
            size="sm"
            value={type}
            onChange={(e) => list.setFilter('type', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="FILE" text="Arquivo" />
            <SelectItem value="URL" text="Link" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Status" htmlFor="status">
          <Select
            id="status"
            labelText="Status"
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="PENDING" text="Pendente" />
            <SelectItem value="IN_REVIEW" text="Em análise" />
            <SelectItem value="COMPLETED" text="Concluído" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Veredito" htmlFor="verdict">
          <Select
            id="verdict"
            labelText="Veredito"
            hideLabel
            size="sm"
            value={verdict}
            onChange={(e) => list.setFilter('verdict', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="UNKNOWN" text="Desconhecido" />
            <SelectItem value="CLEAN" text="Limpo" />
            <SelectItem value="SUSPICIOUS" text="Suspeito" />
            <SelectItem value="MALICIOUS" text="Malicioso" />
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando amostras..." />}
      {query.isError && (
        <HpsmMessage kind="error">Erro ao carregar: {(query.error as Error).message}</HpsmMessage>
      )}
      {/* Lista vazia: a grade continua visivel e o aviso vai para a barra de mensagens. */}
      {query.data && query.data.items.length === 0 && (
        <HpsmMessage kind="info">Nenhuma amostra encontrada.</HpsmMessage>
      )}
      {query.data && (
        <EntriesTable
          entries={query.data.items}
          total={query.data.total}
          offset={offset}
          pageSize={pageSize}
          sort={sort}
          onSortChange={list.setSort}
          onPageChange={list.setOffset}
        />
      )}
    </>
  );
}
