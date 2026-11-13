import {
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { RelatedEntry, RelatedReason } from '../api/types';
import { saveEntrySequence } from './entryNav';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { iocHref, iocKindOf, shortIoc } from './iocs';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Texto da coluna Motivo (por que a amostra aparece aqui). */
export function describeReason(reason: RelatedReason): string {
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
    case 'SIMILAR':
      return `Arquivo parecido (TLSH): ${reason.detail}%`;
    case 'SAME_IMPHASH':
      return `Mesmas importações (imphash ${reason.detail.slice(0, 12)}…)`;
    case 'SAME_RICH':
      return `Mesmo Rich header (${reason.detail.slice(0, 12)}…)`;
    case 'SIMILAR_PAGE':
      return `Página com a mesma aparência (captura): ${reason.detail}%`;
  }
}

/** Similaridade minima do TLSH na aba (a API usa 70 quando nao vem nada). */
export const DEFAULT_SIMILARITY = 70;
const SIMILARITY_OPTIONS = [50, 60, 70, 80, 90];

/**
 * "IOCs em comum: a, b, c (+N)" com cada indicador ligado a sua ficha. O clique
 * e o Enter no link nao abrem a amostra da linha.
 */
function IocLinks({ values }: { values: string[] }) {
  const shown = values.slice(0, 3);
  return (
    <>
      {values.length > 1 ? 'IOCs' : 'IOC'} em comum:{' '}
      {shown.map((value, i) => (
        <span key={value}>
          {i > 0 && ', '}
          <Link
            className="dl-link"
            to={iocHref(iocKindOf(value), value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {shortIoc(value)}
          </Link>
        </span>
      ))}
      {values.length > 3 && ` (+${values.length - 3})`}
    </>
  );
}

/** Mesma consulta da aba e do contador no rotulo da aba (cache compartilhado). */
export function useRelatedEntries(entryId: string, similarity = DEFAULT_SIMILARITY) {
  return useQuery({
    queryKey: ['entry', entryId, 'related', similarity],
    queryFn: () =>
      api.get<{ items: RelatedEntry[]; total: number; limit: number }>(
        `/entries/${entryId}/related${similarity === DEFAULT_SIMILARITY ? '' : `?similarity=${similarity}`}`,
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Aba "Relacionadas": amostras com o mesmo arquivo, um arquivo parecido (TLSH),
 * o mesmo dominio, tags ou IOCs em comum, das mais relevantes para as menos.
 * Clique ou Enter abre a amostra; Anterior/Proxima na ficha percorrem esta lista.
 */
export function EntryRelatedTab({ entryId }: { entryId: string }) {
  const navigate = useNavigate();
  const [similarity, setSimilarity] = useState(DEFAULT_SIMILARITY);
  const query = useRelatedEntries(entryId, similarity);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const filter = (
    <HpsmFilterBar onClear={() => setSimilarity(DEFAULT_SIMILARITY)}>
      <HpsmFilterItem label="Arquivos parecidos a partir de" htmlFor="related-similarity">
        <Select
          id="related-similarity"
          labelText="Arquivos parecidos a partir de"
          hideLabel
          size="sm"
          value={String(similarity)}
          onChange={(e) => setSimilarity(Number(e.target.value))}
        >
          {SIMILARITY_OPTIONS.map((value) => (
            <SelectItem
              key={value}
              value={String(value)}
              text={`${value}%${value === DEFAULT_SIMILARITY ? ' (padrão)' : ''}`}
            />
          ))}
        </Select>
      </HpsmFilterItem>
    </HpsmFilterBar>
  );

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
      <>
        {filter}
        <HpsmMessage kind="info">
          Nenhuma amostra relacionada (mesmo arquivo, arquivo parecido, domínio, tags ou IOCs).
        </HpsmMessage>
      </>
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
        Amostras ligadas a esta pelo mesmo arquivo (SHA-256), por um arquivo parecido (TLSH), pelo
        mesmo domínio, por tags em comum ou por IOCs em comum nos relatórios publicados, das mais
        relevantes para as menos.
      </p>
      {filter}
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
                        {reason.kind === 'SHARED_IOCS' ? (
                          <IocLinks values={reason.detail} />
                        ) : (
                          describeReason(reason)
                        )}
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  <span className="dl-cell-text" title={entry.title}>
                    {entry.title}
                  </span>
                </TableCell>
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
