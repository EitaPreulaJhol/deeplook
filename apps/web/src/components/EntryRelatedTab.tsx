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
import type { RelatedEntry, RelatedReason } from '../api/types';
import { saveEntrySequence } from './entryNav';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Texto da coluna Motivo (por que a amostra aparece aqui). */
function describe(reason: RelatedReason): string {
  switch (reason.kind) {
    case 'SAME_SHA256':
      return 'Mesmo arquivo (SHA-256)';
    case 'SAME_HOST':
      return `Mesmo domínio: ${reason.detail}`;
    case 'SAME_BASE_DOMAIN':
      return `Mesmo domínio-base: ${reason.detail}`;
    case 'SHARED_TAGS':
      return `${reason.detail.length > 1 ? 'Tags' : 'Tag'} em comum: ${reason.detail.join(', ')}`;
    case 'SHARED_IOCS': {
      // Hashes longos e listas grandes: mostra 3 e o total (a lista toda fica na dica).
      const shown = reason.detail
        .slice(0, 3)
        .map((v) => (v.length > 24 ? `${v.slice(0, 12)}…` : v));
      const more = reason.detail.length > 3 ? ` (+${reason.detail.length - 3})` : '';
      return `${reason.detail.length > 1 ? 'IOCs' : 'IOC'} em comum: ${shown.join(', ')}${more}`;
    }
  }
}

/** Mesma consulta da aba e do contador no rotulo da aba (cache compartilhado). */
export function useRelatedEntries(entryId: string) {
  return useQuery({
    queryKey: ['entry', entryId, 'related'],
    queryFn: () =>
      api.get<{ items: RelatedEntry[]; total: number; limit: number }>(
        `/entries/${entryId}/related`,
      ),
  });
}

/**
 * Aba "Relacionadas": amostras com o mesmo arquivo, o mesmo dominio ou tags em
 * comum, das mais relevantes para as menos. Clique ou Enter abre a amostra;
 * Anterior/Proxima na ficha percorrem esta lista.
 */
export function EntryRelatedTab({ entryId }: { entryId: string }) {
  const navigate = useNavigate();
  const query = useRelatedEntries(entryId);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  if (query.isLoading) return <HpsmLoading text="Procurando amostras relacionadas..." />;
  if (query.isError) {
    return (
      <HpsmMessage kind="error">
        Erro ao carregar as relacionadas: {(query.error as Error).message}
      </HpsmMessage>
    );
  }
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  if (items.length === 0) {
    return (
      <HpsmMessage kind="info">
        Nenhuma amostra relacionada (mesmo arquivo, domínio, tags ou IOCs).
      </HpsmMessage>
    );
  }

  const open = (id: string) => {
    saveEntrySequence(items.map((item) => item.entry.id));
    navigate(`/entries/${id}`);
  };

  const onRowKeyDown = (event: KeyboardEvent, index: number, id: string) => {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null;
    if (target !== null) {
      event.preventDefault();
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(id);
    }
  };

  return (
    <>
      <p className="dl-related-hint">
        Amostras ligadas a esta pelo mesmo arquivo (SHA-256), pelo mesmo domínio, por tags em comum
        ou por IOCs em comum nos relatórios publicados, das mais relevantes para as menos.
      </p>
      <TableContainer>
        <Table size="xs" aria-label="Amostras relacionadas (setas navegam, Enter abre)">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">Motivo</TableHeader>
              <TableHeader scope="col">Amostra</TableHeader>
              <TableHeader scope="col">Tipo</TableHeader>
              <TableHeader scope="col">Enviado por</TableHeader>
              <TableHeader scope="col">Status</TableHeader>
              <TableHeader scope="col">Veredito</TableHeader>
              <TableHeader scope="col">Data</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map(({ entry, reasons }, index) => (
              <TableRow
                key={entry.id}
                ref={(el: HTMLTableRowElement | null) => {
                  rowRefs.current[index] = el;
                }}
                className="hpsm-grid-row"
                tabIndex={index === 0 ? 0 : -1}
                onClick={() => open(entry.id)}
                onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, entry.id)}
              >
                <TableCell>
                  <ul className="dl-related-reasons">
                    {reasons.map((reason) => (
                      <li
                        key={reason.kind}
                        title={reason.kind === 'SHARED_IOCS' ? reason.detail.join('\n') : undefined}
                      >
                        {describe(reason)}
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>{entry.title}</TableCell>
                <TableCell>
                  <TypeTag type={entry.type} />
                </TableCell>
                <TableCell>{entry.owner.displayName}</TableCell>
                <TableCell>
                  <StatusTag status={entry.status} />
                </TableCell>
                <TableCell>
                  <VerdictTag verdict={entry.verdict} />
                </TableCell>
                <TableCell>{fmtDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <div className="dl-table-foot">
        <span>
          {total > items.length
            ? `Exibindo as ${items.length} mais relevantes de ${total}`
            : `Exibindo ${items.length} ${items.length === 1 ? 'registro' : 'registros'}`}
        </span>
      </div>
    </>
  );
}
