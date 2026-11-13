import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, EntryType, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import type { CaseStatus } from '../components/cases';
import { CASE_STATUS, caseHref } from '../components/cases';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmSection } from '../components/HpsmForm';
import type { KbCategory } from '../components/kb';
import { kbCategoryLabel, kbHref } from '../components/kb';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusTag, StatusText, TypeTag, VerdictTag } from '../components/tags';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/misc';

type Group = 'entries' | 'reports' | 'comments' | 'kb' | 'cases';

interface SearchResult {
  groups: Partial<{
    entries: {
      total: number;
      items: {
        id: string;
        title: string;
        type: EntryType;
        status: EntryStatus;
        verdict: Verdict;
        snippet: string;
      }[];
    };
    reports: {
      total: number;
      items: {
        id: string;
        status: string;
        verdict: Verdict;
        entryId: string;
        entryTitle: string;
        analyst: string;
        snippet: string;
      }[];
    };
    comments: {
      total: number;
      items: {
        id: string;
        createdAt: string;
        entryId: string;
        entryTitle: string;
        author: string | null;
        snippet: string;
      }[];
    };
    kb: {
      total: number;
      items: { id: string; title: string; category: KbCategory; snippet: string }[];
    };
    cases: {
      total: number;
      items: { id: string; number: number; title: string; status: CaseStatus; snippet: string }[];
    };
  }>;
}

const TITLES: Record<Group, string> = localized(() => ({
  entries: t('gSamples'),
  reports: t('gReports'),
  comments: t('gComments'),
  kb: t('gKb'),
  cases: t('gCases'),
}));

/** Trecho com o termo destacado (marcadores ⟦ ⟧ da API, sem HTML). */
export function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /⟦([^⟧]*)⟧/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={m.index}>{m[1]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className="dl-search-snippet">{parts}</span>;
}

/**
 * Busca avancada (item 68): um campo so; resultados por tipo (amostras,
 * relatorios, comentarios, base de conhecimento e casos) com o trecho
 * encontrado. Busca, tipo e periodo ficam na URL.
 */
