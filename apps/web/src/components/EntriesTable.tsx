import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Entry } from '../api/types';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Colunas ordenaveis (mesmos nomes do parametro `sort` de GET /api/entries). */
export type EntrySortKey =
  'title' | 'type' | 'owner' | 'status' | 'verdict' | 'reports' | 'createdAt';

export interface EntrySort {
  key: EntrySortKey;
  dir: 'asc' | 'desc';
}

/** Ordem padrao das listas: mais recentes primeiro. */
export const DEFAULT_ENTRY_SORT: EntrySort = { key: 'createdAt', dir: 'desc' };

/** Parametros de ordenacao/paginacao para a query de GET /api/entries. */
export function entryListParams(
  params: URLSearchParams,
  sort: EntrySort,
  offset: number,
  limit: number,
) {
  params.set('sort', sort.key);
  params.set('dir', sort.dir);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
}

interface EntriesTableProps {
  entries: Entry[];
  showOwner?: boolean;
  /** Total de registros no servidor (todas as paginas). */
  total: number;
  /** Indice do primeiro registro exibido. */
  offset: number;
  pageSize: number;
  sort: EntrySort;
  onSortChange: (sort: EntrySort) => void;
  onPageChange: (offset: number) => void;
}

/** Lista de registros no estilo "Record List" do HP Service Manager. */
export function EntriesTable({
  entries,
  showOwner = true,
  total,
  offset,
  pageSize,
  sort,
  onSortChange,
  onPageChange,
}: EntriesTableProps) {
  const navigate = useNavigate();

  // Teclado: so uma linha entra no Tab (roving tabindex); setas, Home/End movem
  // o foco e Enter/Espaco abrem a amostra.
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const tabbableRow = Math.min(focusIndex, Math.max(entries.length - 1, 0));

  const openEntry = (id: string) => navigate(`/entries/${id}`);

  const onRowKeyDown = (event: KeyboardEvent, index: number, id: string) => {
    const lastRow = entries.length - 1;
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, lastRow)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lastRow
              : null;
    if (target !== null) {
      event.preventDefault();
      setFocusIndex(target);
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEntry(id);
    }
  };

  const headers: { key: EntrySortKey; header: string }[] = [
    { key: 'title', header: 'Amostra' },
    { key: 'type', header: 'Tipo' },
    ...(showOwner ? [{ key: 'owner' as const, header: 'Enviado por' }] : []),
    { key: 'status', header: 'Status' },
    { key: 'verdict', header: 'Veredito' },
    { key: 'reports', header: 'Relatórios' },
    { key: 'createdAt', header: 'Data' },
  ];

  // Clicar na coluna ativa inverte a ordem; outra coluna comeca em ascendente.
  const toggleSort = (key: EntrySortKey) => {
    onSortChange(
      sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  };

  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + entries.length, total);
  const lastOffset = Math.max(0, Math.floor((total - 1) / pageSize) * pageSize);
  const atStart = offset <= 0;
  const atEnd = offset >= lastOffset;

  return (
    <>
      {/* Sem o <DataTable> do Carbon: ele guarda as linhas em estado interno e
          so sincroniza um render depois, entao ao trocar o filtro ainda entregava
          ids antigos (entry undefined -> tela branca). As linhas vem direto de
          `entries`; ordenacao e paginacao ja sao controladas aqui. */}
      <TableContainer>
        <Table size="xs" aria-label="Amostras (setas navegam, Enter abre)">
          <TableHead>
            <TableRow>
              {headers.map((header) => {
                const active = sort.key === header.key;
                return (
                  <TableHeader
                    key={header.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      className={`hpsm-sort${active ? ' is-active' : ''}`}
                      onClick={() => toggleSort(header.key)}
                    >
                      {header.header}
                      <span className="hpsm-sort__arrow" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </TableHeader>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry, index) => (
              <TableRow
                key={entry.id}
                ref={(el: HTMLTableRowElement | null) => {
                  rowRefs.current[index] = el;
                }}
                className="hpsm-grid-row"
                tabIndex={index === tabbableRow ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, entry.id)}
                onClick={() => openEntry(entry.id)}
              >
                <TableCell>{entry.title}</TableCell>
                <TableCell>
                  <TypeTag type={entry.type} />
                </TableCell>
                {showOwner && <TableCell>{entry.owner.displayName}</TableCell>}
                <TableCell>
                  <StatusTag status={entry.status} />
                </TableCell>
                <TableCell>
                  <VerdictTag verdict={entry.verdict} />
                </TableCell>
                <TableCell>
                  {entry._count ? entry._count.reports : (entry.reports?.length ?? 0)}
                </TableCell>
                <TableCell>{fmtDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <div className="dl-table-foot">
        <span>
          Exibindo registros {first} a {last} de {total}
        </span>
        <div className="hpsm-pager" role="group" aria-label="Paginação">
          <button
            type="button"
            className="hpsm-pager__btn"
            title="Primeira página"
            aria-label="Primeira página"
            disabled={atStart}
            onClick={() => onPageChange(0)}
          >
            «
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title="Página anterior"
            aria-label="Página anterior"
            disabled={atStart}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          >
            ‹ Anterior
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title="Próxima página"
            aria-label="Próxima página"
            disabled={atEnd}
            onClick={() => onPageChange(offset + pageSize)}
          >
            Próxima ›
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title="Última página"
            aria-label="Última página"
            disabled={atEnd}
            onClick={() => onPageChange(lastOffset)}
          >
            »
          </button>
        </div>
      </div>
    </>
  );
}
