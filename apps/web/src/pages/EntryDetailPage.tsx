import { Select, SelectItem } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, SandboxSession, SlaConfig } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { copyText } from '../components/CopyButton';
import { downloadText, entryReportsMarkdown } from '../components/entryExport';
import { EntryHistoryTab } from '../components/EntryHistoryTab';
import { loadEntrySequence } from '../components/entryNav';
import { EntryRelatedTab, useRelatedEntries } from '../components/EntryRelatedTab';
import { EntryReportsTab } from '../components/EntryReportsTab';
import { useFavorites } from '../components/favorites';
import { formatFileSize } from '../components/HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from '../components/HpsmForm';
import { type HpsmTabItem, HpsmTabs } from '../components/HpsmTabs';
import {
  HpsmToolbar,
  HpsmToolbarButton,
  HpsmToolbarDivider,
  HpsmToolbarMenu,
} from '../components/HpsmToolbar';
import {
  IconArrowLeft,
  IconCopy,
  IconDownload,
  IconPage,
  IconPrint,
  IconRefresh,
  IconScreen,
  IconStar,
} from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { SandboxPanel } from '../components/SandboxPanel';
import { isSandboxActive, isSandboxWorking, useMinutesLeft } from '../components/sandboxStatus';
import { AgeText } from '../components/sla';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { useWorkspaceTitle } from '../components/workspace';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

