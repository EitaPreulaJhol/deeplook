import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  DEFAULT_ENTRY_SORT,
  EntriesTable,
  entryListParams,
  type EntrySort,
} from '../components/EntriesTable';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';

/** Registros por pagina da lista. */
const PAGE_SIZE = 50;

export function MyUploadsPage() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [status, setStatus] = useState('');
  const [verdict, setVerdict] = useState('');
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<EntrySort>(DEFAULT_ENTRY_SORT);

  // A tabela se atualiza sozinha: a busca por texto roda logo apos parar de digitar.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(draftQ);
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [draftQ]);

  const params = new URLSearchParams();
  params.set('scope', 'mine');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  entryListParams(params, sort, offset, PAGE_SIZE);

  const query = useQuery({
    queryKey: ['entries', 'mine', user?.id, q, status, verdict, sort.key, sort.dir, offset],
    queryFn: () => api.get<{ items: Entry[]; total: number }>(`/entries?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const clearFilters = () => {
    setDraftQ('');
    setQ('');
    setStatus('');
    setVerdict('');
    setOffset(0);
  };

  return (
    <>
      <PageHeader
        title="Meus Uploads"
        subtitle="Acompanhe o controle das amostras que você enviou."
      />

      <HpsmFilterBar onClear={clearFilters}>
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
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
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
            onChange={(e) => {
              setVerdict(e.target.value);
              setOffset(0);
            }}
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
          pageSize={PAGE_SIZE}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setOffset(0);
          }}
          onPageChange={setOffset}
        />
      )}
    </>
  );
}
