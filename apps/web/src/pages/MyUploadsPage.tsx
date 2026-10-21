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

export function MyUploadsPage() {
  const { user, preferences } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const pageSize = preferences.pageSize;
  // Busca, filtros, ordenacao e pagina ficam na URL (ver useEntryListState).
  const list = useEntryListState();
  const { q, draftQ, setDraftQ, sort, offset } = list;
  const { status, verdict } = list.filters;

  const params = new URLSearchParams();
  params.set('scope', 'mine');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  entryListParams(params, sort, offset, pageSize);

  // Exportar CSV: mesma busca, filtros e ordenacao, sem paginacao.
  const exportParams = new URLSearchParams(params);
  exportParams.delete('offset');
  exportParams.delete('limit');
  const exportHref = `/api/entries/export.csv?${exportParams.toString()}`;

  const query = useQuery({
    queryKey: [
      'entries',
      'mine',
      user?.id,
      q,
      status,
      verdict,
      sort.key,
      sort.dir,
      offset,
      pageSize,
    ],
    queryFn: () => api.get<{ items: Entry[]; total: number }>(`/entries?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Meus Uploads"
        subtitle="Acompanhe o controle das amostras que você enviou."
      />

      <HpsmFilterBar onClear={list.clear} exportHref={exportHref}>
        <HpsmFilterItem label="Buscar" htmlFor="q">
          <TextInput
            id="q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Título, hash, URL..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
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

      {query.isLoading && <HpsmLoading text="Carregando seus uploads..." />}
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
          showOwner={false}
          total={query.data.total}
          offset={offset}
          pageSize={pageSize}
          sort={sort}
          onSortChange={list.setSort}
          onPageChange={list.setOffset}
          selectable={canTriage}
        />
      )}
    </>
  );
}
