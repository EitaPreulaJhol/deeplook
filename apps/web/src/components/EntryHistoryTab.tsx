import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { EntryEvent, EntryStatus, Verdict } from '../api/types';
import { HpsmLoading, HpsmMessage } from './messages';
import { statusLabel, verdictLabel } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

const SANDBOX_CLOSE_REASONS: Record<string, string> = {
  descartado: 'descartado',
  expirado: 'expirou',
};

/** Descricao legivel de um evento do historico. */
function describe(event: EntryEvent): string {
  const from = event.fromValue;
  const to = event.toValue;
  switch (event.type) {
    case 'CREATED':
      return 'Amostra enviada';
    case 'STATUS_CHANGED':
      return `Status: ${statusLabel(from as EntryStatus)} → ${statusLabel(to as EntryStatus)}`;
    case 'VERDICT_CHANGED':
      return `Veredito: ${verdictLabel(from as Verdict)} → ${verdictLabel(to as Verdict)}`;
    case 'ASSIGNED':
      return `Responsável: ${from ?? '—'} → ${to ?? '—'}`;
    case 'REPORT_CREATED':
      return `Relatório salvo como rascunho (veredito ${verdictLabel(to as Verdict)})`;
    case 'REPORT_PUBLISHED':
      return `Relatório publicado (veredito ${verdictLabel(to as Verdict)})`;
    case 'SANDBOX_OPENED':
      return 'Ambiente isolado aberto';
    case 'SANDBOX_CLOSED':
      return `Ambiente isolado encerrado${
        event.detail ? ` (${SANDBOX_CLOSE_REASONS[event.detail] ?? event.detail})` : ''
      }`;
    case 'SANDBOX_FAILED':
      return `Falha ao preparar o ambiente isolado${event.detail ? `: ${event.detail}` : ''}`;
    default:
      return event.type;
  }
}

/** Aba "Historico": linha do tempo da amostra (quem fez o que e quando). */
export function EntryHistoryTab({ entryId }: { entryId: string }) {
  const query = useQuery({
    queryKey: ['entry', entryId, 'events'],
    queryFn: () => api.get<{ events: EntryEvent[] }>(`/entries/${entryId}/events`),
  });

  if (query.isLoading) return <HpsmLoading text="Carregando histórico..." />;
  if (query.isError) {
    return (
      <HpsmMessage kind="error">
        Erro ao carregar o histórico: {(query.error as Error).message}
      </HpsmMessage>
    );
  }
  const events = query.data?.events ?? [];
  if (events.length === 0) {
    return <HpsmMessage kind="info">Nenhum evento registrado para esta amostra.</HpsmMessage>;
  }

  return (
    <TableContainer>
      <Table size="xs" aria-label="Histórico da amostra">
        <TableHead>
          <TableRow>
            <TableHeader scope="col">Data</TableHeader>
            <TableHeader scope="col">Usuário</TableHeader>
            <TableHeader scope="col">Evento</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell>{fmtDate(event.createdAt)}</TableCell>
              <TableCell>{event.actor?.displayName ?? 'Sistema'}</TableCell>
              <TableCell>{describe(event)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
