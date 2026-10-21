import { Checkbox, Select, SelectItem, TextArea } from '@carbon/react';
import { useState } from 'react';

import { api } from '../api/client';
import type { Report, Verdict } from '../api/types';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { HpsmMessage } from './messages';
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
}

/**
 * Aba "Relatorios": lista os relatorios da amostra e, para analistas/admin,
 * o formulario de novo relatorio. A captura de tela da VM fica na janela do
 * console (toolbar de controle da VM).
 */
export function EntryReportsTab({ entryId, reports, canTriage, onCreated }: Props) {
  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [iocs, setIocs] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('SUSPICIOUS');
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Rascunho do relatorio: sair da aba/tela pede confirmacao.
  useUnsavedChanges(Boolean(summary || findings || iocs));

  const createReport = async () => {
    setError(null);
    if (summary.trim().length < 3) {
      setError('Descreva um resumo do relatório.');
      return;
    }
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
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
                <HpsmReadonly multiline mono>
                  {r.iocs}
                </HpsmReadonly>
              </HpsmField>
            )}
          </HpsmForm>
        </HpsmSection>
      ))}

      {canTriage && (
        <HpsmSection title="Novo relatório de análise" className="dl-mt-lg">
          <HpsmToolbar label="Ações do relatório">
            <HpsmToolbarButton
              label={saving ? 'Salvando...' : 'Salvar relatório'}
              icon={IconAdd}
              disabled={saving}
              onClick={createReport}
            />
          </HpsmToolbar>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          <HpsmForm>
            <HpsmField label="Resumo" htmlFor="report-summary" required top>
              <TextArea
                id="report-summary"
                labelText="Resumo"
                hideLabel
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
              />
            </HpsmField>
            <HpsmField label="Achados" htmlFor="report-findings" top>
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
              help="Indicadores de comprometimento."
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
