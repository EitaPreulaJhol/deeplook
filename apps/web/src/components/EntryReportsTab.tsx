import { Select, SelectItem, TextArea } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryIoc, Report, ReportStatus, ReportTemplate, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AttackPicker, AttackTechniqueLinks } from './attack';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { KbLinks, KbPicker, type KbRef } from './KbPicker';
import { HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { StatusText, VerdictTag } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

interface Props {
  entryId: string;
  reports: Report[];
  canTriage: boolean;
  /** Chamado apos publicar um relatorio (o pai recarrega a amostra). */
  onCreated: () => void;
  /** IOCs encontrados pela analise estatica (botao "Inserir IOCs sugeridos"). */
  suggestedIocs?: string[];
  /** Servidor exige revisao (quatro olhos): nao ha "Publicar" direto. */
  reviewRequired?: boolean;
}

const STATUS_TEXT: Record<ReportStatus, { tone: 'gray' | 'orange' | 'green'; label: string }> = {
  DRAFT: { tone: 'gray', label: 'Rascunho' },
  IN_REVIEW: { tone: 'orange', label: 'Em revisão' },
  PUBLISHED: { tone: 'green', label: 'Publicado' },
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

  // Acoes da revisao num relatorio (enviar, publicar, aprovar, devolver).
  const reportAction = async (
    report: Report,
    action: 'submit' | 'publish' | 'approve' | 'return',
  ) => {
    setActionMsg(null);
    let note: string | null = null;
    if (action === 'return') {
      note = await prompt({
        title: 'Devolver relatório',
        message: `O relatório de ${report.analyst.displayName} volta a rascunho com o seu comentário.`,
        label: 'Comentário',
        maxLength: 2000,
        confirmLabel: 'Devolver',
      });
      if (!note) return;
    }
    setBusyId(report.id);
    try {
      if (action === 'publish') await api.patch(`/reports/${report.id}`, { status: 'PUBLISHED' });
      else await api.post(`/reports/${report.id}/${action}`, note ? { note } : {});
      const done = {
        submit: 'Relatório enviado para revisão.',
        publish: 'Relatório publicado.',
        approve: 'Relatório aprovado e publicado.',
        return: 'Relatório devolvido ao autor.',
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
        title: 'Aplicar modelo',
        message: `Substituir o texto já digitado pelo modelo "${template.name}"?`,
        confirmLabel: 'Substituir',
        cancelLabel: 'Manter o texto',
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
      label: 'Resumo',
      ok: summary.trim().length >= 3,
      api: 'summary',
      value: summary,
    },
    { id: 'report-findings', label: 'Achados', ok: true, api: 'findings', value: findings },
    { id: 'report-iocs', label: 'IOCs', ok: true, api: 'iocs', value: iocs },
    {
      id: 'report-attack',
      label: 'Técnicas ATT&CK',
      ok: true,
      api: 'attackTechniques',
      value: attack.join(','),
    },
    {
      id: 'report-kb',
      label: 'Artigos da base',
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

  // Ctrl+S salva o novo relatorio (so quem pode criar relatorios).
  useSaveShortcut(createReport, canTriage && !saving);

  return (
    <>
      {reports.length === 0 && (
        <HpsmMessage kind="info">Nenhum relatório publicado ainda.</HpsmMessage>
      )}
      {actionMsg && (
        <HpsmMessage key={actionMsg.text} kind={actionMsg.ok ? 'success' : 'error'}>
          {actionMsg.text}
        </HpsmMessage>
      )}
      {reports.map((r) => {
        const mine = r.analystId === user?.id;
        const canEdit = mine || user?.role === 'ADMIN';
        const busy = busyId === r.id;
        return (
          <HpsmSection key={r.id} title={`${r.analyst.displayName} — ${fmtDate(r.createdAt)}`}>
            {canTriage && r.status !== 'PUBLISHED' && (
              <HpsmToolbar label="Ações do relatório">
                {r.status === 'DRAFT' && canEdit && (
                  <>
                    <HpsmToolbarButton
                      label="Enviar para revisão"
                      disabled={busy}
                      onClick={() => void reportAction(r, 'submit')}
                    />
                    {!reviewRequired && (
                      <HpsmToolbarButton
                        label="Publicar"
                        disabled={busy}
                        onClick={() => void reportAction(r, 'publish')}
                      />
                    )}
                  </>
                )}
                {r.status === 'IN_REVIEW' && !mine && (
                  <>
                    <HpsmToolbarButton
                      label="Aprovar e publicar"
                      disabled={busy}
                      onClick={() => void reportAction(r, 'approve')}
                    />
                    <HpsmToolbarButton
                      label="Devolver…"
                      disabled={busy}
                      onClick={() => void reportAction(r, 'return')}
                    />
                  </>
                )}
                {r.status === 'IN_REVIEW' && mine && (
                  <span className="hpsm-toolbar__info">
                    Aguardando a revisão de outro analista.
                  </span>
                )}
              </HpsmToolbar>
            )}
            {r.status === 'DRAFT' && r.reviewNote && (
              <div className="dl-review-note" role="note">
                <strong>Devolvido por {r.reviewedBy?.displayName ?? 'um revisor'}</strong> em{' '}
                {fmtDate(r.reviewedAt)}: {r.reviewNote}
              </div>
            )}
            <HpsmForm columns={2}>
              <HpsmField label="Veredito">
                <HpsmReadonly>
                  <VerdictTag verdict={r.verdict} />
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label="Situação">
                <HpsmReadonly>
                  <StatusText tone={STATUS_TEXT[r.status].tone}>
                    {STATUS_TEXT[r.status].label}
                  </StatusText>
                  {r.status === 'PUBLISHED' && r.reviewedBy && (
                    <span className="dl-review-by">
                      {' '}
                      · revisado por {r.reviewedBy.displayName} em {fmtDate(r.reviewedAt)}
                    </span>
                  )}
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label="Resumo" wide top>
                <HpsmReadonly multiline>{r.summary}</HpsmReadonly>
              </HpsmField>
              {r.findings && (
                <HpsmField label="Achados" wide top>
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
                <HpsmField label="Base de conhecimento" wide top>
                  <HpsmReadonly>
                    <KbLinks articles={r.kbArticles ?? []} />
                  </HpsmReadonly>
                </HpsmField>
              )}
            </HpsmForm>
          </HpsmSection>
        );
      })}

      {recognized.length > 0 && (
        <HpsmSection title={`Indicadores reconhecidos (${recognized.length})`} className="dl-mt-lg">
          <p className="dl-related-hint">
            IOCs dos relatórios publicados e da própria amostra. Clique para ver em que outras
            amostras o indicador aparece; para exportar, use Mais ▾ &gt; Exportar IOCs.
          </p>
          <ul className="dl-ioc-list">
            {recognized.map((ioc) => (
              <li key={`${ioc.kind}:${ioc.value}`}>
                <span className="dl-ioc-list__kind">{IOC_KIND_LABELS[ioc.kind]}</span>
                {ioc.kind === 'URL' ? (
                  <span className="dl-mono">{ioc.value}</span>
                ) : (
                  <Link className="dl-link dl-mono" to={iocHref(ioc.kind, ioc.value)}>
                    {ioc.value}
                  </Link>
                )}
                <span className="dl-ioc-list__source">
                  {ioc.source === 'REPORT' ? 'relatório' : 'amostra'}
                </span>
              </li>
            ))}
          </ul>
        </HpsmSection>
      )}

      {canTriage && (
        <HpsmSection title="Novo relatório de análise" className="dl-mt-lg">
          <HpsmToolbar label="Ações do relatório">
            <HpsmToolbarButton
              label={saving ? 'Salvando...' : 'Salvar relatório'}
              title="Salvar (Ctrl+S)"
              icon={IconAdd}
              disabled={saving}
              onClick={createReport}
            />
          </HpsmToolbar>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          {reportCheck.message && <HpsmMessage kind="error">{reportCheck.message}</HpsmMessage>}
          <HpsmForm>
            {templates.length > 0 && (
              <HpsmField
                label="Modelo"
                htmlFor="report-template"
                help="Preenche Resumo, Achados, IOCs e veredito; depois é só ajustar."
              >
                <Select
                  id="report-template"
                  labelText="Modelo"
                  hideLabel
                  value={templateId}
                  onChange={(e) => void applyTemplate(e.target.value)}
                >
                  <SelectItem value="" text="— Sem modelo —" />
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} text={t.name} />
                  ))}
                </Select>
              </HpsmField>
            )}
            <HpsmField
              label="Resumo"
              htmlFor="report-summary"
              required
              top
              invalid={reportCheck.isInvalid('report-summary')}
            >
              <TextArea
                id="report-summary"
                labelText="Resumo"
                hideLabel
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
              />
            </HpsmField>
            <HpsmField
              label="Achados"
              htmlFor="report-findings"
              top
              invalid={reportCheck.isInvalid('report-findings')}
            >
              <TextArea
                id="report-findings"
                labelText="Achados"
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
                  Indicadores de comprometimento: domínios, IPs, hashes e e-mails (hxxp e [.] são
                  aceitos). Entram na aba Relacionadas quando o relatório é publicado.
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
                        Inserir IOCs sugeridos ({suggestions.length})
                      </button>
                      {hiddenSuggestions > 0 && (
                        <span className="dl-hint-muted">
                          {' '}
                          ({hiddenSuggestions} permitido{hiddenSuggestions > 1 ? 's' : ''} oculto
                          {hiddenSuggestions > 1 ? 's' : ''})
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
              label="Técnicas ATT&CK"
              htmlFor="report-attack"
              top
              invalid={reportCheck.isInvalid('report-attack')}
              help="MITRE ATT&CK: busque pelo código ou pelo nome. Viram filtro nas listas e entram no Painel."
            >
              <AttackPicker id="report-attack" value={attack} onChange={setAttack} />
            </HpsmField>
            <HpsmField
              label="Artigos da base"
              htmlFor="report-kb"
              top
              invalid={reportCheck.isInvalid('report-kb')}
              help="Artigos da base de conhecimento sobre a família ou o golpe; o artigo passa a listar este relatório."
            >
              <KbPicker id="report-kb" value={kb} onChange={setKb} />
            </HpsmField>
            <HpsmField label="Veredito" htmlFor="report-verdict">
              <Select
                id="report-verdict"
                labelText="Veredito"
                hideLabel
                value={verdict}
                onChange={(e) => setVerdict(e.target.value as Verdict)}
              >
                <SelectItem value="UNKNOWN" text="Desconhecido" />
                <SelectItem value="CLEAN" text="Limpo" />
                <SelectItem value="SUSPICIOUS" text="Suspeito" />
                <SelectItem value="MALICIOUS" text="Malicioso" />
              </Select>
            </HpsmField>
            <HpsmField
              label="Ao salvar"
              htmlFor="report-save-as"
              help={
                reviewRequired
                  ? 'Este servidor exige revisão: outro analista aprova antes de publicar.'
                  : 'Publicar define o status e o veredito da amostra.'
              }
            >
              <Select
                id="report-save-as"
                labelText="Ao salvar"
                hideLabel
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value as ReportStatus)}
              >
                {!reviewRequired && <SelectItem value="PUBLISHED" text="Publicar" />}
                <SelectItem value="IN_REVIEW" text="Enviar para revisão" />
                <SelectItem value="DRAFT" text="Salvar como rascunho" />
              </Select>
            </HpsmField>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