export function EntryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';

  const query = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<{ entry: Entry; sla?: SlaConfig }>(`/entries/${id}`),
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

  // Amostras relacionadas: o total aparece no rotulo da aba.
  const relatedQuery = useRelatedEntries(id);

  // Analistas que podem ser responsaveis (select da triagem).
  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    enabled: canTriage,
    staleTime: 5 * 60 * 1000,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fixar / Desafixar: a amostra entra na pasta Favoritos do navegador.
  const favs = useFavorites();
  const pinned = favs.favorites.find((f) => f.kind === 'ENTRY' && f.entryId === id);
  // Retorno das acoes da toolbar (Fixar, menu Mais) na barra de mensagens.
  const [pinNotice, setPinNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinning, setPinning] = useState(false);
  const togglePin = async () => {
    setPinNotice(null);
    setPinning(true);
    try {
      if (pinned) {
        await favs.remove(pinned.id);
        setPinNotice({ ok: true, text: 'Amostra removida dos Favoritos.' });
      } else {
        await favs.pinEntry(id);
        setPinNotice({ ok: true, text: 'Amostra fixada nos Favoritos do navegador.' });
      }
    } catch (err) {
      setPinNotice({ ok: false, text: (err as Error).message });
    } finally {
      setPinning(false);
    }
  };

  const entry = query.data?.entry;
  const sandboxSession = sandboxQuery.data?.session ?? null;
  const sandboxActive = isSandboxActive(sandboxSession?.status);

  // Prazo do ambiente isolado: aparece na aba de documento ("12min · nome", antes
  // do nome para nao sumir no corte) e, nos ultimos 5 min, vira um aviso.
  const sandboxRunning = sandboxSession?.status === 'RUNNING';
  const minutesLeft = useMinutesLeft(sandboxRunning ? sandboxSession?.expiresAt : null);
  const showCountdown = sandboxRunning && minutesLeft !== null && minutesLeft > 0;
  useWorkspaceTitle(
    entry && showCountdown ? `${minutesLeft}min · ${entry.title}` : entry?.title,
    entry?.title,
  );
  const [extending, setExtending] = useState(false);
  const extendSandbox = async () => {
    if (!sandboxSession) return;
    setExtending(true);
    try {
      await api.post(`/sandbox/${sandboxSession.id}/extend`, {});
      await queryClient.invalidateQueries({ queryKey: ['sandbox', 'entry', id] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExtending(false);
    }
  };

  // Recarrega a amostra e os contadores das filas do navegador.
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['entry', id] }),
      queryClient.invalidateQueries({ queryKey: ['entries', 'counts'] }),
    ]);

  // Anterior / Proxima dentro da lista de onde a amostra foi aberta. Troca o
  // registro na mesma aba de documento e mantem a aba interna (?tab=).
  const sequence = loadEntrySequence();
  const position = sequence.indexOf(id);
  const goToEntry = (target: string) =>
    navigate(`/entries/${target}${location.search}`, { state: { replaceTab: location.pathname } });

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
    {
      id: 'relacionadas',
      label: relatedQuery.data ? `Relacionadas (${relatedQuery.data.total})` : 'Relacionadas',
    },
    { id: 'historico', label: 'Histórico' },
  ];
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam && tabs.some((t) => t.id === tabParam) ? tabParam : 'detalhes';

  return (
    <>
      <HpsmToolbar label="Ações da amostra">
        <HpsmToolbarButton label="Voltar" icon={IconArrowLeft} onClick={() => navigate(-1)} />
        <HpsmToolbarButton label="Atualizar" icon={IconRefresh} onClick={reload} />
        <HpsmToolbarButton
          label={pinned ? 'Desafixar' : 'Fixar'}
          icon={IconStar}
          title={
            pinned ? 'Remover dos Favoritos do navegador' : 'Adicionar aos Favoritos do navegador'
          }
          disabled={pinning || favs.loading}
          pressed={Boolean(pinned)}
          onClick={() => void togglePin()}
        />
        {canTriage && user && entry.assignee?.id !== user.id && (
          <HpsmToolbarButton
            label="Assumir análise"
            icon={IconPage}
            title="Tornar-me responsável por esta amostra"
            onClick={() => quickUpdate({ assigneeId: user.id })}
          />
        )}
        {position >= 0 && sequence.length > 1 && (
          <>
            <HpsmToolbarDivider />
            <HpsmToolbarButton
              label="◀ Anterior"
              title="Registro anterior da lista"
              disabled={position === 0}
              onClick={() => goToEntry(sequence[position - 1])}
            />
            <HpsmToolbarButton
              label="Próxima ▶"
              title="Próximo registro da lista"
              disabled={position === sequence.length - 1}
              onClick={() => goToEntry(sequence[position + 1])}
            />
          </>
        )}
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
        <HpsmToolbarDivider />
        <HpsmToolbarMenu
          label="Mais"
          items={[
            {
              label: 'Copiar link do registro',
              icon: IconCopy,
              action: async () => {
                const ok = await copyText(`${window.location.origin}/entries/${entry.id}`);
                setPinNotice(
                  ok
                    ? { ok: true, text: 'Link do registro copiado.' }
                    : { ok: false, text: 'Não foi possível copiar o link.' },
                );
              },
            },
            {
              label: 'Abrir em nova janela',
              icon: IconScreen,
              action: () => window.open(`/entries/${entry.id}`, '_blank', 'noopener'),
            },
            {
              label: 'Imprimir ficha…',
              icon: IconPrint,
              separated: true,
              action: () => window.open(`/entries/${entry.id}/imprimir?auto=1`, '_blank'),
            },
            {
              label: 'Exportar relatórios (Markdown)',
              icon: IconDownload,
              disabled: !reports.some((r) => r.published),
              action: () =>
                downloadText(
                  `deeplook-${entry.id}-relatorios.md`,
                  entryReportsMarkdown(entry, user?.displayName ?? '—'),
                ),
            },
          ]}
        />
        {position >= 0 && sequence.length > 1 && (
          <span className="hpsm-toolbar__info">
            Registro {position + 1} de {sequence.length}
          </span>
        )}
      </HpsmToolbar>

      {pinNotice && (
        <HpsmMessage key={pinNotice.text} kind={pinNotice.ok ? 'success' : 'error'}>
          {pinNotice.text}
        </HpsmMessage>
      )}

      {showCountdown && minutesLeft <= 5 && (
        <HpsmMessage kind="warning">
          O ambiente isolado desta amostra expira em {minutesLeft} min.{' '}
          <button
            type="button"
            className="dl-link-button"
            disabled={extending}
            onClick={extendSandbox}
          >
            {extending ? 'Estendendo...' : 'Estender prazo'}
          </button>
        </HpsmMessage>
      )}

      <PageHeader title={entry.title} />
      <div className="dl-summary dl-mb-lg">
        <span>
          <span className="dl-summary__label">Tipo:</span> <TypeTag type={entry.type} />
        </span>
        <span>
          <span className="dl-summary__label">Responsável:</span>{' '}
          {entry.assignee?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">Status:</span> <StatusTag status={entry.status} />
        </span>
        {entry.status !== 'COMPLETED' && entry.statusChangedAt && (
          <span>
            <span className="dl-summary__label">No status há:</span>{' '}
            <AgeText entry={entry} sla={query.data?.sla} />
          </span>
        )}
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
                  <HpsmReadonly>{formatFileSize(entry.fileSize)}</HpsmReadonly>
                </HpsmField>
                <HpsmField label="Tipo MIME">
                  <HpsmReadonly>{entry.mimeType || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField
                  label="SHA-256"
                  wide
                  help="Atenção: esta amostra pode ser maliciosa. Manuseie em ambiente isolado."
                >
                  <HpsmReadonly
                    mono
                    copyable={entry.sha256 ? { value: entry.sha256, label: 'SHA-256' } : undefined}
                  >
                    {entry.sha256 || '—'}
                  </HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </HpsmSection>
          ) : (
            <HpsmSection title="Link">
              <HpsmForm>
                <HpsmField label="URL">
                  <HpsmReadonly
                    mono
                    copyable={entry.url ? { value: entry.url, label: 'URL' } : undefined}
                  >
                    {entry.url}
                  </HpsmReadonly>
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
              <HpsmField label="Responsável" htmlFor="triage-assignee">
                <Select
                  id="triage-assignee"
                  labelText="Responsável"
                  hideLabel
                  value={entry.assignee?.id ?? ''}
                  onChange={(e) => quickUpdate({ assigneeId: e.target.value || null })}
                >
                  <SelectItem value="" text="— Sem responsável —" />
                  {(analystsQuery.data?.analysts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id} text={a.displayName} />
                  ))}
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

      {activeTab === 'relacionadas' && (
        <div className="hpsm-tabpanel">
          <EntryRelatedTab entryId={id} />
        </div>
      )}

      {activeTab === 'historico' && (
        <div className="hpsm-tabpanel">
          <EntryHistoryTab entryId={id} />
        </div>
      )}
    </>
  );
}
