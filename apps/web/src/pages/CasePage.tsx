import {
  Button,
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
import type { CaseDetail, CaseStatus } from '../components/cases';
import { CASE_STATUS } from '../components/cases';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconAdd, IconArrowLeft } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { PriorityTag, StatusTag, StatusText, TypeTag, VerdictTag } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { useWorkspaceTitle } from '../components/workspace';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Id da amostra a partir do que foi colado: o proprio id ou um link /entries/<id>. */
function parseEntryId(text: string): string {
  const t = text.trim();
  return t.match(/\/entries\/([\w-]+)/)?.[1] ?? t;
}

type Event = CaseDetail['events'][number];

/** Texto de um evento da linha do tempo do caso. */
function eventText(e: Event, names: Map<string, string>): string {
  switch (e.type) {
    case 'CREATED':
      return 'criou o caso';
    case 'ENTRY_ADDED':
      return `incluiu a amostra ${e.entry?.title ?? '(removida)'}`;
    case 'ENTRY_REMOVED':
      return `retirou a amostra ${e.entry?.title ?? '(removida)'}`;
    case 'STATUS_CHANGED':
      return `mudou o status: ${CASE_STATUS[e.fromValue as CaseStatus]?.label ?? e.fromValue} → ${CASE_STATUS[e.toValue as CaseStatus]?.label ?? e.toValue}`;
    case 'ASSIGNED':
      return e.toValue
        ? `atribuiu a ${names.get(e.toValue) ?? 'outro analista'}`
        : 'deixou o caso sem responsável';
    case 'UPDATED':
      return e.detail ? `renomeou para "${e.detail}"` : 'alterou a descrição';
    case 'COMMENT':
      return 'comentou';
  }
}

/**
 * Caso (item 55): dados editaveis, amostras (incluir e retirar; nunca vazio),
 * relatorios publicados das amostras (o caso nao tem relatorio proprio) e linha
 * do tempo com comentarios.
 */
