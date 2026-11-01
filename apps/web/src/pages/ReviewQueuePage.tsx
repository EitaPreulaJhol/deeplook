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
import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Report } from '../api/types';
import { saveEntrySequence } from '../components/entryNav';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { TypeTag, VerdictTag } from '../components/tags';

type QueueItem = Report & { entry: { id: string; title: string; type: 'FILE' | 'URL' } };

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/**
 * Fila "Relatorios para revisar" (quatro olhos): relatorios em revisao de OUTROS
 * analistas, os mais antigos primeiro. Abrir leva a aba Relatorios da amostra,
 * onde ficam [Aprovar e publicar] e [Devolver].
 */
export function ReviewQueuePage() {
  const navigate = useNavigate();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const query = useQuery({
    queryKey: ['reports', 'review-queue'],
    queryFn: () => api.get<{ reports: QueueItem[] }>('/reports/review-queue'),
    refetchInterval: 60_000,
  });
  const items = query.data?.reports ?? [];

  const open = (item: QueueItem) => {
    saveEntrySequence(items.map((i) => i.entry.id));
    navigate(`/entries/${item.entry.id}?tab=relatorios`);
  };
  const onRowKeyDown = (event: KeyboardEvent, index: number, item: QueueItem) => {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : null;
    if (target !== null) {
      event.preventDefault();
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(item);
    }
  };

  return (
    <>
      <HpsmToolbar label="Ações da fila">
        <HpsmToolbarButton
          label="Atualizar"
          icon={IconRefresh}
          onClick={() => void query.refetch()}
        />
      </HpsmToolbar>
      <PageHeader
        title="Relatórios para revisar"
        subtitle="Relatórios de outros analistas aguardando aprovação."
      />
      {query.isLoading && <HpsmLoading text="Carregando a fila..." />}
      {query.isError && (
        <HpsmMessage kind="error">Erro ao carregar: {(query.error as Error).message}</HpsmMessage>
      )}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">Nenhum relatório aguardando revisão.</HpsmMessage>
      )}
      {items.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label="Relatórios para revisar (setas navegam, Enter abre)">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Amostra</TableHeader>
                <TableHeader scope="col">Tipo</TableHeader>
                <TableHeader scope="col">Autor</TableHeader>
                <TableHeader scope="col">Veredito proposto</TableHeader>
                <TableHeader scope="col">Enviado para revisão</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => (
                <TableRow
                  key={item.id}
                  ref={(el: HTMLTableRowElement | null) => {
                    rowRefs.current[index] = el;
                  }}
                  className="hpsm-grid-row"
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => open(item)}
                  onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, item)}
                >
                  <TableCell>
                    <span className="dl-cell-text" title={item.entry.title}>
                      {item.entry.title}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TypeTag type={item.entry.type} />
                  </TableCell>
                  <TableCell>{item.analyst.displayName}</TableCell>
                  <TableCell>
                    <VerdictTag verdict={item.verdict} />
                  </TableCell>
                  <TableCell>{fmtDate(item.submittedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
