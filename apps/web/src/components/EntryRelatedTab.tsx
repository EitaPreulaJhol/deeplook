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
import type { PivotKind, RelatedEntry, RelatedReason } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/entry';
import { saveEntrySequence } from './entryNav';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { iocHref, iocKindOf, shortIoc } from './iocs';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** Texto da coluna Motivo (por que a amostra aparece aqui). */
export function describeReason(reason: RelatedReason): string {
  switch (reason.kind) {
    case 'SAME_SHA256':
      return t('rSameFile');
    case 'SAME_HOST':
      return t('rSameHost', { host: reason.detail });
    case 'SAME_BASE_DOMAIN':
      return t('rSameBase', { domain: reason.detail });
    case 'SHARED_TAGS':
      return t(reason.detail.length > 1 ? 'rTagsMany' : 'rTagsOne', {
        tags: reason.detail.join(', '),
      });
    case 'SHARED_IOCS': {
      // Hashes longos e listas grandes: mostra 3 e o total (a lista toda fica na dica).
      const shown = reason.detail
        .slice(0, 3)
        .map((v) => (v.length > 24 ? `${v.slice(0, 12)}…` : v));
      const more = reason.detail.length > 3 ? ` (+${reason.detail.length - 3})` : '';
      return (
        t(reason.detail.length > 1 ? 'rIocsMany' : 'rIocsOne', { iocs: shown.join(', ') }) + more
      );
    }
    case 'SIMILAR':
      return t('rSimilar', { score: reason.detail });
    case 'SAME_IMPHASH':
      return t('rImphash', { hash: reason.detail.slice(0, 12) });
    case 'SAME_RICH':
      return t('rRich', { hash: reason.detail.slice(0, 12) });
    case 'SIMILAR_PAGE':
      return t('rSimilarPage', { score: reason.detail });
    case 'SHARED_CODE':
      return t('rSharedCode', { n: reason.detail });
    case 'SAME_PIVOT':
      return describePivot(reason.detail.pivot, reason.detail.value, reason.detail.distance);
  }
}

/** Motivo de um pivo em comum (EntryPivot). */
function describePivot(pivot: PivotKind, value: string, distance?: number): string {
  switch (pivot) {
    case 'PDB_PATH':
      // So o fim do caminho: a pasta do projeto e o arquivo.
      return t('rPdbPath', { value: value.split('\\').slice(-3).join('\\') });
    case 'PDB_ID':
      return t('rPdbId', { value: value.slice(0, 12) });
    case 'AUTHENTIHASH':
      return t('rAuthentihash', { value: value.slice(0, 12) });
    case 'EXPHASH':
      return t('rExphash', { value: value.slice(0, 12) });
    case 'ICON_DHASH':
      return t('rIcon', { n: distance ?? 0 });
    case 'TELFHASH':
      return t('rTelfhash', { n: distance ?? 0 });
    case 'SYMHASH':
      return t('rSymhash', { value: value.slice(0, 12) });
    case 'GO_MODULE':
      return t('rGoModule', { value });
    case 'DOC_AUTHOR':
      return t('rDocAuthor', { value });
    case 'DOC_TOOL':
      return t('rDocTool', { value });
    case 'XMP_ID':
      return t('rXmpId', { value });
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
      {t(values.length > 1 ? 'rIocsLabelMany' : 'rIocsLabelOne')}{' '}
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
      <HpsmFilterItem label={t('similarFrom')} htmlFor="related-similarity">
        <Select
          id="related-similarity"
          labelText={t('similarFrom')}
          hideLabel
          size="sm"
          value={String(similarity)}
          onChange={(e) => setSimilarity(Number(e.target.value))}
        >
          {SIMILARITY_OPTIONS.map((value) => (
            <SelectItem
              key={value}
              value={String(value)}
              text={`${value}%${value === DEFAULT_SIMILARITY ? ` ${t('defaultOpt')}` : ''}`}
            />
          ))}
        </Select>
      </HpsmFilterItem>
    </HpsmFilterBar>
  );

  if (query.isLoading) return <HpsmLoading text={t('searchingRelated')} />;
  if (query.isError) {
    return (
      <HpsmMessage kind="error">
        {t('relatedError', { error: (query.error as Error).message })}
      </HpsmMessage>
    );
  }
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  if (items.length === 0) {
    return (
      <>
        {filter}
        <HpsmMessage kind="info">{t('noRelated')}</HpsmMessage>
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
      <p className="dl-related-hint">{t('relatedHelp')}</p>
      {filter}
      <TableContainer>
        <Table size="xs" aria-label={t('relatedAria')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('colReason')}</TableHeader>
              <TableHeader scope="col">{t('colSample')}</TableHeader>
              <TableHeader scope="col">{t('colType')}</TableHeader>
              <TableHeader scope="col">{t('colOwner')}</TableHeader>
              <TableHeader scope="col">{t('colStatus')}</TableHeader>
              <TableHeader scope="col">{t('colVerdict')}</TableHeader>
              <TableHeader scope="col">{t('colDate')}</TableHeader>
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
            ? t('showingTop', { n: items.length, total })
            : t(items.length === 1 ? 'showingOne' : 'showingMany', { n: items.length })}
        </span>
      </div>
    </>
  );
}
