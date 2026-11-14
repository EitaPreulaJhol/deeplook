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
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Entry, SlaConfig } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/entry';
import { EntriesBulkBar } from './EntriesBulkBar';
import { saveEntrySequence } from './entryNav';
import { EntryPreviewPane } from './EntryPreviewPane';
import { HpsmMessage } from './messages';
import { AgeText } from './sla';
import { PriorityTag, StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Colunas ordenaveis (mesmos nomes do parametro `sort` de GET /api/entries). */
export type EntrySortKey =
  | 'title'
  | 'type'
  | 'owner'
  | 'assignee'
  | 'status'
  | 'priority'
  | 'age'
  | 'verdict'
  | 'reports'
  | 'createdAt';

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
  /** Coluna de selecao + atualizacao em massa (analistas/admins). */
  selectable?: boolean;
  /** Limites do prazo (coluna Idade com marcador laranja/vermelho). */
  sla?: SlaConfig;
  /** Resolucao para quem enviou abaixo do titulo (Meus Uploads, item 87). */
  showResolution?: boolean;
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
  selectable = false,
  sla,
  showResolution = false,
}: EntriesTableProps) {
  const navigate = useNavigate();
  const { preferences } = useAuth();

  // Painel de detalhe (preferencia): clique seleciona a linha e mostra o resumo
  // abaixo da grade; duplo clique ou Enter abrem a amostra. Desligado, o clique
  // abre direto. A selecao so vale para linhas da pagina atual.
  const detailPane = preferences.detailPane;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = detailPane ? (entries.find((e) => e.id === selectedId) ?? null) : null;

  // Atualizacao em massa: linhas marcadas na pagina atual. Trocar de filtro ou
  // de pagina (outro conjunto de linhas) limpa a marcacao.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkResult, setBulkResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const idsKey = entries.map((e) => e.id).join(',');
  useEffect(() => setCheckedIds(new Set()), [idsKey]);
  const toggleChecked = (id: string) =>
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = entries.length > 0 && entries.every((e) => checkedIds.has(e.id));
  const someChecked = checkedIds.size > 0 && !allChecked;
  const toggleAll = () => setCheckedIds(allChecked ? new Set() : new Set(entries.map((e) => e.id)));

  // Teclado: so uma linha entra no Tab (roving tabindex); setas, Home/End movem
  // o foco e Enter/Espaco abrem a amostra.
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const tabbableRow = Math.min(focusIndex, Math.max(entries.length - 1, 0));

  // Abrir uma linha guarda a sequencia da pagina (Anterior/Proxima na ficha).
  const openEntry = (id: string) => {
    saveEntrySequence(entries.map((e) => e.id));
    navigate(`/entries/${id}`);
  };

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
    } else if (event.key === ' ' && selectable) {
      // Com a coluna de selecao, Espaco marca/desmarca a linha (como no HPSM).
      event.preventDefault();
      toggleChecked(id);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEntry(id);
    }
  };

  // Colunas secundarias somem quando a tabela fica estreita (tela de 1024 px, painel de detalhe;
  // plano pos-revisao, item 1.6): o veredito, que importa na triagem, nao sai mais do quadro.
  // Nivel 3 sai primeiro, depois o 2 e, so na largura menor, o 1 (styles/hpsm.scss, .dl-entries).
  const minor: Partial<Record<EntrySortKey, string>> = {
    reports: 'dl-col--minor3',
    type: 'dl-col--minor2',
    assignee: 'dl-col--minor1',
    age: 'dl-col--minor1',
    createdAt: 'dl-col--minor1',
  };

  const headers: { key: EntrySortKey; header: string }[] = [
    { key: 'title', header: t('colSample') },
    { key: 'type', header: t('colType') },
    ...(showOwner ? [{ key: 'owner' as const, header: t('colOwner') }] : []),
    { key: 'assignee', header: t('colAssignee') },
    { key: 'status', header: t('colStatus') },
    { key: 'priority', header: t('colPriority') },
    { key: 'age', header: t('colAge') },
    { key: 'verdict', header: t('colVerdict') },
    { key: 'reports', header: t('colReports') },
    { key: 'createdAt', header: t('colDate') },
  ];

  // Clicar na coluna ativa inverte a ordem; outra coluna comeca em ascendente.
  // Prioridade comeca pelo mais urgente (P1); as outras colunas, em ordem crescente.
  const toggleSort = (key: EntrySortKey) => {
    onSortChange(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'priority' ? 'desc' : 'asc' },
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
      {bulkResult && <HpsmMessage kind={bulkResult.kind}>{bulkResult.text}</HpsmMessage>}
      {selectable && checkedIds.size > 0 && (
        <EntriesBulkBar
          ids={[...checkedIds]}
          onClear={() => setCheckedIds(new Set())}
          onDone={setBulkResult}
        />
      )}
      <TableContainer className="dl-entries">
        <Table size="xs" aria-label={detailPane ? t('tableAriaSelect') : t('tableAria')}>
          <TableHead>
            <TableRow>
              {selectable && (
                <TableHeader scope="col" className="hpsm-grid-check">
                  <input
                    type="checkbox"
                    hidden={entries.length === 0}
                    aria-label={t('selectPage')}
                    title={t('selectPage')}
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={toggleAll}
                  />
                </TableHeader>
              )}
              {headers.map((header) => {
                const active = sort.key === header.key;
                return (
                  <TableHeader
                    key={header.key}
                    scope="col"
                    className={minor[header.key]}
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
                className={`hpsm-grid-row${selected?.id === entry.id ? ' is-selected' : ''}`}
                tabIndex={index === tabbableRow ? 0 : -1}
                aria-selected={detailPane ? selected?.id === entry.id : undefined}
                onFocus={() => {
                  setFocusIndex(index);
                  if (detailPane) setSelectedId(entry.id);
                }}
                onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, entry.id)}
                onClick={() => (detailPane ? setSelectedId(entry.id) : openEntry(entry.id))}
                onDoubleClick={() => detailPane && openEntry(entry.id)}
              >
                {selectable && (
                  <TableCell className="hpsm-grid-check">
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      aria-label={t('selectOne', { title: entry.title })}
                      checked={checkedIds.has(entry.id)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onChange={() => toggleChecked(entry.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <span className="dl-cell-text" title={entry.title}>
                    {entry.title}
                  </span>
                  {(entry.duplicateOfId || entry.isDuplicate) && (
                    <span className="dl-dup-tag" title={t('duplicateTitle')}>
                      {t('duplicateTag')}
                    </span>
                  )}
                  {showResolution && entry.resolution && (
                    <span className="dl-resolution-line">
                      {t('whatToDo', { resolution: entry.resolution })}
                    </span>
                  )}
                </TableCell>
                <TableCell className={minor.type}>
                  <TypeTag type={entry.type} />
                </TableCell>
                {showOwner && <TableCell>{entry.owner.displayName}</TableCell>}
                <TableCell className={minor.assignee}>
                  {entry.assignee?.displayName ?? '—'}
                </TableCell>
                <TableCell>
                  <StatusTag status={entry.status} />
                </TableCell>
                <TableCell>
                  <PriorityTag priority={entry.priority} />
                </TableCell>
                <TableCell className={minor.age}>
                  <AgeText entry={entry} sla={sla} />
                </TableCell>
                <TableCell>
                  <VerdictTag verdict={entry.verdict} />
                </TableCell>
                <TableCell className={minor.reports}>
                  {entry._count ? entry._count.reports : (entry.reports?.length ?? 0)}
                </TableCell>
                <TableCell className={minor.createdAt}>{fmtDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <div className="dl-table-foot">
        <span>{t('showing', { first, last, total })}</span>
        <div className="hpsm-pager" role="group" aria-label={t('pagination')}>
          <button
            type="button"
            className="hpsm-pager__btn"
            title={t('firstPage')}
            aria-label={t('firstPage')}
            disabled={atStart}
            onClick={() => onPageChange(0)}
          >
            «
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title={t('prevPage')}
            aria-label={t('prevPage')}
            disabled={atStart}
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          >
            {t('prevShort')}
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title={t('nextPage')}
            aria-label={t('nextPage')}
            disabled={atEnd}
            onClick={() => onPageChange(offset + pageSize)}
          >
            {t('nextShort')}
          </button>
          <button
            type="button"
            className="hpsm-pager__btn"
            title={t('lastPage')}
            aria-label={t('lastPage')}
            disabled={atEnd}
            onClick={() => onPageChange(lastOffset)}
          >
            »
          </button>
        </div>
      </div>
      {selected && <EntryPreviewPane entryId={selected.id} onOpen={() => openEntry(selected.id)} />}
    </>
  );
}
