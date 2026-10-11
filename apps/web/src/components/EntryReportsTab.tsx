import {
  Button,
  Checkbox,
  InlineNotification,
  Select,
  SelectItem,
  Tag,
  TextArea,
  Tile,
} from '@carbon/react';
import { type RefObject, useState } from 'react';

import { api } from '../api/client';
import type { Report, Verdict } from '../api/types';
import { IconScreen } from './icons';
import { type SandboxConsoleHandle } from './SandboxConsole';
import { VerdictTag } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

interface Props {
  entryId: string;
  reports: Report[];
  canTriage: boolean;
  /** Chamado apos publicar um relatorio (o pai recarrega a amostra). */
  onCreated: () => void;
  /** Ref do console noVNC (para capturar a tela da VM). */
  consoleRef: RefObject<SandboxConsoleHandle>;
  /** Ha uma VM em execucao (console disponivel para captura)? */
  canCapture: boolean;
}

/**
 * Aba "Relatorios": lista os relatorios da amostra e, para analistas/admin,
 * o formulario de novo relatorio (+ captura de tela do console).
 */
export function EntryReportsTab({
  entryId,
  reports,
  canTriage,
  onCreated,
  consoleRef,
  canCapture,
}: Props) {
  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [iocs, setIocs] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('SUSPICIOUS');
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  const captureScreen = () => {
    setCaptureMsg(null);
    const handle = consoleRef.current;
    if (!handle) {
      setCaptureMsg('Nenhum console ativo. Abra o ambiente na aba "Análise".');
      return;
    }
    void handle.captureScreen().then((ok) => {
      if (!ok) setCaptureMsg('Não foi possível capturar a tela (o console ainda não renderizou).');
    });
  };

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
      {canTriage && (
        <div className="dl-toolbar dl-mb-lg">
          <Button
            size="sm"
            kind="ghost"
            renderIcon={IconScreen}
            disabled={!canCapture}
            onClick={captureScreen}
          >
            Capturar tela do console
          </Button>
          <span className="dl-page-subtitle">
            {canCapture
              ? 'Abre a imagem atual da VM numa nova aba (evidência para o laudo).'
              : 'Ligue um ambiente na aba "Análise" para capturar a tela.'}
          </span>
        </div>
      )}
      {captureMsg && (
        <InlineNotification
          kind="error"
          title="Erro"
          subtitle={captureMsg}
          lowContrast
          className="dl-note dl-mb-md"
        />
      )}

      {reports.length === 0 && (
        <div className="dl-empty dl-mb-lg">Nenhum relatório publicado ainda.</div>
      )}
      {reports.map((r) => (
        <Tile key={r.id} className="dl-mb-md">
          <div className="dl-report__head">
            <div>
              <strong>{r.analyst.displayName}</strong>
              <span className="dl-report__meta">{fmtDate(r.createdAt)}</span>
            </div>
            <div className="dl-row">
              <VerdictTag verdict={r.verdict} />
              {!r.published && (
                <Tag type="warm-gray" size="sm">
                  Rascunho
                </Tag>
              )}
            </div>
          </div>
          <p className="dl-mt-md">{r.summary}</p>
          {r.findings && (
            <div className="dl-mt-md">
              <strong>Achados:</strong>
              <p className="dl-pre">{r.findings}</p>
            </div>
          )}
          {r.iocs && (
            <div className="dl-mt-md">
              <strong>IOCs:</strong>
              <p className="dl-mono dl-pre">{r.iocs}</p>
            </div>
          )}
        </Tile>
      ))}

      {canTriage && (
        <Tile className="dl-mt-lg">
          <h3 className="dl-mb-md">Novo relatório de análise</h3>
          {error && (
            <InlineNotification
              kind="error"
              title="Erro"
              subtitle={error}
              lowContrast
              className="dl-note dl-mb-md"
            />
          )}
          <TextArea
            id="report-summary"
            labelText="Resumo"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="dl-mb-md"
          />
          <TextArea
            id="report-findings"
            labelText="Achados"
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            rows={5}
            className="dl-mb-md"
          />
          <TextArea
            id="report-iocs"
            labelText="IOCs (indicadores de comprometimento)"
            value={iocs}
            onChange={(e) => setIocs(e.target.value)}
            rows={3}
            className="dl-mb-md"
          />
          <div className="dl-toolbar">
            <Select
              id="report-verdict"
              labelText="Veredito"
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as Verdict)}
            >
              <SelectItem value="UNKNOWN" text="Desconhecido" />
              <SelectItem value="CLEAN" text="Limpo" />
              <SelectItem value="SUSPICIOUS" text="Suspeito" />
              <SelectItem value="MALICIOUS" text="Malicioso" />
            </Select>
            <Checkbox
              id="report-published"
              labelText="Publicar (define status/veredito da amostra)"
              checked={published}
              onChange={(_, { checked }) => setPublished(checked)}
            />
            <Button onClick={createReport} disabled={saving}>
              {saving ? 'Salvando...' : 'Publicar relatório'}
            </Button>
          </div>
        </Tile>
      )}
    </>
  );
}
