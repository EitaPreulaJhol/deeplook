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
import { useAuth } from '../auth/AuthContext';
import { useAttack } from '../components/attack';
import { caseMarkdown } from '../components/caseExport';
import type { CaseDetail, CaseIoc } from '../components/cases';
import { CASE_STATUS, caseEventText } from '../components/cases';
import { CaseStixImportDialog } from '../components/CaseStixImportDialog';
import { downloadText, downloadUrl } from '../components/entryExport';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import {
  HpsmToolbar,
  HpsmToolbarButton,
  HpsmToolbarDivider,
  HpsmToolbarMenu,
} from '../components/HpsmToolbar';
import { IconAdd, IconArrowLeft, IconDownload, IconPrint } from '../components/icons';
import { IOC_KIND_LABELS, iocHref } from '../components/iocs';
import type { Mention } from '../components/MentionTextArea';
import { MentionTextArea, renderMentions } from '../components/MentionTextArea';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { RelationMap } from '../components/RelationMap';
import { useSaveShortcut } from '../components/shortcuts';
import { PriorityTag, StatusTag, StatusText, TypeTag, VerdictTag } from '../components/tags';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { useWorkspaceTitle } from '../components/workspace';
import { getLocale, intlLocale } from '../i18n';
import { t as tr } from '../i18n/cases';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** Id da amostra a partir do que foi colado: o proprio id ou um link /entries/<id>. */
function parseEntryId(text: string): string {
  const t = text.trim();
  return t.match(/\/entries\/([\w-]+)/)?.[1] ?? t;
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
  const { user } = useAuth();
  // Indicadores de todas as amostras, sem repetir (item 74).
  const iocsQuery = useQuery({
    queryKey: ['case', id, 'iocs'],
    queryFn: () => api.get<{ iocs: CaseIoc[] }>(`/cases/${id}/iocs`),
  });
  const iocs = iocsQuery.data?.iocs ?? [];
  const attack = useAttack();

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
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [comment, setComment] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);

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
      label: tr('titleRange'),
      ok: form.title.trim().length >= 3,
      api: 'title',
      value: form.title,
    },
    {
      id: 'case-assignee',
      label: tr('assignee'),
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
      return tr('caseUpdated');
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
      return res.added ? tr('entryAdded') : tr('entryAlready');
    });
  };

  const removeEntry = async (entry: { id: string; title: string }) => {
    if (!c) return;
    const ok = await confirm({
      title: tr('removeSample'),
      message: tr('removeSampleConfirm', { title: entry.title, code: c.code }),
      confirmLabel: tr('removeShort'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/cases/${c.id}/entries/${entry.id}`);
      return tr('sampleRemoved', { title: entry.title });
    });
  };

  const sendComment = async () => {
    if (!c || !comment.trim()) return;
    await run(async () => {
      // So as pessoas cujo "@Nome" continua no texto (item 89).
      const cited = mentions.filter((m) => comment.includes(`@${m.name}`)).map((m) => m.id);
      await api.post(`/cases/${c.id}/comments`, { text: comment, mentions: cited });
      setComment('');
      setMentions([]);
      return tr('commentSaved');
    });
  };

  if (query.isLoading) return <HpsmLoading text={tr('loadingCase')} />;
  if (query.isError || !c) {
    return (
      <HpsmMessage kind="error">
        {(query.error as Error | null)?.message ?? tr('caseNotFound')}
      </HpsmMessage>
    );
  }

  const reports = c.entries.flatMap((ce) =>
    ce.entry.reports.map((r) => ({ ...r, entry: ce.entry })),
  );
  const onlyOne = c.entries.length <= 1;

  return (
    <>
      <HpsmToolbar label={tr('caseActions')}>
        <HpsmToolbarButton
          label={tr('backToCases')}
          icon={IconArrowLeft}
          onClick={() => navigate('/casos')}
        />
        <HpsmToolbarButton
          label={busy ? tr('saving') : tr('save')}
          title={tr('saveHint')}
          icon={IconAdd}
          disabled={busy || !dirty}
          onClick={() => void save()}
        />
        <HpsmToolbarDivider />
        <HpsmToolbarButton
          label={tr('print')}
          icon={IconPrint}
          onClick={() => window.open(`/casos/${c.id}/imprimir?auto=1`, '_blank')}
        />
        <HpsmToolbarMenu
          label={tr('export')}
          items={[
            {
              label: tr('caseMd'),
              icon: IconDownload,
              disabled: !iocsQuery.data,
              action: () =>
                downloadText(
                  `deeplook-${c.code.toLowerCase()}.md`,
                  caseMarkdown(c, iocs, attack.data, names, user?.displayName ?? '—'),
                ),
            },
            {
              label: tr('casePackage'),
              icon: IconDownload,
              action: () => downloadUrl(`/api/cases/${c.id}/iocs/export?format=stix-case`),
            },
            {
              label: tr('importStix'),
              icon: IconAdd,
              disabled: c.status === 'CLOSED',
              action: () => setImporting(true),
            },
            // IOCs de todas as amostras, gerados na API.
            ...(
              [
                ['csv', 'CSV'],
                ['stix', 'STIX 2.1'],
                ['misp', 'MISP'],
              ] as const
            ).map(([format, name], i) => ({
              label: tr('caseIocs', { name }),
              icon: IconDownload,
              separated: i === 0,
              disabled: iocs.length === 0,
              action: () =>
                downloadUrl(`/api/cases/${c.id}/iocs/export?format=${format}&lang=${getLocale()}`),
            })),
          ]}
        />
      </HpsmToolbar>
      <PageHeader title={`${c.code} · ${c.title}`} subtitle={c.description ?? undefined} />
      {importing && (
        <CaseStixImportDialog
          caseId={c.id}
          onClose={() => setImporting(false)}
          onDone={(text) => {
            setImporting(false);
            setNotice({ ok: true, text });
            void queryClient.invalidateQueries({ queryKey: ['case', id] });
          }}
        />
      )}
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
      <div className="dl-summary">
        <span>
          <span className="dl-summary__label">{tr('sumStatus')}</span>{' '}
          <StatusText tone={CASE_STATUS[c.status].tone}>{CASE_STATUS[c.status].label}</StatusText>
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumAssignee')}</span>{' '}
          {c.assignee?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumSamples')}</span> {c.entries.length}
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumCreated')}</span> {fmtDate(c.createdAt)}
          {c.createdBy ? ` por ${c.createdBy.displayName}` : ''}
        </span>
        {c.closedAt && (
          <span>
            <span className="dl-summary__label">{tr('sumClosed')}</span> {fmtDate(c.closedAt)}
          </span>
        )}
      </div>

      <HpsmSection title={tr('caseData')}>
        <HpsmForm columns={2}>
          <HpsmField
            label={tr('title')}
            htmlFor="case-title"
            required
            wide
            invalid={check.isInvalid('case-title')}
          >
            <TextInput
              id="case-title"
              labelText={tr('title')}
              hideLabel
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </HpsmField>
          <HpsmField label={tr('status')} htmlFor="case-status">
            <Select
              id="case-status"
              labelText={tr('status')}
              hideLabel
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <SelectItem value="OPEN" text={tr('stOpen')} />
              <SelectItem value="IN_PROGRESS" text={tr('stInProgress')} />
              <SelectItem value="CLOSED" text={tr('stClosed')} />
            </Select>
          </HpsmField>
          <HpsmField
            label={tr('assignee')}
            htmlFor="case-assignee"
            invalid={check.isInvalid('case-assignee')}
          >
            <Select
              id="case-assignee"
              labelText={tr('assignee')}
              hideLabel
              value={form.assigneeId}
              onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
            >
              <SelectItem value="" text={tr('noAssigneeOption')} />
              {analysts.map((a) => (
                <SelectItem key={a.id} value={a.id} text={a.displayName} />
              ))}
            </Select>
          </HpsmField>
          <HpsmField label={tr('description')} htmlFor="case-description" wide top>
            <TextArea
              id="case-description"
              labelText={tr('description')}
              hideLabel
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      <HpsmSection title={tr('samplesN', { n: c.entries.length })}>
        <TableContainer>
          <Table size="xs" aria-label={tr('caseSamplesAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{tr('sample')}</TableHeader>
                <TableHeader scope="col">{tr('type')}</TableHeader>
                <TableHeader scope="col">{tr('status')}</TableHeader>
                <TableHeader scope="col">{tr('priority')}</TableHeader>
                <TableHeader scope="col">{tr('verdict')}</TableHeader>
                <TableHeader scope="col">{tr('added')}</TableHeader>
                <TableHeader scope="col">{tr('actions')}</TableHeader>
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
                      title={onlyOne ? tr('needsOne') : undefined}
                      onClick={() => void removeEntry(entry)}
                    >
                      {tr('removeEllipsis')}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <div className="dl-case-form">
          <HpsmForm>
            <HpsmField label={tr('addSample')} htmlFor="case-add-entry" wide>
              <div className="dl-case-add">
                <TextInput
                  id="case-add-entry"
                  labelText={tr('addSample')}
                  hideLabel
                  size="sm"
                  placeholder={tr('addSamplePlaceholder')}
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
                  {tr('add')}
                </Button>
              </div>
            </HpsmField>
          </HpsmForm>
        </div>
      </HpsmSection>

      <HpsmSection title={tr('reportsN', { n: reports.length })}>
        {reports.length === 0 ? (
          <p className="dl-static-empty">{tr('noReports')}</p>
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

      <HpsmSection title={tr('iocsN', { n: iocs.length })}>
        {iocsQuery.isLoading ? (
          <HpsmLoading text={tr('gatheringIocs')} />
        ) : iocs.length === 0 ? (
          <p className="dl-static-empty">{tr('noIocs')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={tr('caseIocsAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{tr('type')}</TableHeader>
                  <TableHeader scope="col">{tr('indicator')}</TableHeader>
                  <TableHeader scope="col">{tr('source')}</TableHeader>
                  <TableHeader scope="col">{tr('samples')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {iocs.map((ioc) => (
                  <TableRow key={`${ioc.kind}:${ioc.value}`}>
                    <TableCell>{IOC_KIND_LABELS[ioc.kind]}</TableCell>
                    <TableCell className="dl-mono">
                      <Link className="dl-link" to={iocHref(ioc.kind, ioc.value)}>
                        {ioc.value}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {ioc.source === 'REPORT' ? tr('publishedReport') : tr('sampleItself')}
                    </TableCell>
                    <TableCell>
                      {ioc.entries.map((e, i) => (
                        <span key={e.id}>
                          {i > 0 && ', '}
                          <Link className="dl-link" to={`/entries/${e.id}`}>
                            {e.title}
                          </Link>
                        </span>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>

      {/* Mapa de relacoes (item 91): amostras do caso e indicadores em comum. */}
      <HpsmSection title={tr('relationMap')}>
        <RelationMap source="case" id={c.id} />
      </HpsmSection>

      <HpsmSection title={tr('timeline')}>
        <ol className="dl-case-timeline">
          {c.events.map((e) => (
            <li key={e.id}>
              <span className="dl-case-timeline__when">{fmtDate(e.createdAt)}</span>{' '}
              <strong>{e.actor?.displayName ?? tr('someone')}</strong> {caseEventText(e, names)}
              {e.type === 'COMMENT' && e.detail && (
                <p className="dl-case-timeline__comment">{renderMentions(e.detail, e.toValue)}</p>
              )}
            </li>
          ))}
        </ol>
        <div className="dl-case-form">
          <HpsmForm>
            <HpsmField
              label={tr('newComment')}
              htmlFor="case-comment"
              wide
              top
              help={tr('commentHelp')}
            >
              <div className="dl-case-comment">
                <MentionTextArea
                  id="case-comment"
                  labelText={tr('newComment')}
                  hideLabel
                  rows={3}
                  value={comment}
                  onChange={setComment}
                  analystsOnly
                  onMention={(m) =>
                    setMentions((current) =>
                      current.some((x) => x.id === m.id) ? current : [...current, m],
                    )
                  }
                />
                <Button
                  kind="tertiary"
                  size="sm"
                  disabled={busy || !comment.trim()}
                  onClick={() => void sendComment()}
                >
                  {tr('comment')}
                </Button>
              </div>
            </HpsmField>
          </HpsmForm>
        </div>
      </HpsmSection>
    </>
  );
}
