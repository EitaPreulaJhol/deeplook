import { Add } from '@carbon/icons-react';
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
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EntriesTable } from '../components/EntriesTable';
import { PageHeader } from '../components/PageHeader';

export function MyUploadsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [status, setStatus] = useState('');
  const [verdict, setVerdict] = useState('');

  const params = new URLSearchParams();
  params.set('scope', 'mine');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  params.set('limit', '100');

  const query = useQuery({
    queryKey: ['entries', 'mine', user?.id, q, status, verdict],
    queryFn: () => api.get<{ items: Entry[]; total: number }>(`/entries?${params.toString()}`),
  });

  return (
    <>
      <PageHeader
        title="Meus Uploads"
        subtitle="Acompanhe o controle das amostras que você enviou."
      />

      <div className="dl-toolbar">
        <TextInput
          id="q"
          labelText="Buscar"
          placeholder="Título, hash, URL..."
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQ(draftQ);
          }}
        />
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
        <Button kind="tertiary" renderIcon={Add} onClick={() => navigate('/submit')}>
          Enviar amostra
        </Button>
      </div>

      {query.isLoading && <InlineLoading description="Carregando seus uploads..." />}
      {query.isError && (
        <InlineNotification
          kind="error"
          title="Erro ao carregar"
          subtitle={(query.error as Error).message}
          lowContrast
        />
      )}
      {query.data && query.data.items.length === 0 && (
        <div className="dl-empty">Você ainda não enviou nenhuma amostra.</div>
      )}
      {query.data && query.data.items.length > 0 && (
        <EntriesTable entries={query.data.items} showOwner={false} />
      )}
    </>
  );
}
