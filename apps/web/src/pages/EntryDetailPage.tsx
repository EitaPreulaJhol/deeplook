import { ArrowLeft, Download } from '@carbon/icons-react';
import {
  Button,
  Checkbox,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Tag,
  TextArea,
  Tile,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

function fmtSize(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dl-detail-row">
      <div className="dl-detail-row__label">{label}</div>
      <div className="dl-detail-row__value">{children}</div>
    </div>
  );
}

export function EntryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';

  const query = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<{ entry: Entry }>(`/entries/${id}`),
  });

  const [summary, setSummary] = useState('');
  const [findings, setFindings] = useState('');
  const [iocs, setIocs] = useState('');
  const [verdict, setVerdict] = useState<Verdict>('SUSPICIOUS');
  const [published, setPublished] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const entry = query.data?.entry;

  const createReport = async () => {
    setFormError(null);
    if (summary.trim().length < 3) {
      setFormError('Descreva um resumo do relatório.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/entries/${id}/reports`, { summary, findings, iocs, verdict, published });
      setSummary('');
      setFindings('');
      setIocs('');
      await queryClient.invalidateQueries({ queryKey: ['entry', id] });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const quickUpdate = async (patch: Record<string, unknown>) => {
    setFormError(null);
    try {
      await api.patch(`/entries/${id}`, patch);
      await queryClient.invalidateQueries({ queryKey: ['entry', id] });
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  if (query.isLoading) return <InlineLoading description="Carregando amostra..." />;
  if (query.isError || !entry) {
    return (
      <InlineNotification
        kind="error"
        title="Erro"
        subtitle="Amostra não encontrada."
        lowContrast
      />
    );
  }

  const reports = entry.reports ?? [];

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        renderIcon={ArrowLeft}
        onClick={() => navigate(-1)}
        className="dl-mb-md"
      >
        Voltar
      </Button>

      <PageHeader title={entry.title} />
      <div className="dl-taglist dl-mb-lg">
        <TypeTag type={entry.type} />
        <StatusTag status={entry.status} />
        <VerdictTag verdict={entry.verdict} />
        {entry.tags.map((t) => (
          <Tag key={t.id} type="outline" size="sm">
            {t.name}
          </Tag>
        ))}
      </div>

      <Tile className="dl-mb-lg">
        <h3 className="dl-mb-md">Detalhes</h3>
        <DetailRow label="Enviado por">
          {entry.owner.displayName} ({entry.owner.email})
        </DetailRow>
        {entry.type === 'FILE' ? (
          <>
            <DetailRow label="Arquivo">{entry.originalFilename || '—'}</DetailRow>
            <DetailRow label="Tamanho">{fmtSize(entry.fileSize)}</DetailRow>
            <DetailRow label="Tipo MIME">{entry.mimeType || '—'}</DetailRow>
            <DetailRow label="SHA-256">
              <span className="dl-mono">{entry.sha256 || '—'}</span>
            </DetailRow>
          </>
        ) : (
          <DetailRow label="URL">
            <span className="dl-mono">{entry.url}</span>
          </DetailRow>
        )}
        <DetailRow label="Enviado em">{fmtDate(entry.createdAt)}</DetailRow>
        <DetailRow label="Atualizado em">{fmtDate(entry.updatedAt)}</DetailRow>
        {entry.description && <DetailRow label="Descrição">{entry.description}</DetailRow>}
      </Tile>

      {entry.type === 'FILE' && (
        <div className="dl-mb-lg">
          <Button
            renderIcon={Download}
            href={`/api/entries/${entry.id}/download`}
            disabled={!entry.storageKey}
          >
            Baixar amostra
          </Button>
          <p className="dl-page-subtitle">
            Atenção: esta amostra pode ser maliciosa. Manuseie em ambiente isolado.
          </p>
        </div>
      )}

      {canTriage && (
        <Tile className="dl-mb-lg">
          <h3 className="dl-mb-md">Ações de triagem</h3>
          <div className="dl-toolbar">
            <Select
              id="triage-status"
              labelText="Status"
              value={entry.status}
              onChange={(e) => quickUpdate({ status: e.target.value })}
            >
              <SelectItem value="PENDING" text="Pendente" />
              <SelectItem value="IN_REVIEW" text="Em análise" />
              <SelectItem value="COMPLETED" text="Concluído" />
            </Select>
            <Select
              id="triage-verdict"
              labelText="Veredito"
              value={entry.verdict}
              onChange={(e) => quickUpdate({ verdict: e.target.value })}
            >
              <SelectItem value="UNKNOWN" text="Desconhecido" />
              <SelectItem value="CLEAN" text="Limpo" />
              <SelectItem value="SUSPICIOUS" text="Suspeito" />
              <SelectItem value="MALICIOUS" text="Malicioso" />
            </Select>
          </div>
        </Tile>
      )}

      <h3 className="dl-mb-md">Relatórios ({reports.length})</h3>
      {reports.length === 0 && <div className="dl-empty">Nenhum relatório publicado ainda.</div>}
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
          {formError && (
            <InlineNotification
              kind="error"
              title="Erro"
              subtitle={formError}
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
