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
        <HpsmToolbar label="Ações da base de conhecimento">
          <HpsmToolbarButton
            label="Novo artigo"
            icon={IconAdd}
            onClick={() => navigate('/kb/novo')}
          />
        </HpsmToolbar>
      )}
      <PageHeader
        title="Base de conhecimento"
        subtitle="Famílias de malware, golpes, técnicas e procedimentos da equipe."
      />
      <HpsmFilterBar
        onClear={() => {
          setDraft('');
          setParams({}, { replace: true });
        }}
      >
        <HpsmFilterItem label="Buscar" htmlFor="kb-q">
          <TextInput
            id="kb-q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Título, resumo, tag ou texto..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label="Categoria" htmlFor="kb-category">
          <Select
            id="kb-category"
            labelText="Categoria"
            hideLabel
            size="sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <SelectItem value="" text="Todas" />
            {KB_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id} text={c.label} />
            ))}
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando artigos..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">
          {q || category ? 'Nenhum artigo encontrado.' : 'A base de conhecimento ainda está vazia.'}
        </HpsmMessage>
      )}
      {items.length > 0 && (
        <ul className="dl-kb-list" aria-label="Artigos">
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
                {a.tags.length > 0 && <span>Tags: {a.tags.join(', ')}</span>}
                <span>
                  Atualizado em {new Date(a.updatedAt).toLocaleDateString(intlLocale())}
                  {a.updatedBy ? ` por ${a.updatedBy.displayName}` : ''}
                </span>
                {(a.citations ?? 0) > 0 && (
                  <span>
                    Citado em {a.citations} relatório{a.citations === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