export function CasePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.get<{ case: CaseDetail }>(`/cases/${id}`),
  });
  const c = query.data?.case;
  useWorkspaceTitle(c ? `${c.code} · ${c.title}` : undefined);

  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    staleTime: 5 * 60 * 1000,
  });
  const analysts = analystsQuery.data?.analysts ?? [];
  const names = new Map(analysts.map((a) => [a.id, a.displayName]));

  const [form, setForm] = useState({ title: '', description: '', status: 'OPEN', assigneeId: '' });
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [comment, setComment] = useState('');

  // O formulario parte do caso carregado (e volta a ele depois de salvar).
  useEffect(() => {
    if (!c || loadedAt === c.updatedAt) return;
    setForm({
      title: c.title,
      description: c.description ?? '',
      status: c.status,
      assigneeId: c.assignee?.id ?? '',
    });
    setLoadedAt(c.updatedAt);
  }, [c, loadedAt]);

  const original = c
    ? {
        title: c.title,
        description: c.description ?? '',
        status: c.status,
        assigneeId: c.assignee?.id ?? '',
      }
    : form;
  const dirty = Boolean(c) && JSON.stringify(form) !== JSON.stringify(original);
  const { allowNavigation } = useUnsavedChanges(dirty || Boolean(comment.trim()));

  const check = useRequiredFields([
    {
      id: 'case-title',
      label: 'Título (3 a 150 caracteres)',
      ok: form.title.trim().length >= 3,
      api: 'title',
      value: form.title,
    },
    {
      id: 'case-assignee',
      label: 'Responsável',
      ok: true,
      api: 'assigneeId',
      value: form.assigneeId,
    },
  ]);

  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['case', id] }),
      queryClient.invalidateQueries({ queryKey: ['cases'] }),
    ]);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await reload();
      setNotice({ ok: true, text });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!c || !check.check()) return;
    await run(async () => {
      await api.patch(`/cases/${c.id}`, {
        title: form.title,
        description: form.description,
        status: form.status,
        assigneeId: form.assigneeId || null,
      });
      allowNavigation();
      return 'Caso atualizado.';
    });
  };
  useSaveShortcut(save, !busy && dirty);

  const addEntry = async () => {
    const entryId = parseEntryId(addId);
    if (!c || !entryId) return;
    await run(async () => {
      const res = await api.post<{ added: number }>(`/cases/${c.id}/entries`, {
        entryIds: [entryId],
      });
      setAddId('');
      return res.added ? 'Amostra incluída no caso.' : 'A amostra já estava no caso.';
    });
  };

  const removeEntry = async (entry: { id: string; title: string }) => {
    if (!c) return;
    const ok = await confirm({
      title: 'Retirar amostra',
      message: `Retirar "${entry.title}" do caso ${c.code}? A amostra não é apagada.`,
      confirmLabel: 'Retirar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/cases/${c.id}/entries/${entry.id}`);
      return `"${entry.title}" retirada do caso.`;
    });
  };

  const sendComment = async () => {
    if (!c || !comment.trim()) return;
    await run(async () => {
      await api.post(`/cases/${c.id}/comments`, { text: comment });
      setComment('');
      return 'Comentário registrado.';
    });
  };

  if (query.isLoading) return <HpsmLoading text="Carregando caso..." />;
  if (query.isError || !c) {
    return (
      <HpsmMessage kind="error">
        {(query.error as Error | null)?.message ?? 'Caso não encontrado.'}
      </HpsmMessage>
    );
  }

  const reports = c.entries.flatMap((ce) =>
    ce.entry.reports.map((r) => ({ ...r, entry: ce.entry })),
  );
  const onlyOne = c.entries.length <= 1;

  return (
    <>
      <HpsmToolbar label="Ações do caso">
        <HpsmToolbarButton
          label="Voltar aos casos"
          icon={IconArrowLeft}
          onClick={() => navigate('/casos')}
        />
        <HpsmToolbarButton
          label={busy ? 'Salvando...' : 'Salvar'}
          title="Salvar (Ctrl+S)"
          icon={IconAdd}
          disabled={busy || !dirty}
          onClick={() => void save()}
        />
      </HpsmToolbar>
      <PageHeader title={`${c.code} · ${c.title}`} subtitle={c.description ?? undefined} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      <div className="dl-summary dl-mb-lg">
        <span>
          <span className="dl-summary__label">Status:</span>{' '}
          <StatusText tone={CASE_STATUS[c.status].tone}>{CASE_STATUS[c.status].label}</StatusText>
        </span>
        <span>
          <span className="dl-summary__label">Responsável:</span> {c.assignee?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">Amostras:</span> {c.entries.length}
        </span>
        <span>
          <span className="dl-summary__label">Criado:</span> {fmtDate(c.createdAt)}
          {c.createdBy ? ` por ${c.createdBy.displayName}` : ''}
        </span>
        {c.closedAt && (
          <span>
            <span className="dl-summary__label">Encerrado:</span> {fmtDate(c.closedAt)}
          </span>
        )}
      </div>

      <HpsmSection title="Dados do caso">
        <HpsmForm columns={2}>
          <HpsmField
            label="Título"
            htmlFor="case-title"
            required
            wide
            invalid={check.isInvalid('case-title')}
          >
            <TextInput
              id="case-title"
              labelText="Título"
              hideLabel
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label="Status" htmlFor="case-status">
            <Select
              id="case-status"
              labelText="Status"
              hideLabel
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <SelectItem value="OPEN" text="Aberto" />
              <SelectItem value="IN_PROGRESS" text="Em andamento" />
              <SelectItem value="CLOSED" text="Encerrado" />
            </Select>
          </HpsmField>
          <HpsmField
            label="Responsável"
            htmlFor="case-assignee"
            invalid={check.isInvalid('case-assignee')}
          >
            <Select
              id="case-assignee"
              labelText="Responsável"
              hideLabel
              value={form.assigneeId}
              onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
            >
              <SelectItem value="" text="— Sem responsável —" />
              {analysts.map((a) => (
                <SelectItem key={a.id} value={a.id} text={a.displayName} />
              ))}
            </Select>
          </HpsmField>
          <HpsmField label="Descrição" htmlFor="case-description" wide top>
            <TextArea
              id="case-description"
              labelText="Descrição"
              hideLabel
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      <HpsmSection title={`Amostras (${c.entries.length})`} className="dl-mt-lg">
        <TableContainer>
          <Table size="xs" aria-label="Amostras do caso">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Amostra</TableHeader>
                <TableHeader scope="col">Tipo</TableHeader>
                <TableHeader scope="col">Status</TableHeader>
                <TableHeader scope="col">Prioridade</TableHeader>
                <TableHeader scope="col">Veredito</TableHeader>
                <TableHeader scope="col">Incluída</TableHeader>
                <TableHeader scope="col">Ações</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.entries.map(({ entry, addedAt, addedBy }) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Link className="dl-link" to={`/entries/${entry.id}`}>
                      {entry.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TypeTag type={entry.type} />
                  </TableCell>
                  <TableCell>
                    <StatusTag status={entry.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityTag priority={entry.priority} />
                  </TableCell>
                  <TableCell>
                    <VerdictTag verdict={entry.verdict} />
                  </TableCell>
                  <TableCell>
                    {fmtDate(addedAt)}
                    {addedBy ? ` por ${addedBy.displayName}` : ''}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="dl-link-button dl-link-button--danger"
                      disabled={busy || onlyOne}
                      title={
                        onlyOne
                          ? 'O caso precisa de ao menos uma amostra (encerre o caso para desfazê-lo)'
                          : undefined
                      }
                      onClick={() => void removeEntry(entry)}
                    >
                      Retirar…
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <div className="dl-case-add">
          <TextInput
            id="case-add-entry"
            labelText="Incluir amostra (ID ou link)"
            size="sm"
            placeholder="Ex.: cm3x9... ou https://.../entries/cm3x9..."
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addEntry();
              }
            }}
          />
          <Button
            kind="tertiary"
            size="sm"
            disabled={busy || !addId.trim()}
            onClick={() => void addEntry()}
          >
            Incluir
          </Button>
        </div>
      </HpsmSection>

      <HpsmSection title={`Relatórios das amostras (${reports.length})`} className="dl-mt-lg">
        {reports.length === 0 ? (
          <p className="dl-static-empty">Nenhuma amostra do caso tem relatório publicado ainda.</p>
        ) : (
          <ul className="dl-case-reports">
            {reports.map((r) => (
              <li key={r.id}>
                <div className="dl-case-reports__head">
                  <Link className="dl-link" to={`/entries/${r.entry.id}?tab=relatorios`}>
                    {r.entry.title}
                  </Link>
                  <VerdictTag verdict={r.verdict} />
                  <span className="dl-case-reports__meta">
                    {r.analyst?.displayName ?? '—'} · {fmtDate(r.updatedAt)}
                    {r.attackTechniques.length > 0 && ` · ATT&CK: ${r.attackTechniques.join(', ')}`}
                  </span>
                </div>
                <p>{r.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </HpsmSection>

      <HpsmSection title="Linha do tempo" className="dl-mt-lg">
        <ol className="dl-case-timeline">
          {c.events.map((e) => (
            <li key={e.id}>
              <span className="dl-case-timeline__when">{fmtDate(e.createdAt)}</span>{' '}
              <strong>{e.actor?.displayName ?? 'Alguém'}</strong> {eventText(e, names)}
              {e.type === 'COMMENT' && e.detail && (
                <p className="dl-case-timeline__comment">{e.detail}</p>
              )}
            </li>
          ))}
        </ol>
        <div className="dl-case-comment">
          <TextArea
            id="case-comment"
            labelText="Novo comentário"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            kind="tertiary"
            size="sm"
            disabled={busy || !comment.trim()}
            onClick={() => void sendComment()}
          >
            Comentar
          </Button>
        </div>
      </HpsmSection>
    </>
  );
}
