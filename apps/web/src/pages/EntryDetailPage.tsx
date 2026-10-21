import { Select, SelectItem } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, SandboxSession } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EntryReportsTab } from '../components/EntryReportsTab';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from '../components/HpsmForm';
import { type HpsmTabItem, HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton, HpsmToolbarDivider } from '../components/HpsmToolbar';
import { IconArrowLeft, IconDownload, IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { SandboxPanel } from '../components/SandboxPanel';
import { isSandboxActive, isSandboxWorking } from '../components/sandboxStatus';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { useWorkspaceTitle } from '../components/workspace';

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
    refetchInterval: (q) => (isSandboxWorking(q.state.data?.session?.status) ? 2500 : false),
    refetchOnWindowFocus: true,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const entry = query.data?.entry;
  const sandboxSession = sandboxQuery.data?.session ?? null;
  const sandboxActive = isSandboxActive(sandboxSession?.status);

  useWorkspaceTitle(entry?.title);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['entry', id] });

  // Triagem grava na hora; o retorno vai para a barra de mensagens (padrao HPSM).
  const quickUpdate = async (patch: Record<string, unknown>) => {
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/entries/${id}`, patch);
      await reload();
      setSaved(true);
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

  if (query.isLoading) return <HpsmLoading text="Carregando amostra..." />;
  if (query.isError || !entry) {
    return <HpsmMessage kind="error">Amostra não encontrada.</HpsmMessage>;
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
      <HpsmToolbar label="Ações da amostra">
        <HpsmToolbarButton label="Voltar" icon={IconArrowLeft} onClick={() => navigate(-1)} />
        <HpsmToolbarButton label="Atualizar" icon={IconRefresh} onClick={reload} />
        {entry.type === 'FILE' && (
          <>
            <HpsmToolbarDivider />
            <HpsmToolbarButton
              label="Baixar amostra"
              icon={IconDownload}
              href={`/api/entries/${entry.id}/download`}
              disabled={!entry.storageKey}
              title="Atenção: esta amostra pode ser maliciosa. Manuseie em ambiente isolado."
            />
          </>
        )}
      </HpsmToolbar>

      <PageHeader title={entry.title} />
      <div className="dl-summary dl-mb-lg">
        <span>
          <span className="dl-summary__label">Tipo:</span> <TypeTag type={entry.type} />
        </span>
        <span>
          <span className="dl-summary__label">Status:</span> <StatusTag status={entry.status} />
        </span>
        <span>
          <span className="dl-summary__label">Veredito:</span>{' '}
          <VerdictTag verdict={entry.verdict} />
        </span>
        {entry.tags.length > 0 && (
          <span>
            <span className="dl-summary__label">Tags:</span>{' '}
            {entry.tags.map((t) => t.name).join(', ')}
          </span>
        )}
      </div>

      <HpsmTabs ariaLabel="Amostra" active={activeTab} onChange={changeTab} items={tabs} />

      {activeTab === 'detalhes' && (
        <div className="hpsm-tabpanel">
          <HpsmSection title="Envio">
            <HpsmForm columns={2}>
              <HpsmField label="Enviado por">
                <HpsmReadonly>
                  {entry.owner.displayName} ({entry.owner.email})
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label="Tipo">
                <HpsmReadonly>{entry.type === 'FILE' ? 'Arquivo' : 'Link'}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="Enviado em">
                <HpsmReadonly>{fmtDate(entry.createdAt)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="Atualizado em">
                <HpsmReadonly>{fmtDate(entry.updatedAt)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="Descrição" wide top>
                <HpsmReadonly multiline>{entry.description || '—'}</HpsmReadonly>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>

          {entry.type === 'FILE' ? (
            <HpsmSection title="Arquivo">
              <HpsmForm columns={2}>
                <HpsmField label="Nome do arquivo">
                  <HpsmReadonly>{entry.originalFilename || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField label="Tamanho">
                  <HpsmReadonly>{fmtSize(entry.fileSize)}</HpsmReadonly>
                </HpsmField>
                <HpsmField label="Tipo MIME">
                  <HpsmReadonly>{entry.mimeType || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField
                  label="SHA-256"
                  wide
                  help="Atenção: esta amostra pode ser maliciosa. Manuseie em ambiente isolado."
                >
                  <HpsmReadonly mono>{entry.sha256 || '—'}</HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </HpsmSection>
          ) : (
            <HpsmSection title="Link">
              <HpsmForm>
                <HpsmField label="URL">
                  <HpsmReadonly mono>{entry.url}</HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </HpsmSection>
          )}
        </div>
      )}

      {canTriage && (
        <div className="hpsm-tabpanel" hidden={activeTab !== 'analise'}>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          {saved && <HpsmMessage kind="success">Registro atualizado.</HpsmMessage>}

          <HpsmSection title="Triagem">
            <HpsmForm columns={2}>
              <HpsmField label="Status" htmlFor="triage-status">
                <Select
                  id="triage-status"
                  labelText="Status"
                  hideLabel
                  value={entry.status}
                  onChange={(e) => quickUpdate({ status: e.target.value })}
                >
                  <SelectItem value="PENDING" text="Pendente" />
                  <SelectItem value="IN_REVIEW" text="Em análise" />
                  <SelectItem value="COMPLETED" text="Concluído" />
                </Select>
              </HpsmField>
              <HpsmField label="Veredito" htmlFor="triage-verdict">
                <Select
                  id="triage-verdict"
                  labelText="Veredito"
                  hideLabel
                  value={entry.verdict}
                  onChange={(e) => quickUpdate({ verdict: e.target.value })}
                >
                  <SelectItem value="UNKNOWN" text="Desconhecido" />
                  <SelectItem value="CLEAN" text="Limpo" />
                  <SelectItem value="SUSPICIOUS" text="Suspeito" />
                  <SelectItem value="MALICIOUS" text="Malicioso" />
                </Select>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>

          {entry.type === 'FILE' && <SandboxPanel entryId={entry.id} />}
        </div>
      )}

      {activeTab === 'relatorios' && (
        <div className="hpsm-tabpanel">
          <EntryReportsTab
            entryId={id}
            reports={reports}
            canTriage={canTriage}
            onCreated={reload}
          />
        </div>
      )}
    </>
  );
}
