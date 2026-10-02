import {
  Button,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  TextInput,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { EntriesTable } from '../components/EntriesTable';
import { PageHeader } from '../components/PageHeader';

export function GlobalHistoryPage() {
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [verdict, setVerdict] = useState('');

  const params = new URLSearchParams();
  params.set('scope', 'all');
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  params.set('limit', '100');

  const query = useQuery({
    queryKey: ['entries', 'all', q, type, status, verdict],
    queryFn: () => api.get<{ items: Entry[]; total: number }>(`/entries?${params.toString()}`),
  });

  return (
    <>
      <PageHeader
        title="Histórico Global"
        subtitle="Todas as amostras enviadas pela comunidade DeepLook."
      />

      <div className="dl-toolbar">
        <TextInput
          id="q"
          labelText="Buscar"
          placeholder="Título, hash, URL, arquivo..."
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQ(draftQ);
          }}
        />
        <Select id="type" labelText="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
          <SelectItem value="" text="Todos" />
          <SelectItem value="FILE" text="Arquivo" />
          <SelectItem value="URL" text="Link" />
        </Select>
        <Select
          id="status"
          labelText="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <SelectItem value="" text="Todos" />
          <SelectItem value="PENDING" text="Pendente" />
          <SelectItem value="IN_REVIEW" text="Em análise" />
          <SelectItem value="COMPLETED" text="Concluído" />
        </Select>
        <Select
          id="verdict"
          labelText="Veredito"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
        >
          <SelectItem value="" text="Todos" />
          <SelectItem value="UNKNOWN" text="Desconhecido" />
          <SelectItem value="CLEAN" text="Limpo" />
          <SelectItem value="SUSPICIOUS" text="Suspeito" />
          <SelectItem value="MALICIOUS" text="Malicioso" />
        </Select>
        <Button onClick={() => setQ(draftQ)}>Filtrar</Button>
      </div>

      {query.isLoading && <InlineLoading description="Carregando amostras..." />}
      {query.isError && (
        <InlineNotification
          kind="error"
          title="Erro ao carregar"
          subtitle={(query.error as Error).message}
          lowContrast
        />
      )}
      {query.data && query.data.items.length === 0 && (
        <div className="dl-empty">Nenhuma amostra encontrada.</div>
      )}
      {query.data && query.data.items.length > 0 && <EntriesTable entries={query.data.items} />}
    </>
  );
}
