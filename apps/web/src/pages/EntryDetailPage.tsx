import {
  Button,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Tag,
  Tile,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, SandboxSession, SandboxStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EntryReportsTab } from '../components/EntryReportsTab';
import { type HpsmTabItem, HpsmTabs } from '../components/HpsmTabs';
import { IconArrowLeft, IconDownload } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { type SandboxConsoleHandle } from '../components/SandboxConsole';
import { SandboxPanel } from '../components/SandboxPanel';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';

/** Sessoes consideradas "ativas" (indicador da aba Analise). */
const SANDBOX_ACTIVE: SandboxStatus[] = ['REQUESTED', 'PROVISIONING', 'RUNNING', 'STOPPING'];
/** Provisionamento em andamento (polling do painel). */
const SANDBOX_WORKING: SandboxStatus[] = ['REQUESTED', 'PROVISIONING', 'STOPPING'];

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

  // Mesmo queryKey do SandboxPanel: o React Query compartilha o cache (sem
  // requisicao extra) e a pagina usa isso para o indicador da aba "Analise".
  const sandboxQuery = useQuery({
    queryKey: ['sandbox', 'entry', id],
    queryFn: () =>
      api.get<{ enabled: boolean; consoleEnabled: boolean; session: SandboxSession | null }>(
        `/entries/${id}/sandbox`,
      ),
    enabled: canTriage,
    refetchInterval: (q) => {
      const status = q.state.data?.session?.status;
      return status && SANDBOX_WORKING.includes(status) ? 2500 : false;
    },
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const consoleRef = useRef<SandboxConsoleHandle | null>(null);

  const entry = query.data?.entry;
  const sandboxSession = sandboxQuery.data?.session ?? null;
  const sandboxActive = !!sandboxSession && SANDBOX_ACTIVE.includes(sandboxSession.status);
  const canCaptureConsole = sandboxSession?.status === 'RUNNING';

  const reload = () => queryClient.invalidateQueries({ queryKey: ['entry', id] });

  const quickUpdate = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/entries/${id}`, patch);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'detalhes') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
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

  const tabs: HpsmTabItem[] = [
    { id: 'detalhes', label: 'Detalhes' },
    ...(canTriage
      ? [
          {
            id: 'analise',
            label: 'Análise',
            dot: sandboxActive,
            dotLabel: 'ambiente isolado ativo',
          },
        ]
      : []),
    { id: 'relatorios', label: `Relatórios (${reports.length})` },
  ];
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam && tabs.some((t) => t.id === tabParam) ? tabParam : 'detalhes';

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        renderIcon={IconArrowLeft}
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

      <HpsmTabs ariaLabel="Amostra" active={activeTab} onChange={changeTab} items={tabs} />

      {activeTab === 'detalhes' && (
        <div className="hpsm-tabpanel">
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
                renderIcon={IconDownload}
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
        </div>
      )}

      {canTriage && (
        <div className="hpsm-tabpanel" hidden={activeTab !== 'analise'}>
          {error && (
            <InlineNotification
              kind="error"
              title="Erro"
              subtitle={error}
              lowContrast
              className="dl-note dl-mb-lg"
            />
          )}

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

          {entry.type === 'FILE' && <SandboxPanel entryId={entry.id} consoleRef={consoleRef} />}
        </div>
      )}

      {activeTab === 'relatorios' && (
        <div className="hpsm-tabpanel">
          <EntryReportsTab
            entryId={id}
            reports={reports}
            canTriage={canTriage}
            onCreated={reload}
            consoleRef={consoleRef}
            canCapture={canCaptureConsole}
          />
        </div>
      )}
    </>
  );
}
