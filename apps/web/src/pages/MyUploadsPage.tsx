import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, EntryStatus, SlaConfig, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EntriesTable, entryListParams } from '../components/EntriesTable';
import { suggestViewName } from '../components/favorites';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { statusLabel, verdictLabel } from '../components/tags';
import { useEntryListState } from '../components/useEntryListState';
import { getLocale, intlLocale } from '../i18n';
import { t } from '../i18n/entry';

export function MyUploadsPage() {
  const { user, preferences } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const pageSize = preferences.pageSize;
  // Busca, filtros, ordenacao e pagina ficam na URL (ver useEntryListState).
  const list = useEntryListState();
  const { q, draftQ, setDraftQ, sort, offset } = list;
  const { status, verdict, attack, age, submittedFrom, completedFrom } = list.filters;
  // Filtros de periodo (links do Painel) aparecem como etiquetas removiveis.
  const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());
  const chips = [
    ...(submittedFrom
      ? [
          {
            label: t('sentSince', { date: dateLabel(submittedFrom) }),
            onRemove: () => list.setFilter('submittedFrom', ''),
          },
        ]
      : []),
    ...(completedFrom
      ? [
          {
            label: t('completedSince', { date: dateLabel(completedFrom) }),
            onRemove: () => list.setFilter('completedFrom', ''),
          },
        ]
      : []),
    // Tecnica ATT&CK (link de um relatorio): sem controle proprio aqui.
    ...(attack
      ? [{ label: `ATT&CK ${attack}`, onRemove: () => list.setFilter('attack', '') }]
      : []),
  ];

  const params = new URLSearchParams();
  params.set('scope', 'mine');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  if (attack) params.set('attack', attack);
  if (age) params.set('age', age);
  if (submittedFrom) params.set('submittedFrom', submittedFrom);
  if (completedFrom) params.set('completedFrom', completedFrom);
  entryListParams(params, sort, offset, pageSize);

  // Exportar CSV: mesma busca, filtros e ordenacao, sem paginacao.
  const exportParams = new URLSearchParams(params);
  exportParams.delete('offset');
  exportParams.delete('limit');
  const exportHref = `/api/entries/export.csv?${exportParams.toString()}&lang=${getLocale()}`;

  const viewName = suggestViewName(t('myUploads'), [
    t('myUploads'),
    status && statusLabel(status as EntryStatus),
    verdict && verdictLabel(verdict as Verdict),
    q && `"${q}"`,
  ]);

  const query = useQuery({
    queryKey: [
      'entries',
      'mine',
      user?.id,
      q,
      status,
      verdict,
      attack,
      age,
      submittedFrom,
      completedFrom,
      sort.key,
      sort.dir,
      offset,
      pageSize,
    ],
    queryFn: () =>
      api.get<{ items: Entry[]; total: number; sla: SlaConfig }>(`/entries?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title={t('myUploads')} subtitle={t('myUploadsSubtitle')} />

      <HpsmFilterBar
        onClear={list.clear}
        exportHref={exportHref}
        viewName={viewName}
        chips={[
          ...(age
            ? [
                {
                  label: age === 'late' ? t('late') : t('warnOrLate'),
                  onRemove: () => list.setFilter('age', ''),
                },
              ]
            : []),
          ...chips,
        ]}
      >
        <HpsmFilterItem label={t('search')} htmlFor="q">
          <TextInput
            id="q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('searchPlaceholderMine')}
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('colStatus')} htmlFor="status">
          <Select
            id="status"
            labelText={t('colStatus')}
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="PENDING" text={t('stPending')} />
            <SelectItem value="IN_REVIEW" text={t('stInReview')} />
            <SelectItem value="COMPLETED" text={t('stCompleted')} />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label={t('colVerdict')} htmlFor="verdict">
          <Select
            id="verdict"
            labelText={t('colVerdict')}
            hideLabel
            size="sm"
            value={verdict}
            onChange={(e) => list.setFilter('verdict', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="UNKNOWN" text={t('vUnknown')} />
            <SelectItem value="CLEAN" text={t('vClean')} />
            <SelectItem value="SUSPICIOUS" text={t('vSuspicious')} />
            <SelectItem value="MALICIOUS" text={t('vMalicious')} />
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={t('loadingMine')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('loadError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {/* Lista vazia: a grade continua visivel e o aviso vai para a barra de mensagens. */}
      {query.data && query.data.items.length === 0 && (
        <HpsmMessage kind="info">
          {q || Object.values(list.filters).some(Boolean) ? (
            t('noSamplesFound')
          ) : (
            <>
              {t('noUploadsYet')}{' '}
              <Link className="dl-link" to="/submit">
                {t('submitSample')}
              </Link>
            </>
          )}
        </HpsmMessage>
      )}
      {query.data && (
        <EntriesTable
          entries={query.data.items}
          sla={query.data.sla}
          showOwner={false}
          showResolution
          total={query.data.total}
          offset={offset}
          pageSize={pageSize}
          sort={sort}
          onSortChange={list.setSort}
          onPageChange={list.setOffset}
          selectable={canTriage}
        />
      )}
    </>
  );
}
