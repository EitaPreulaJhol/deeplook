import { Select, SelectItem, TextArea } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryIoc, Report, ReportStatus, ReportTemplate, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/entry';
import { AttackPicker, AttackTechniqueLinks } from './attack';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { KbLinks, KbPicker, type KbRef } from './KbPicker';
import { HpsmMessage } from './messages';
import { ReportEditForm } from './ReportEditForm';
import { ReportEvidence } from './ReportEvidence';
import { ReportVersions } from './ReportVersions';
import { useSaveShortcut } from './shortcuts';
import { StatusText, VerdictTag } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

interface Props {
  entryId: string;
  reports: Report[];
  canTriage: boolean;
  /** Chamado apos publicar um relatorio (o pai recarrega a amostra). */
  onCreated: () => void;
  /** IOCs encontrados pela analise estatica (botao "Inserir IOCs sugeridos"). */
  suggestedIocs?: string[];
  /** Tecnicas ATT&CK das regras do capa (item 7.2; botao "Inserir tecnicas sugeridas"). */
  suggestedAttack?: string[];
  /** Servidor exige revisao (quatro olhos): nao ha "Publicar" direto. */
  reviewRequired?: boolean;
}

const STATUS_TEXT: Record<ReportStatus, { tone: 'gray' | 'orange' | 'green'; label: string }> = {
  DRAFT: {
    tone: 'gray',
    get label() {
      return tr('rsDraft');
    },
  },
  IN_REVIEW: {
    tone: 'orange',
    get label() {
      return tr('rsInReview');
    },
  },
  PUBLISHED: {
    tone: 'green',
    get label() {
      return tr('rsPublished');
    },
  },
};

/**
 * Aba "Relatorios": lista os relatorios da amostra e, para analistas/admin,
 * o formulario de novo relatorio. A captura de tela da VM fica na janela do
 * console (toolbar de controle da VM).
 */
