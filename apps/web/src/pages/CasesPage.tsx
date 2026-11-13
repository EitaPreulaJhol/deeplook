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
  TextInput,
} from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { CaseSummary } from '../components/cases';
import { CASE_STATUS, caseHref } from '../components/cases';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/tags';
import { intlLocale } from '../i18n';
import { t } from '../i18n/cases';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Casos (item 55; analistas): lista com status, responsavel e busca (titulo,
 * descricao ou numero, ex.: "CASO-0007"). Filtros na URL (o navegador aponta
 * direto para "ativos" e "meus").
 */
export function CasesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const assignee = params.get('assignee') ?? '';
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (draft === q) return;
    const id = window.setTimeout(() => setParam('q', draft.trim()), 300);
    return () => window.clearTimeout(id);
    // setParam muda a cada render; so a digitacao importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, q]);

  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    staleTime: 5 * 60 * 1000,
  });
  const query = useQuery({
    queryKey: ['cases', status, assignee, q],
    queryFn: () => {
      const search = new URLSearchParams();
      if (status) search.set('status', status);
      if (assignee) search.set('assignee', assignee);
      if (q) search.set('q', q);
      return api.get<{ total: number; items: CaseSummary[] }>(`/cases?${search.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader title={t('cases')} subtitle={t('casesSubtitle')} />
      <HpsmFilterBar
        onClear={() => {
          setDraft('');
          setParams({}, { replace: true });
        }}
      >
        <HpsmFilterItem label={t('search')} htmlFor="case-q">
          <TextInput
            id="case-q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('casesSearchPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('status')} htmlFor="case-status">
          <Select
            id="case-status"
            labelText={t('status')}
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="active" text={t('activeOnly')} />
            <SelectItem value="OPEN" text={t('stOpen')} />
            <SelectItem value="IN_PROGRESS" text={t('stInProgress')} />
            <SelectItem value="CLOSED" text={t('stClosed')} />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label={t('assignee')} htmlFor="case-assignee">
          <Select
            id="case-assignee"
            labelText={t('assignee')}
            hideLabel
            size="sm"
            value={assignee}
            onChange={(e) => setParam('assignee', e.target.value)}
          >
            <SelectItem value="" text={t('all')} />
            <SelectItem value="me" text={t('myCases')} />
            <SelectItem value="none" text={t('unassigned')} />
            {(analystsQuery.data?.analysts ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id} text={a.displayName} />
            ))}
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={t('loadingCases')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">{t('noCasesFound')}</HpsmMessage>
      )}
      {items.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label={t('cases')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('case')}</TableHeader>
                <TableHeader scope="col">{t('title')}</TableHeader>
                <TableHeader scope="col">{t('status')}</TableHeader>
                <TableHeader scope="col">{t('assignee')}</TableHeader>
                <TableHeader scope="col">{t('samples')}</TableHeader>
                <TableHeader scope="col">{t('updated')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link className="dl-link dl-mono" to={caseHref(c.id)}>
                      {c.code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link className="dl-link" to={caseHref(c.id)}>
                      {c.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusText tone={CASE_STATUS[c.status].tone}>
                      {CASE_STATUS[c.status].label}
                    </StatusText>
                  </TableCell>
                  <TableCell>{c.assignee?.displayName ?? '—'}</TableCell>
                  <TableCell>{c.entries}</TableCell>
                  <TableCell>{fmtDate(c.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
