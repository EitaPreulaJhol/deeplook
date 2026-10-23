import { Select, SelectItem } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, SandboxSession, SlaConfig } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AntivirusSection, useAntivirus } from '../components/AntivirusSection';
import { copyText } from '../components/CopyButton';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { downloadText, downloadUrl, entryReportsMarkdown } from '../components/entryExport';
import { EntryHistoryTab } from '../components/EntryHistoryTab';
import { loadEntrySequence } from '../components/entryNav';
import { EntryRelatedTab, useRelatedEntries } from '../components/EntryRelatedTab';
import { EntryReportsTab } from '../components/EntryReportsTab';
import { useFavorites } from '../components/favorites';
import { HexViewer } from '../components/HexViewer';
import { useConfirm } from '../components/HpsmConfirm';
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
  IconTrash,
} from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import {
  ReputationSection,
  reputationSummary,
  useReputation,
} from '../components/ReputationSection';
import { SandboxPanel } from '../components/SandboxPanel';
import { isSandboxActive, isSandboxWorking, useMinutesLeft } from '../components/sandboxStatus';
import { AgeText } from '../components/sla';
import { DisguisedFileWarning, StaticAnalysisSection } from '../components/StaticAnalysisSection';
import { PriorityTag, StatusTag, StatusText, TypeTag, VerdictTag } from '../components/tags';
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
    queryFn: () =>
      api.get<{
        entry: Entry;
        sla?: SlaConfig;
        reviewRequired?: boolean;
        retentionDays?: number;
      }>(`/entries/${id}`),
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

  // Reputacao externa: resumo no topo (a secao da aba Detalhes usa a mesma consulta).
  const reputation = reputationSummary(useReputation(id).data);
  // Antivirus: "Infectado" tambem aparece no topo.
  const antivirus = useAntivirus(id, true).data;

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
  // Duplicata: caixa de escolha da principal e "Desfazer".
  const [dupOpen, setDupOpen] = useState(false);
  const confirm = useConfirm();
  const reloadAfterDuplicate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['entry'] }),
      queryClient.invalidateQueries({ queryKey: ['entries'] }),
    ]);
  const undoDuplicate = async () => {
    const ok = await confirm({
      title: 'Desfazer duplicata',
      message: 'A amostra volta ao status e ao veredito que tinha antes de ser marcada.',
      confirmLabel: 'Desfazer',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    try {
      await api.del(`/entries/${id}/duplicate`);
      await reloadAfterDuplicate();
      setPinNotice({ ok: true, text: 'A amostra deixou de ser duplicata.' });
    } catch (err) {
      setPinNotice({ ok: false, text: (err as Error).message });
    }
  };

  // Lixeira (admin): a ficha some de todas as telas; a aba vira a Lixeira, onde da para restaurar.
  const isAdmin = user?.role === 'ADMIN';
  const moveToTrash = async (title: string) => {
    const ok = await confirm({
      title: 'Mover para a lixeira',
      message: `"${title}" vai sumir das listas, filas, buscas e favoritos. Dá para restaurar depois em Administração > Lixeira.`,
      confirmLabel: 'Mover para a lixeira',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/entries/${id}/trash`, {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'trash'] }),
      ]);
      navigate('/admin?tab=trash', { state: { replaceTab: location.pathname, trashed: title } });
    } catch (err) {
      setPinNotice({ ok: false, text: (err as Error).message });
    }
  };

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
              title={
                entry.filePurgedAt
                  ? 'O arquivo foi expurgado pela política de retenção.'
                  : 'Atenção: esta amostra pode ser maliciosa. Manuseie em ambiente isolado.'
              }
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
            ...(canTriage
              ? [
                  entry.duplicateOf
                    ? {
                        label: 'Desfazer duplicata',
                        separated: true,
                        action: () => void undoDuplicate(),
                      }
                    : {
                        label: 'Marcar como duplicata…',
                        separated: true,
                        action: () => setDupOpen(true),
                      },
                ]
              : []),
            {
              label: 'Imprimir ficha…',
              icon: IconPrint,
              separated: true,
              action: () => window.open(`/entries/${entry.id}/imprimir?auto=1`, '_blank'),
            },
            {
              label: 'Exportar relatórios (Markdown)',
              icon: IconDownload,
              disabled: !reports.some((r) => r.status === 'PUBLISHED'),
              action: () =>
                downloadText(
                  `deeplook-${entry.id}-relatorios.md`,
                  entryReportsMarkdown(entry, user?.displayName ?? '—'),
                ),
            },
            // IOCs dos relatorios publicados + o proprio arquivo/URL, gerados na API.
            ...(
              [
                ['csv', 'CSV'],
                ['stix', 'STIX 2.1'],
                ['misp', 'MISP'],
              ] as const
            ).map(([format, name], i) => ({
              label: `Exportar IOCs (${name})`,
              icon: IconDownload,
              separated: i === 0,
              action: () => downloadUrl(`/api/entries/${entry.id}/iocs/export?format=${format}`),
            })),
            // Acao destrutiva por ultimo, separada das demais.
            ...(isAdmin
              ? [
                  {
                    label: 'Mover para a lixeira…',
                    icon: IconTrash,
                    separated: true,
                    action: () => void moveToTrash(entry.title),
                  },
                ]
              : []),
          ]}
        />
        {position >= 0 && sequence.length > 1 && (
          <span className="hpsm-toolbar__info">
            Registro {position + 1} de {sequence.length}
          </span>
        )}
      </HpsmToolbar>

      {dupOpen && (
        <DuplicateDialog
          entryId={entry.id}
          excludeIds={(entry.duplicates ?? []).map((d) => d.id)}
          onClose={(principal) => {
            setDupOpen(false);
            if (!principal) return;
            void reloadAfterDuplicate();
            setPinNotice({ ok: true, text: `Marcada como duplicata de "${principal.title}".` });
          }}
        />
      )}

      <DisguisedFileWarning info={entry.staticInfo} />

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
          <span className="dl-summary__label">Prioridade:</span>{' '}
          <PriorityTag priority={entry.priority} />
        </span>
        <span>
          <span className="dl-summary__label">Veredito:</span>{' '}
          <VerdictTag verdict={entry.verdict} />
        </span>
        {entry.duplicateOf && (
          <span>
            <span className="dl-summary__label">Duplicata de:</span>{' '}
            <Link className="dl-link" to={`/entries/${entry.duplicateOf.id}`}>
              {entry.duplicateOf.title}
            </Link>
          </span>
        )}
        {(entry._count?.duplicates ?? 0) > 0 && (
          <span>
            <span className="dl-summary__label">Duplicatas:</span> {entry._count?.duplicates}
          </span>
        )}
        {antivirus?.enabled && antivirus.scan?.status === 'INFECTED' && (
          <span>
            <span className="dl-summary__label">Antivírus:</span>{' '}
            <StatusText tone="red">infectado ({antivirus.scan.signature})</StatusText>
          </span>
        )}
        {reputation && (
          <span>
            <span className="dl-summary__label">Reputação:</span>{' '}
            <StatusText tone={reputation.tone}>{reputation.text}</StatusText>
          </span>
        )}
        {entry.filePurgedAt && (
          <span>
            <span className="dl-summary__label">Arquivo:</span> expurgado em{' '}
            {new Date(entry.filePurgedAt).toLocaleDateString('pt-BR')}
          </span>
        )}
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
          {(entry.duplicates?.length ?? 0) > 0 && (
            <HpsmSection
              title={`Duplicatas (${entry._count?.duplicates ?? entry.duplicates?.length})`}
            >
              <ul className="dl-dup-list">
                {entry.duplicates?.map((d) => (
                  <li key={d.id}>
                    <Link className="dl-link" to={`/entries/${d.id}`}>
                      {d.title}
                    </Link>{' '}
                    <span className="dl-dup-list__date">enviada em {fmtDate(d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </HpsmSection>
          )}
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
                {entry.filePurgedAt && (
                  <HpsmField label="Armazenamento" wide>
                    <HpsmReadonly>
                      Arquivo expurgado em {fmtDate(entry.filePurgedAt)} pela política de retenção
                      {query.data?.retentionDays
                        ? ` (${query.data.retentionDays} dias após a conclusão)`
                        : ''}
                      . A ficha, os relatórios, os IOCs e o hash continuam disponíveis.
                    </HpsmReadonly>
                  </HpsmField>
                )}
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
          ) : null}
          {entry.type === 'FILE' && (
            <StaticAnalysisSection
              entryId={entry.id}
              info={entry.staticInfo}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          {entry.type !== 'FILE' && (
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
          {entry.type === 'FILE' && (
            <AntivirusSection
              entryId={entry.id}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          <ReputationSection entryId={entry.id} canTriage={canTriage} />
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
              <HpsmField
                label="Prioridade"
                htmlFor="triage-priority"
                help={
                  query.data?.sla?.byPriority
                    ? `Prazo: alerta acima de ${query.data.sla.byPriority[entry.priority ?? 'P3'].warnHours} h e atraso acima de ${query.data.sla.byPriority[entry.priority ?? 'P3'].lateHours} h no status.`
                    : undefined
                }
              >
                <Select
                  id="triage-priority"
                  labelText="Prioridade"
                  hideLabel
                  value={entry.priority ?? 'P3'}
                  onChange={(e) => quickUpdate({ priority: e.target.value })}
                >
                  <SelectItem value="P1" text="P1 Crítica" />
                  <SelectItem value="P2" text="P2 Alta" />
                  <SelectItem value="P3" text="P3 Média" />
                  <SelectItem value="P4" text="P4 Baixa" />
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

          {entry.type === 'FILE' && (
            <HexViewer entryId={entry.id} purged={Boolean(entry.filePurgedAt)} />
          )}
          {entry.type === 'FILE' &&
            (entry.filePurgedAt ? (
              <HpsmSection title="Ambiente isolado">
                <p className="dl-static-empty">
                  Indisponível: o arquivo desta amostra foi expurgado pela política de retenção.
                </p>
              </HpsmSection>
            ) : (
              <SandboxPanel entryId={entry.id} />
            ))}
        </div>
      )}

      {activeTab === 'relatorios' && (
        <div className="hpsm-tabpanel">
          <EntryReportsTab
            entryId={id}
            reports={reports}
            canTriage={canTriage}
            onCreated={reload}
            reviewRequired={query.data?.reviewRequired ?? false}
            suggestedIocs={entry.staticInfo?.iocCandidates.map((i) => i.value) ?? []}
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
