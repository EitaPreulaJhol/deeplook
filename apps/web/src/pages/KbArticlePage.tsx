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

const BODY_HELP =
  'Markdown: # título, **negrito**, *itálico*, `código`, listas com - ou 1., > citação, ``` bloco de código, [texto](https://...). URL solta não vira link.';

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
      ? `Editar · ${article.title}`
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
      label: 'Título (3 a 120 caracteres)',
      ok: form.title.trim().length >= 3,
      api: 'title',
      value: form.title,
    },
    {
      id: 'kb-summary',
      label: 'Resumo (mínimo de 10 caracteres)',
      ok: form.summary.trim().length >= 10,
      api: 'summary',
      value: form.summary,
    },
    { id: 'kb-tags', label: 'Tags', ok: true, api: 'tags', value: form.tags },
    {
      id: 'kb-body',
      label: 'Texto',
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
      title: 'Excluir artigo',
      message: `Excluir "${article.title}"? Os relatórios que o citam perdem o link.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
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

  if (mode !== 'new' && query.isLoading) return <HpsmLoading text="Carregando artigo..." />;
  if (mode !== 'new' && (query.isError || !article)) {
    return (
      <HpsmMessage kind="error">
        {(query.error as Error | null)?.message ?? 'Artigo não encontrado.'}
      </HpsmMessage>
    );
  }

  if (editing) {
    if (!canWrite)
      return (
        <HpsmMessage kind="error">Somente analistas escrevem na base de conhecimento.</HpsmMessage>
      );
    return (
      <>
        <HpsmToolbar label="Ações do artigo">
          <HpsmToolbarButton
            label={saving ? 'Salvando...' : 'Salvar artigo'}
            title="Salvar (Ctrl+S)"
            icon={IconAdd}
            disabled={saving}
            onClick={() => void save()}
          />
          <HpsmToolbarButton
            label="Cancelar"
            icon={IconArrowLeft}
            onClick={() => navigate(mode === 'edit' ? kbHref(id) : '/kb')}
          />
        </HpsmToolbar>
        <PageHeader
          title={mode === 'edit' ? `Editar: ${article?.title ?? ''}` : 'Novo artigo'}
          subtitle="Base de conhecimento"
        />
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
        <HpsmSection title="Artigo">
          <HpsmForm columns={2}>
            <HpsmField
              label="Título"
              htmlFor="kb-title"
              required
              invalid={check.isInvalid('kb-title')}
            >
              <TextInput
                id="kb-title"
                labelText="Título"
                hideLabel
                placeholder="Ex.: Grandoreiro"
                value={form.title}
                onChange={(e) => set('title')(e.target.value)}
              />
            </HpsmField>
            <HpsmField label="Categoria" htmlFor="kb-category">
              <Select
                id="kb-category"
                labelText="Categoria"
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
              label="Resumo"
              htmlFor="kb-summary"
              required
              wide
              top
              invalid={check.isInvalid('kb-summary')}
            >
              <TextArea
                id="kb-summary"
                labelText="Resumo"
                hideLabel
                rows={2}
                value={form.summary}
                onChange={(e) => set('summary')(e.target.value)}
              />
            </HpsmField>
            <HpsmField
              label="Tags"
              htmlFor="kb-tags"
              wide
              invalid={check.isInvalid('kb-tags')}
              help="Separadas por vírgula (até 10)."
            >
              <TextInput
                id="kb-tags"
                labelText="Tags"
                hideLabel
                placeholder="banker, brasil, phishing"
                value={form.tags}
                onChange={(e) => set('tags')(e.target.value)}
              />
            </HpsmField>
          </HpsmForm>
          <div className="dl-kb-editor">
            <HpsmField
              label="Texto"
              htmlFor="kb-body"
              required
              top
              invalid={check.isInvalid('kb-body')}
              help={BODY_HELP}
            >
              <TextArea
                id="kb-body"
                className="dl-code-input"
                labelText="Texto"
                hideLabel
                rows={22}
                value={form.body}
                onChange={(e) => set('body')(e.target.value)}
              />
            </HpsmField>
            <div className="dl-kb-preview" aria-label="Pré-visualização">
              <div className="dl-kb-preview__label">Pré-visualização</div>
              {form.body.trim() ? (
                <Markdown source={form.body} />
              ) : (
                <p className="dl-static-empty">O texto aparece aqui enquanto você escreve.</p>
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
      <HpsmToolbar label="Ações do artigo">
        <HpsmToolbarButton
          label="Voltar à base"
          icon={IconArrowLeft}
          onClick={() => navigate('/kb')}
        />
        {canWrite && (
          <HpsmToolbarButton label="Editar" onClick={() => navigate(`${kbHref(a.id)}/editar`)} />
        )}
        {a.canDelete && (
          <HpsmToolbarButton label="Excluir…" icon={IconTrash} onClick={() => void remove()} />
        )}
      </HpsmToolbar>
      <PageHeader title={a.title} subtitle={a.summary} />
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <div className="dl-summary dl-mb-lg">
        <span>
          <span className="dl-summary__label">Categoria:</span>{' '}
          <StatusText tone="blue">{kbCategoryLabel(a.category)}</StatusText>
        </span>
        {a.tags.length > 0 && (
          <span>
            <span className="dl-summary__label">Tags:</span> {a.tags.join(', ')}
          </span>
        )}
        <span>
          <span className="dl-summary__label">Criado por:</span> {a.createdBy?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">Atualizado:</span> {fmtDate(a.updatedAt)}
          {a.updatedBy ? ` por ${a.updatedBy.displayName}` : ''}
        </span>
      </div>
      <HpsmSection title="Artigo">
        <div className="dl-kb-body">
          <Markdown source={a.body} />
        </div>
      </HpsmSection>
      <HpsmSection title={`Citado em (${a.reports.length})`} className="dl-mt-lg">
        {a.reports.length === 0 ? (
          <p className="dl-static-empty">Nenhum relatório publicado cita este artigo ainda.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Relatórios que citam o artigo">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Amostra</TableHeader>
                  <TableHeader scope="col">Veredito</TableHeader>
                  <TableHeader scope="col">Analista</TableHeader>
                  <TableHeader scope="col">Relatório</TableHeader>
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
        <HpsmSection title="Alterações" className="dl-mt-lg">
          <HpsmForm>
            <HpsmField label="Últimas edições" wide top>
              <HpsmReadonly multiline>
                {a.revisions
                  .map((r) => `${fmtDate(r.createdAt)} — ${r.editor?.displayName ?? 'alguém'}`)
                  .join('\n')}
              </HpsmReadonly>
            </HpsmField>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