export function EntryReportsTab({
  entryId,
  reports,
  canTriage,
  onCreated,
  suggestedIocs = [],
  suggestedAttack = [],
  reviewRequired = false,
}: Props) {
  const { user } = useAuth();
  const prompt = usePrompt();
  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [iocs, setIocs] = useState('');
  const [attack, setAttack] = useState<string[]>([]);
  const [kb, setKb] = useState<KbRef[]>([]);
  const [verdict, setVerdict] = useState<Verdict>('SUSPICIOUS');
  // "Ao salvar": rascunho, enviar para revisao ou publicar (sem revisao obrigatoria).
  const [saveAs, setSaveAs] = useState<ReportStatus>(reviewRequired ? 'IN_REVIEW' : 'PUBLISHED');
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Item 75: relatorio em edicao e paineis de Versoes abertos.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const toggleVersions = (id: string) =>
    setVersionsOpen((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Acoes da revisao num relatorio (enviar, publicar, aprovar, devolver).
  const reportAction = async (
    report: Report,
    action: 'submit' | 'publish' | 'approve' | 'return',
  ) => {
    setActionMsg(null);
    let note: string | null = null;
    if (action === 'return') {
      note = await prompt({
        title: tr('returnReport'),
        message: tr('returnReportMsg', { name: report.analyst.displayName }),
        label: tr('comment'),
        maxLength: 2000,
        confirmLabel: tr('return'),
      });
      if (!note) return;
    }
    setBusyId(report.id);
    try {
      if (action === 'publish') await api.patch(`/reports/${report.id}`, { status: 'PUBLISHED' });
      else await api.post(`/reports/${report.id}/${action}`, note ? { note } : {});
      const done = {
        submit: tr('sentForReview'),
        publish: tr('reportPublished'),
        approve: tr('reportApproved'),
        return: tr('reportReturned'),
      }[action];
      setActionMsg({ ok: true, text: done });
      onCreated();
    } catch (err) {
      setActionMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  };
  const [templateId, setTemplateId] = useState('');
  const confirm = useConfirm();
  const templatesQuery = useQuery({
    queryKey: ['report-templates'],
    queryFn: () => api.get<{ templates: ReportTemplate[] }>('/report-templates'),
    enabled: canTriage,
    staleTime: 60_000,
  });
  const templates = templatesQuery.data?.templates ?? [];

  // Aplica o modelo (Resumo, Achados, IOCs e veredito); pergunta antes de
  // sobrescrever texto ja digitado.
  const applyTemplate = async (id: string) => {
    const template = templates.find((t) => t.id === id);
    if (!template) {
      setTemplateId('');
      return;
    }
    if (summary.trim() || findings.trim() || iocs.trim()) {
      const ok = await confirm({
        title: tr('applyTemplate'),
        message: tr('applyTemplateMsg', { name: template.name }),
        confirmLabel: tr('replace'),
        cancelLabel: tr('keepText'),
      });
      if (!ok) return;
    }
    setTemplateId(id);
    setSummary(template.summary);
    setFindings(template.findings ?? '');
    setIocs(template.iocs ?? '');
    setVerdict(template.verdict);
  };
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Rascunho do relatorio: sair da aba/tela pede confirmacao.
  useUnsavedChanges(Boolean(summary || findings || iocs || attack.length || kb.length));

  const reportCheck = useRequiredFields([
    {
      id: 'report-summary',
      label: tr('summary'),
      ok: summary.trim().length >= 3,
      api: 'summary',
      value: summary,
    },
    { id: 'report-findings', label: tr('findings'), ok: true, api: 'findings', value: findings },
    { id: 'report-iocs', label: 'IOCs', ok: true, api: 'iocs', value: iocs },
    {
      id: 'report-attack',
      label: tr('attackTechniques'),
      ok: true,
      api: 'attackTechniques',
      value: attack.join(','),
    },
    {
      id: 'report-kb',
      label: tr('kbArticles'),
      ok: true,
      api: 'kbArticleIds',
      value: kb.map((a) => a.id).join(','),
    },
  ]);

  const createReport = async () => {
    setError(null);
    if (!reportCheck.check()) return;
    setSaving(true);
    try {
      await api.post(`/entries/${entryId}/reports`, {
        summary,
        findings,
        iocs,
        verdict,
        status: saveAs,
        attackTechniques: attack,
        kbArticleIds: kb.map((a) => a.id),
      });
      setSummary('');
      setFindings('');
      setIocs('');
      setAttack([]);
      setKb([]);
      setTemplateId('');
      reportCheck.reset();
      onCreated();
    } catch (err) {
      if (!reportCheck.fromApi(err)) setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Indicadores reconhecidos (relatorios publicados + a propria amostra).
  const iocsQuery = useQuery({
    queryKey: ['entry', entryId, 'iocs'],
    queryFn: () => api.get<{ iocs: EntryIoc[] }>(`/entries/${entryId}/iocs`),
  });
  const recognized = iocsQuery.data?.iocs ?? [];

  // Lista de permissoes (item 69): indicadores legitimos somem das sugestoes.
  const allowedQuery = useQuery({
    queryKey: ['allowlist-filter', suggestedIocs],
    queryFn: () =>
      api.post<{ allowed: string[] }>('/allowlist/filter', { values: suggestedIocs.slice(0, 500) }),
    enabled: canTriage && suggestedIocs.length > 0,
    staleTime: 30_000,
  });
  const allowedSet = new Set(allowedQuery.data?.allowed ?? []);
  const suggestions = suggestedIocs.filter((v) => !allowedSet.has(v));
  const hiddenSuggestions = suggestedIocs.length - suggestions.length;

  // Ctrl+S salva o novo relatorio (so quem pode criar relatorios); editando,
  // o Ctrl+S e da edicao.
  useSaveShortcut(createReport, canTriage && !saving && editingId === null);

  return (
    <>
      {reports.length === 0 && <HpsmMessage kind="info">{tr('noReports')}</HpsmMessage>}
      {actionMsg && (
        <HpsmMessage key={actionMsg.text} kind={actionMsg.ok ? 'success' : 'error'}>
          {actionMsg.text}
        </HpsmMessage>
      )}
      {reports.map((r) => {
        const mine = r.analystId === user?.id;
        const canEdit = mine || user?.role === 'ADMIN';
        const busy = busyId === r.id;
        // Edita o conteudo: autor ou admin, fora de revisao; com revisao
        // obrigatoria, publicado nao muda (a API recusa).
        const canEditContent =
          canTriage &&
          canEdit &&
          r.status !== 'IN_REVIEW' &&
          !(reviewRequired && r.status === 'PUBLISHED');
        const revisions = r._count?.revisions ?? 0;
        if (editingId === r.id) {
          return (
            <HpsmSection
              key={r.id}
              title={tr('editingTitle', {
                name: r.analyst.displayName,
                date: fmtDate(r.createdAt),
              })}
            >
              <ReportEditForm
                report={r}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  setActionMsg({
                    ok: true,
                    text: tr('reportUpdated'),
                  });
                  void queryClient.invalidateQueries({ queryKey: ['report', r.id, 'versions'] });
                  onCreated();
                }}
              />
            </HpsmSection>
          );
        }
        return (
          <HpsmSection key={r.id} title={`${r.analyst.displayName} — ${fmtDate(r.createdAt)}`}>
            {canTriage && (r.status !== 'PUBLISHED' || canEditContent || revisions > 0) && (
              <HpsmToolbar label={tr('reportActions')}>
                {canEditContent && (
                  <HpsmToolbarButton
                    label={tr('edit')}
                    disabled={busy || editingId !== null}
                    onClick={() => {
                      setActionMsg(null);
                      setEditingId(r.id);
                    }}
                  />
                )}
                {revisions > 0 && (
                  <HpsmToolbarButton
                    label={`${versionsOpen.has(r.id) ? tr('hideVersions') : tr('versions')} (${revisions + 1})`}
                    onClick={() => toggleVersions(r.id)}
                  />
                )}
                {r.status === 'DRAFT' && canEdit && (
                  <>
                    <HpsmToolbarButton
                      label={tr('sendForReview')}
                      disabled={busy}
                      onClick={() => void reportAction(r, 'submit')}
                    />
                    {!reviewRequired && (
                      <HpsmToolbarButton
                        label={tr('publish')}
                        disabled={busy}
                        onClick={() => void reportAction(r, 'publish')}
                      />
                    )}
                  </>
                )}
                {r.status === 'IN_REVIEW' && !mine && (
                  <>
                    <HpsmToolbarButton
                      label={tr('approvePublish')}
                      disabled={busy}
                      onClick={() => void reportAction(r, 'approve')}
                    />
                    <HpsmToolbarButton
                      label={tr('returnEllipsis')}
                      disabled={busy}
                      onClick={() => void reportAction(r, 'return')}
                    />
                  </>
                )}
                {r.status === 'IN_REVIEW' && mine && (
                  <span className="hpsm-toolbar__info">{tr('awaitingReview')}</span>
                )}
              </HpsmToolbar>
            )}
            {r.status === 'DRAFT' && r.reviewNote && (
              <div className="dl-review-note" role="note">
                <strong>
                  {tr('returnedBy', { name: r.reviewedBy?.displayName ?? tr('aReviewer') })}
                </strong>{' '}
                {tr('returnedOn', { date: fmtDate(r.reviewedAt), note: r.reviewNote })}
              </div>
            )}
            <HpsmForm columns={2}>
              <HpsmField label={tr('colVerdict')}>
                <HpsmReadonly>
                  <VerdictTag verdict={r.verdict} />
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('reportState')}>
                <HpsmReadonly>
                  <StatusText tone={STATUS_TEXT[r.status].tone}>
                    {STATUS_TEXT[r.status].label}
                  </StatusText>
                  {r.status === 'PUBLISHED' && r.reviewedBy && (
                    <span className="dl-review-by">
                      {' '}
                      {tr('reviewedBy', {
                        name: r.reviewedBy.displayName,
                        date: fmtDate(r.reviewedAt),
                      })}
                    </span>
                  )}
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('summary')} wide top>
                <HpsmReadonly multiline>{r.summary}</HpsmReadonly>
              </HpsmField>
              {r.findings && (
                <HpsmField label={tr('findings')} wide top>
                  <HpsmReadonly multiline>{r.findings}</HpsmReadonly>
                </HpsmField>
              )}
              {r.iocs && (
                <HpsmField label="IOCs" wide top>
                  <HpsmReadonly multiline mono copyable={{ value: r.iocs, label: 'IOCs' }}>
                    {r.iocs}
                  </HpsmReadonly>
                </HpsmField>
              )}
              {(r.attackTechniques?.length ?? 0) > 0 && (
                <HpsmField label="ATT&CK" wide top>
                  <HpsmReadonly>
                    <AttackTechniqueLinks ids={r.attackTechniques ?? []} />
                  </HpsmReadonly>
                </HpsmField>
              )}
              {(r.kbArticles?.length ?? 0) > 0 && (
                <HpsmField label={tr('kb')} wide top>
                  <HpsmReadonly>
                    <KbLinks articles={r.kbArticles ?? []} />
                  </HpsmReadonly>
                </HpsmField>
              )}
              <ReportEvidence
                reportId={r.id}
                items={r.evidence ?? []}
                canEdit={canEditContent}
                onChanged={onCreated}
              />
            </HpsmForm>
            {canTriage && revisions > 0 && versionsOpen.has(r.id) && (
              <ReportVersions reportId={r.id} />
            )}
          </HpsmSection>
        );
      })}

      {recognized.length > 0 && (
        <HpsmSection title={tr('recognizedIocs', { n: recognized.length })} className="dl-mt-lg">
          <p className="dl-related-hint">{tr('recognizedHelp')}</p>
          <ul className="dl-ioc-list">
            {recognized.map((ioc) => (
              <li key={`${ioc.kind}:${ioc.value}`}>
                <span className="dl-ioc-list__kind">{IOC_KIND_LABELS[ioc.kind]}</span>
                <Link className="dl-link dl-mono" to={iocHref(ioc.kind, ioc.value)}>
                  {ioc.value}
                </Link>
                <span className="dl-ioc-list__source">
                  {ioc.source === 'REPORT' ? tr('srcReport') : tr('srcSample')}
                </span>
              </li>
            ))}
          </ul>
        </HpsmSection>
      )}

      {canTriage && (
        <HpsmSection title={tr('newReport')} className="dl-mt-lg">
          <HpsmToolbar label={tr('reportActions')}>
            <HpsmToolbarButton
              label={saving ? 'Salvando...' : tr('saveReport')}
              title={tr('saveHint')}
              icon={IconAdd}
              disabled={saving}
              onClick={createReport}
            />
          </HpsmToolbar>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          {reportCheck.message && <HpsmMessage kind="error">{reportCheck.message}</HpsmMessage>}
          <HpsmForm>
            {templates.length > 0 && (
              <HpsmField label={tr('template')} htmlFor="report-template" help={tr('templateHelp')}>
                <Select
                  id="report-template"
                  labelText={tr('template')}
                  hideLabel
                  value={templateId}
                  onChange={(e) => void applyTemplate(e.target.value)}
                >
                  <SelectItem value="" text={tr('noTemplate')} />
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} text={t.name} />
                  ))}
                </Select>
              </HpsmField>
            )}
            <HpsmField
              label={tr('summary')}
              htmlFor="report-summary"
              required
              top
              invalid={reportCheck.isInvalid('report-summary')}
            >
              <TextArea
                id="report-summary"
                labelText={tr('summary')}
                hideLabel
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
              />
            </HpsmField>
            <HpsmField
              label={tr('findings')}
              htmlFor="report-findings"
              top
              invalid={reportCheck.isInvalid('report-findings')}
            >
              <TextArea
                id="report-findings"
                labelText={tr('findings')}
                hideLabel
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                rows={5}
              />
            </HpsmField>
            <HpsmField
              label="IOCs"
              htmlFor="report-iocs"
              top
              help={
                <>
                  {tr('iocsHelp')}
                  {suggestions.length > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => {
                          const present = new Set(iocs.split(/\r?\n/).map((l) => l.trim()));
                          const extra = suggestions.filter((v) => !present.has(v));
                          if (extra.length)
                            setIocs((iocs.trim() ? `${iocs.trim()}\n` : '') + extra.join('\n'));
                        }}
                      >
                        {tr('insertIocs', { n: suggestions.length })}
                      </button>
                      {hiddenSuggestions > 0 && (
                        <span className="dl-hint-muted">
                          {' '}
                          {hiddenSuggestions > 1
                            ? tr('hiddenAllowedMany', { n: hiddenSuggestions })
                            : tr('hiddenAllowedOne')}
                        </span>
                      )}
                    </>
                  )}
                </>
              }
              invalid={reportCheck.isInvalid('report-iocs')}
            >
              <TextArea
                id="report-iocs"
                labelText="IOCs"
                hideLabel
                value={iocs}
                onChange={(e) => setIocs(e.target.value)}
                rows={3}
              />
            </HpsmField>
            <HpsmField
              label={tr('attackTechniques')}
              htmlFor="report-attack"
              top
              invalid={reportCheck.isInvalid('report-attack')}
              help={
                <>
                  {tr('attackHelp')}
                  {suggestedAttack.length > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => setAttack([...new Set([...attack, ...suggestedAttack])])}
                      >
                        {tr('insertAttack', { n: suggestedAttack.length })}
                      </button>
                    </>
                  )}
                </>
              }
            >
              <AttackPicker id="report-attack" value={attack} onChange={setAttack} />
            </HpsmField>
            <HpsmField
              label={tr('kbArticles')}
              htmlFor="report-kb"
              top
              invalid={reportCheck.isInvalid('report-kb')}
              help={tr('kbHelp')}
            >
              <KbPicker id="report-kb" value={kb} onChange={setKb} />
            </HpsmField>
            <HpsmField label={tr('colVerdict')} htmlFor="report-verdict">
              <Select
                id="report-verdict"
                labelText={tr('colVerdict')}
                hideLabel
                value={verdict}
                onChange={(e) => setVerdict(e.target.value as Verdict)}
              >
                <SelectItem value="UNKNOWN" text={tr('vUnknown')} />
                <SelectItem value="CLEAN" text={tr('vClean')} />
                <SelectItem value="SUSPICIOUS" text={tr('vSuspicious')} />
                <SelectItem value="MALICIOUS" text={tr('vMalicious')} />
              </Select>
            </HpsmField>
            <HpsmField
              label={tr('onSave')}
              htmlFor="report-save-as"
              help={reviewRequired ? tr('reviewRequiredHelp') : tr('publishHelp')}
            >
              <Select
                id="report-save-as"
                labelText={tr('onSave')}
                hideLabel
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value as ReportStatus)}
              >
                {!reviewRequired && <SelectItem value="PUBLISHED" text={tr('publish')} />}
                <SelectItem value="IN_REVIEW" text={tr('sendForReview')} />
                <SelectItem value="DRAFT" text={tr('saveDraft')} />
              </Select>
            </HpsmField>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
