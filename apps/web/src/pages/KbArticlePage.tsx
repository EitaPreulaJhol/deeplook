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
  TextArea,
  TextInput,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmReadonly,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd, IconArrowLeft, IconTrash } from '../components/icons';
import type { KbArticle, KbCategory } from '../components/kb';
import { KB_CATEGORIES, kbCategoryLabel, kbHref } from '../components/kb';
import { Markdown } from '../components/Markdown';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { StatusText, VerdictTag } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { useWorkspaceTitle } from '../components/workspace';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/kb';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

const EMPTY = {
  title: '',
  summary: '',
  category: 'MALWARE_FAMILY' as KbCategory,
  tags: '',
  body: '',
};

const BODY_HELP = () => tr('bodyHelp');

/**
 * Artigo da base de conhecimento (item 63): leitura (/kb/:id), novo (/kb/novo)
 * e edicao (/kb/:id/editar) com pre-visualizacao ao lado.
 */
export function KbArticlePage({ mode }: { mode: 'view' | 'new' | 'edit' }) {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const canWrite = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['kb', 'article', id],
    queryFn: () => api.get<{ article: KbArticle }>(`/kb/${id}`),
    enabled: mode !== 'new' && Boolean(id),
  });
  const article = query.data?.article;
  useWorkspaceTitle(
    mode === 'edit' && article
      ? tr('editTitle', { title: article.title })
      : mode === 'view'
        ? article?.title
        : undefined,
  );

  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(mode === 'new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edicao: o formulario parte do artigo carregado.
  useEffect(() => {
    if (mode !== 'edit' || !article || loaded) return;
    setForm({
      title: article.title,
      summary: article.summary,
      category: article.category,
      tags: article.tags.join(', '),
      body: article.body,
    });
    setLoaded(true);
  }, [mode, article, loaded]);

  const editing = mode !== 'view';
  const original =
    mode === 'edit' && article
      ? {
          title: article.title,
          summary: article.summary,
          category: article.category,
          tags: article.tags.join(', '),
          body: article.body,
        }
      : EMPTY;
  const dirty = editing && loaded && JSON.stringify(form) !== JSON.stringify(original);
  const { allowNavigation } = useUnsavedChanges(dirty);
  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const check = useRequiredFields([
    {
      id: 'kb-title',
      label: tr('titleRange'),
      ok: form.title.trim().length >= 3,
      api: 'title',
      value: form.title,
    },
    {
      id: 'kb-summary',
      label: tr('summaryMin'),
      ok: form.summary.trim().length >= 10,
      api: 'summary',
      value: form.summary,
    },
    { id: 'kb-tags', label: tr('tags'), ok: true, api: 'tags', value: form.tags },
    {
      id: 'kb-body',
      label: tr('text'),
      ok: form.body.trim().length > 0,
      api: 'body',
      value: form.body,
    },
  ]);

  const save = async () => {
    setError(null);
    if (!check.check()) return;
    setSaving(true);
    const body = {
      title: form.title,
      summary: form.summary,
      category: form.category,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      body: form.body,
    };
    try {
      const res =
        mode === 'edit'
          ? await api.patch<{ article: { id: string } }>(`/kb/${id}`, body)
          : await api.post<{ article: { id: string } }>('/kb', body);
      await queryClient.invalidateQueries({ queryKey: ['kb'] });
      allowNavigation();
      navigate(kbHref(res.article.id));
    } catch (err) {
      if (!check.fromApi(err)) setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(save, editing && canWrite && !saving);

  const remove = async () => {
    if (!article) return;
    const ok = await confirm({
      title: tr('deleteArticle'),
      message: tr('deleteArticleConfirm', { title: article.title }),
      confirmLabel: tr('delete'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/kb/${article.id}`);
      // O artigo nao existe mais: sai sem recarrega-lo (daria 404).
      queryClient.removeQueries({ queryKey: ['kb', 'article', article.id] });
      navigate('/kb');
      void queryClient.invalidateQueries({ queryKey: ['kb'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (mode !== 'new' && query.isLoading) return <HpsmLoading text={tr('loadingArticle')} />;
  if (mode !== 'new' && (query.isError || !article)) {
    return (
      <HpsmMessage kind="error">
        {(query.error as Error | null)?.message ?? tr('articleNotFound')}
      </HpsmMessage>
    );
  }

  if (editing) {
    if (!canWrite) return <HpsmMessage kind="error">{tr('analystsOnly')}</HpsmMessage>;
    return (
      <>
        <HpsmToolbar label={tr('articleActions')}>
          <HpsmToolbarButton
            label={saving ? tr('saving') : tr('saveArticle')}
            title={tr('saveHint')}
            icon={IconAdd}
            disabled={saving}
            onClick={() => void save()}
          />
          <HpsmToolbarButton
            label={tr('cancel')}
            icon={IconArrowLeft}
            onClick={() => navigate(mode === 'edit' ? kbHref(id) : '/kb')}
          />
        </HpsmToolbar>
        <PageHeader
          title={
            mode === 'edit' ? tr('editColon', { title: article?.title ?? '' }) : tr('newArticle')
          }
          subtitle={tr('kb')}
        />
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
        <HpsmSection title={tr('article')}>
          <HpsmForm columns={2}>
            <HpsmField
              label={tr('title')}
              htmlFor="kb-title"
              required
              invalid={check.isInvalid('kb-title')}
            >
              <TextInput
                id="kb-title"
                labelText={tr('title')}
                hideLabel
                placeholder={tr('titlePlaceholder')}
                value={form.title}
                onChange={(e) => set('title')(e.target.value)}
              />
            </HpsmField>
            <HpsmField label={tr('category')} htmlFor="kb-category">
              <Select
                id="kb-category"
                labelText={tr('category')}
                hideLabel
                value={form.category}
                onChange={(e) => set('category')(e.target.value)}
              >
                {KB_CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id} text={c.label} />
                ))}
              </Select>
            </HpsmField>
            <HpsmField
              label={tr('summary')}
              htmlFor="kb-summary"
              required
              wide
              top
              invalid={check.isInvalid('kb-summary')}
            >
              <TextArea
                id="kb-summary"
                labelText={tr('summary')}
                hideLabel
                rows={2}
                value={form.summary}
                onChange={(e) => set('summary')(e.target.value)}
              />
            </HpsmField>
            <HpsmField
              label={tr('tags')}
              htmlFor="kb-tags"
              wide
              invalid={check.isInvalid('kb-tags')}
              help={tr('tagsHelp')}
            >
              <TextInput
                id="kb-tags"
                labelText={tr('tags')}
                hideLabel
                placeholder="banker, brasil, phishing"
                value={form.tags}
                onChange={(e) => set('tags')(e.target.value)}
              />
            </HpsmField>
          </HpsmForm>
          <div className="dl-kb-editor">
            <HpsmField
              label={tr('text')}
              htmlFor="kb-body"
              required
              top
              invalid={check.isInvalid('kb-body')}
              help={BODY_HELP()}
            >
              <TextArea
                id="kb-body"
                className="dl-code-input"
                labelText={tr('text')}
                hideLabel
                rows={22}
                value={form.body}
                onChange={(e) => set('body')(e.target.value)}
              />
            </HpsmField>
            <div className="dl-kb-preview" aria-label={tr('preview')}>
              <div className="dl-kb-preview__label">{tr('preview')}</div>
              {form.body.trim() ? (
                <Markdown source={form.body} />
              ) : (
                <p className="dl-static-empty">{tr('previewHint')}</p>
              )}
            </div>
          </div>
        </HpsmSection>
      </>
    );
  }

  const a = article!;
  return (
    <>
      <HpsmToolbar label={tr('articleActions')}>
        <HpsmToolbarButton
          label={tr('backToKb')}
          icon={IconArrowLeft}
          onClick={() => navigate('/kb')}
        />
        {canWrite && (
          <HpsmToolbarButton
            label={tr('edit')}
            onClick={() => navigate(`${kbHref(a.id)}/editar`)}
          />
        )}
        {a.canDelete && (
          <HpsmToolbarButton
            label={tr('deleteEllipsis')}
            icon={IconTrash}
            onClick={() => void remove()}
          />
        )}
      </HpsmToolbar>
      <PageHeader title={a.title} subtitle={a.summary} />
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <div className="dl-summary">
        <span>
          <span className="dl-summary__label">{tr('sumCategory')}</span>{' '}
          <StatusText tone="blue">{kbCategoryLabel(a.category)}</StatusText>
        </span>
        {a.tags.length > 0 && (
          <span>
            <span className="dl-summary__label">{tr('sumTags')}</span> {a.tags.join(', ')}
          </span>
        )}
        <span>
          <span className="dl-summary__label">{tr('createdBy')}</span>{' '}
          {a.createdBy?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">{tr('updated')}</span> {fmtDate(a.updatedAt)}
          {a.updatedBy ? ` por ${a.updatedBy.displayName}` : ''}
        </span>
      </div>
      <HpsmSection title={tr('article')}>
        <div className="dl-kb-body">
          <Markdown source={a.body} />
        </div>
      </HpsmSection>
      <HpsmSection title={tr('citedIn', { n: a.reports.length })}>
        {a.reports.length === 0 ? (
          <p className="dl-static-empty">{tr('notCited')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={tr('citingAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{tr('sample')}</TableHeader>
                  <TableHeader scope="col">{tr('verdict')}</TableHeader>
                  <TableHeader scope="col">{tr('analyst')}</TableHeader>
                  <TableHeader scope="col">{tr('report')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {a.reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link className="dl-link" to={`/entries/${r.entry.id}?tab=relatorios`}>
                        {r.entry.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <VerdictTag verdict={r.entry.verdict} />
                    </TableCell>
                    <TableCell>{r.analyst?.displayName ?? '—'}</TableCell>
                    <TableCell>{fmtDate(r.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
      {a.revisions.length > 0 && (
        <HpsmSection title={tr('changes')}>
          <HpsmForm>
            <HpsmField label={tr('lastEdits')} wide top>
              <HpsmReadonly multiline>
                {a.revisions
                  .map((r) => `${fmtDate(r.createdAt)} — ${r.editor?.displayName ?? tr('someone')}`)
                  .join('\n')}
              </HpsmReadonly>
            </HpsmField>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
