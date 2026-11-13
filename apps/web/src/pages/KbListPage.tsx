import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd } from '../components/icons';
import type { KbArticleSummary, KbCategory } from '../components/kb';
import { KB_CATEGORIES, kbCategoryLabel, kbHref } from '../components/kb';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/tags';
import { intlLocale } from '../i18n';
import { t } from '../i18n/kb';

/**
 * Base de conhecimento (item 63): busca por titulo, resumo, tags e texto,
 * filtro por categoria. Busca e categoria ficam na URL.
 */
export function KbListPage() {
  const { user } = useAuth();
  const canWrite = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = (params.get('category') ?? '') as KbCategory | '';
  const [draft, setDraft] = useState(q);

  // Busca aplicada depois de uma pausa na digitacao.
  useEffect(() => {
    if (draft === q) return;
    const id = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (draft.trim()) next.set('q', draft);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(id);
  }, [draft, q, setParams]);

  const query = useQuery({
    queryKey: ['kb', q, category],
    queryFn: () => {
      const search = new URLSearchParams();
      if (q) search.set('q', q);
      if (category) search.set('category', category);
      return api.get<{ total: number; items: KbArticleSummary[] }>(`/kb?${search.toString()}`);
    },
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];

  const setCategory = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set('category', value);
        else next.delete('category');
        return next;
      },
      { replace: true },
    );

  return (
    <>
      {canWrite && (
        <HpsmToolbar label={t('kbActions')}>
          <HpsmToolbarButton
            label={t('newArticle')}
            icon={IconAdd}
            onClick={() => navigate('/kb/novo')}
          />
        </HpsmToolbar>
      )}
      <PageHeader title={t('kb')} subtitle={t('kbSubtitle')} />
      <HpsmFilterBar
        onClear={() => {
          setDraft('');
          setParams({}, { replace: true });
        }}
      >
        <HpsmFilterItem label={t('search')} htmlFor="kb-q">
          <TextInput
            id="kb-q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('kbSearchPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('category')} htmlFor="kb-category">
          <Select
            id="kb-category"
            labelText={t('category')}
            hideLabel
            size="sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <SelectItem value="" text={t('allF')} />
            {KB_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id} text={c.label} />
            ))}
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={t('loadingArticles')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">{q || category ? t('noArticlesFound') : t('kbEmpty')}</HpsmMessage>
      )}
      {items.length > 0 && (
        <ul className="dl-kb-list" aria-label={t('articlesAria')}>
          {items.map((a) => (
            <li key={a.id} className="dl-kb-card">
              <div className="dl-kb-card__head">
                <Link className="dl-link dl-kb-card__title" to={kbHref(a.id)}>
                  {a.title}
                </Link>
                <StatusText tone="blue">{kbCategoryLabel(a.category)}</StatusText>
              </div>
              <p className="dl-kb-card__summary">{a.summary}</p>
              <div className="dl-kb-card__meta">
                {a.tags.length > 0 && <span>{t('tagsList', { tags: a.tags.join(', ') })}</span>}
                <span>
                  {t('updatedOn', { date: new Date(a.updatedAt).toLocaleDateString(intlLocale()) })}
                  {a.updatedBy ? ` ${t('byName', { name: a.updatedBy.displayName })}` : ''}
                </span>
                {(a.citations ?? 0) > 0 && (
                  <span>{t(a.citations === 1 ? 'citedOne' : 'citedMany', { n: a.citations })}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
