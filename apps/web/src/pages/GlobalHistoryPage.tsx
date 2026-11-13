import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, EntryStatus, Priority, SlaConfig, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AttackFilterInput } from '../components/attack';
import { EntriesTable, entryListParams } from '../components/EntriesTable';
import { suggestViewName } from '../components/favorites';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPage } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { priorityLabel, statusLabel, verdictLabel } from '../components/tags';
import { useEntryListState } from '../components/useEntryListState';
import { useTakeNext } from '../components/useTakeNext';
import { intlLocale } from '../i18n';
import { t } from '../i18n/entry';

export function GlobalHistoryPage() {
  const { user, preferences } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const pageSize = preferences.pageSize;
  // Busca, filtros, ordenacao e pagina ficam na URL (ver useEntryListState).
  const list = useEntryListState();
  const next = useTakeNext();
  const { q, draftQ, setDraftQ, sort, offset } = list;
  const { type, status, verdict, priority, attack, assignee, age, submittedFrom, completedFrom } =
    list.filters;
  // Analistas do select "Responsável" (o Painel leva a um analista especifico).
  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    enabled: canTriage,
    staleTime: 5 * 60 * 1000,
  });
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
  ];

  const params = new URLSearchParams();
  params.set('scope', 'all');
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  if (priority) params.set('priority', priority);
  if (attack) params.set('attack', attack);
  if (assignee) params.set('assignee', assignee);
  if (age) params.set('age', age);
  if (submittedFrom) params.set('submittedFrom', submittedFrom);
  if (completedFrom) params.set('completedFrom', completedFrom);
  entryListParams(params, sort, offset, pageSize);

  // Exportar CSV: mesma busca, filtros e ordenacao, sem paginacao.
  const exportParams = new URLSearchParams(params);
  exportParams.delete('offset');
  exportParams.delete('limit');
  const exportHref = `/api/entries/export.csv?${exportParams.toString()}`;

  const viewName = suggestViewName(t('history'), [
    status && statusLabel(status as EntryStatus),
    verdict && verdictLabel(verdict as Verdict),
    priority && priorityLabel(priority as Priority),
    attack && `ATT&CK ${attack}`,
    type && (type === 'FILE' ? t('files') : 'URLs'),
    assignee === 'me' && t('assignedToMe'),
    assignee === 'none' && t('unassigned'),
    age === 'warn' && t('atRisk'),
    age === 'late' && t('late'),
    q && `"${q}"`,
  ]);

  const query = useQuery({
    queryKey: [
      'entries',
      'all',
      q,
      type,
      status,
      verdict,
      priority,
      attack,
      assignee,
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
      <PageHeader title={t('history')} subtitle={t('historySubtitle')} />

      {/* Analistas: "Pegar a proxima" em todas as filas (Next in queue do HPSM). */}
      {canTriage && (
        <HpsmToolbar label={t('queueActions')}>
          <HpsmToolbarButton
            label={next.taking ? 'Pegando...' : t('takeNext')}
            icon={IconPage}
            title={t('takeNextHelp')}
            disabled={next.taking}
            onClick={() => void next.take()}
          />
        </HpsmToolbar>
      )}
      {next.notice && (
        <HpsmMessage key={next.notice.text} kind={next.notice.kind}>
          {next.notice.text}
        </HpsmMessage>
      )}

      <HpsmFilterBar onClear={list.clear} exportHref={exportHref} viewName={viewName} chips={chips}>
        <HpsmFilterItem label={t('search')} htmlFor="q">
          <TextInput
            id="q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('searchPlaceholder')}
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('colType')} htmlFor="type">
          <Select
            id="type"
            labelText={t('colType')}
            hideLabel
            size="sm"
            value={type}
            onChange={(e) => list.setFilter('type', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="FILE" text={t('typeFile')} />
            <SelectItem value="URL" text={t('typeUrl')} />
          </Select>
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
        <HpsmFilterItem label={t('colPriority')} htmlFor="priority">
          <Select
            id="priority"
            labelText={t('colPriority')}
            hideLabel
            size="sm"
            value={priority}
            onChange={(e) => list.setFilter('priority', e.target.value)}
          >
            <SelectItem value="" text={t('allF')} />
            <SelectItem value="P1" text={t('p1')} />
            <SelectItem value="P2" text={t('p2')} />
            <SelectItem value="P3" text={t('p3')} />
            <SelectItem value="P4" text={t('p4')} />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="ATT&CK" htmlFor="attack">
          <AttackFilterInput
            id="attack"
            value={attack}
            onChange={(value) => list.setFilter('attack', value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('deadline')} htmlFor="age">
          <Select
            id="age"
            labelText={t('deadline')}
            hideLabel
            size="sm"
            value={age}
            onChange={(e) => list.setFilter('age', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="warn" text={t('warnOrLate')} />
            <SelectItem value="late" text={t('late')} />
          </Select>
        </HpsmFilterItem>
        {canTriage && (
          <HpsmFilterItem label={t('colAssignee')} htmlFor="assignee">
            <Select
              id="assignee"
              labelText={t('colAssignee')}
              hideLabel
              size="sm"
              value={assignee}
              onChange={(e) => list.setFilter('assignee', e.target.value)}
            >
              <SelectItem value="" text={t('all')} />
              <SelectItem value="me" text={t('assignedToMe')} />
              <SelectItem value="none" text={t('unassigned')} />
              {(analystsQuery.data?.analysts ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id} text={a.displayName} />
              ))}
            </Select>
          </HpsmFilterItem>
        )}
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={t('loadingSamples')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('loadError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {/* Lista vazia: a grade continua visivel e o aviso vai para a barra de mensagens. */}
      {query.data && query.data.items.length === 0 && (
        <HpsmMessage kind="info">
          {list.q || Object.values(list.filters).some(Boolean) ? (
            t('noSamplesFound')
          ) : (
            <>
              {t('noSamplesYet')}{' '}
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