export function SearchPage() {
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? 'all';
  const days = params.get('days') ?? '';
  const [draft, setDraft] = useState(q);

  // O campo segue a URL (ex.: "Ir para:" com outro termo).
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const id = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (draft.trim()) next.set('q', draft.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 400);
    return () => window.clearTimeout(id);
  }, [draft, q, setParams]);

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const query = useQuery({
    queryKey: ['search', q, type, days],
    queryFn: () => {
      const search = new URLSearchParams({ q, type });
      if (days) search.set('days', days);
      return api.get<SearchResult>(`/search?${search.toString()}`);
    },
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
  const groups = query.data?.groups ?? {};
  const order: Group[] = ['entries', 'reports', 'comments', 'kb', 'cases'];
  const shown = order.filter((g) => groups[g]);
  const total = shown.reduce((n, g) => n + (groups[g]?.total ?? 0), 0);

  const more = (g: Group, n: number, listed: number) =>
    type === 'all' && n > listed ? (
      <button type="button" className="dl-link-button" onClick={() => setParam('type', g)}>
        {t('seeAll', { n, group: TITLES[g] })}
      </button>
    ) : null;

  return (
    <>
      <PageHeader title={t('searchTitle')} subtitle={t('searchSubtitle')} />
      <HpsmFilterBar
        onClear={() => {
          setDraft('');
          setParams({}, { replace: true });
        }}
      >
        <HpsmFilterItem label={t('search')} htmlFor="search-q">
          <TextInput
            id="search-q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('searchPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('in')} htmlFor="search-type">
          <Select
            id="search-type"
            labelText={t('in')}
            hideLabel
            size="sm"
            value={type}
            onChange={(e) => setParam('type', e.target.value)}
          >
            <SelectItem value="all" text={t('everything')} />
            {order
              .filter((g) => g !== 'cases' || canTriage)
              .map((g) => (
                <SelectItem key={g} value={g} text={TITLES[g]} />
              ))}
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label={t('period')} htmlFor="search-days">
          <Select
            id="search-days"
            labelText={t('period')}
            hideLabel
            size="sm"
            value={days}
            onChange={(e) => setParam('days', e.target.value)}
          >
            <SelectItem value="" text={t('anyDate')} />
            <SelectItem value="7" text={t('last7')} />
            <SelectItem value="30" text={t('last30')} />
            <SelectItem value="365" text={t('lastYear')} />
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {q.trim().length < 2 && <HpsmMessage kind="info">{t('searchHint')}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={t('searching')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && total === 0 && (
        <HpsmMessage kind="info">{t('nothingFound', { q })}</HpsmMessage>
      )}

      {groups.entries && groups.entries.total > 0 && (
        <HpsmSection title={t('samplesN', { n: groups.entries.total })} className="dl-mt-lg">
          <ul className="dl-search-list">
            {groups.entries.items.map((e) => (
              <li key={e.id}>
                <div className="dl-search-list__head">
                  <Link className="dl-link" to={`/entries/${e.id}`}>
                    {e.title}
                  </Link>
                  <TypeTag type={e.type} /> <StatusTag status={e.status} />{' '}
                  <VerdictTag verdict={e.verdict} />
                </div>
                <Snippet text={e.snippet} />
              </li>
            ))}
          </ul>
          {more('entries', groups.entries.total, groups.entries.items.length)}
        </HpsmSection>
      )}
      {groups.reports && groups.reports.total > 0 && (
        <HpsmSection title={t('reportsN', { n: groups.reports.total })} className="dl-mt-lg">
          <ul className="dl-search-list">
            {groups.reports.items.map((r) => (
              <li key={r.id}>
                <div className="dl-search-list__head">
                  <Link className="dl-link" to={`/entries/${r.entryId}?tab=relatorios`}>
                    {r.entryTitle}
                  </Link>
                  <VerdictTag verdict={r.verdict} />
                  <span className="dl-search-list__meta">
                    {t('reportOf', { analyst: r.analyst })}
                    {r.status !== 'PUBLISHED' ? ` ${t('notPublished')}` : ''}
                  </span>
                </div>
                <Snippet text={r.snippet} />
              </li>
            ))}
          </ul>
          {more('reports', groups.reports.total, groups.reports.items.length)}
        </HpsmSection>
      )}
      {groups.comments && groups.comments.total > 0 && (
        <HpsmSection title={t('commentsN', { n: groups.comments.total })} className="dl-mt-lg">
          <ul className="dl-search-list">
            {groups.comments.items.map((c) => (
              <li key={c.id}>
                <div className="dl-search-list__head">
                  <Link className="dl-link" to={`/entries/${c.entryId}?tab=historico`}>
                    {c.entryTitle}
                  </Link>
                  <span className="dl-search-list__meta">
                    {c.author ?? t('someone')} ·{' '}
                    {new Date(c.createdAt).toLocaleString(intlLocale())}
                  </span>
                </div>
                <Snippet text={c.snippet} />
              </li>
            ))}
          </ul>
          {more('comments', groups.comments.total, groups.comments.items.length)}
        </HpsmSection>
      )}
      {groups.kb && groups.kb.total > 0 && (
        <HpsmSection title={t('kbN', { n: groups.kb.total })} className="dl-mt-lg">
          <ul className="dl-search-list">
            {groups.kb.items.map((k) => (
              <li key={k.id}>
                <div className="dl-search-list__head">
                  <Link className="dl-link" to={kbHref(k.id)}>
                    {k.title}
                  </Link>
                  <StatusText tone="blue">{kbCategoryLabel(k.category)}</StatusText>
                </div>
                <Snippet text={k.snippet} />
              </li>
            ))}
          </ul>
          {more('kb', groups.kb.total, groups.kb.items.length)}
        </HpsmSection>
      )}
      {groups.cases && groups.cases.total > 0 && (
        <HpsmSection title={t('casesN', { n: groups.cases.total })} className="dl-mt-lg">
          <ul className="dl-search-list">
            {groups.cases.items.map((c) => (
              <li key={c.id}>
                <div className="dl-search-list__head">
                  <Link className="dl-link" to={caseHref(c.id)}>
                    CASO-{String(c.number).padStart(4, '0')} · {c.title}
                  </Link>
                  <StatusText tone={CASE_STATUS[c.status].tone}>
                    {CASE_STATUS[c.status].label}
                  </StatusText>
                </div>
                <Snippet text={c.snippet} />
              </li>
            ))}
          </ul>
          {more('cases', groups.cases.total, groups.cases.items.length)}
        </HpsmSection>
      )}
    </>
  );
}
