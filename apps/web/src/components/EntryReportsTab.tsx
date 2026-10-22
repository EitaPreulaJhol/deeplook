import { Checkbox, Select, SelectItem, TextArea } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryIoc, Report, ReportTemplate, Verdict } from '../api/types';
import { useConfirm } from './HpsmConfirm';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { IOC_KIND_LABELS, iocHref } from './iocs';
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
}

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
}: Props) {
  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [iocs, setIocs] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('SUSPICIOUS');
  const [published, setPublished] = useState(true);
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
  useUnsavedChanges(Boolean(summary || findings || iocs));

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
        published,
      });
      setSummary('');
      setFindings('');
      setIocs('');
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

  // Ctrl+S salva o novo relatorio (so quem pode criar relatorios).
  useSaveShortcut(createReport, canTriage && !saving);

  return (
    <>
      {reports.length === 0 && (
        <HpsmMessage kind="info">Nenhum relatório publicado ainda.</HpsmMessage>
      )}
      {reports.map((r) => (
        <HpsmSection key={r.id} title={`${r.analyst.displayName} — ${fmtDate(r.createdAt)}`}>
          <HpsmForm columns={2}>
            <HpsmField label="Veredito">
              <HpsmReadonly>
                <VerdictTag verdict={r.verdict} />
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label="Situação">
              <HpsmReadonly>
                {r.published ? (
                  <StatusText tone="green">Publicado</StatusText>
                ) : (
                  <StatusText tone="gray">Rascunho</StatusText>
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
          </HpsmForm>
        </HpsmSection>
      ))}

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
                  {suggestedIocs.length > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => {
                          const present = new Set(iocs.split(/\r?\n/).map((l) => l.trim()));
                          const extra = suggestedIocs.filter((v) => !present.has(v));
                          if (extra.length)
                            setIocs((iocs.trim() ? `${iocs.trim()}\n` : '') + extra.join('\n'));
                        }}
                      >
                        Inserir IOCs sugeridos ({suggestedIocs.length})
                      </button>
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
            <HpsmField label="Publicar">
              <Checkbox
                id="report-published"
                labelText="Define o status e o veredito da amostra"
                checked={published}
                onChange={(_, { checked }) => setPublished(checked)}
              />
            </HpsmField>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
