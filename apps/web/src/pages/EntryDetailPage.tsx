import { Select, SelectItem } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, SandboxSession, SlaConfig } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AddToCaseDialog } from '../components/AddToCaseDialog';
import { AntivirusSection, useAntivirus } from '../components/AntivirusSection';
import { attackHref } from '../components/attack';
import { CapaSection, useCapa } from '../components/CapaSection';
import { caseHref } from '../components/cases';
import { ChannelsSection } from '../components/ChannelsSection';
import { copyText } from '../components/CopyButton';
import { DeliverySection, DeliveryWarning } from '../components/DeliverySection';
import { DiskImageSection, LnkSection, LnkWarning } from '../components/DiskSections';
import { DocumentSection, DocumentWarning } from '../components/DocumentSection';
import { DuplicateDialog, EntryPickDialog } from '../components/DuplicateDialog';
import { EmailSection } from '../components/EmailSection';
import { downloadText, downloadUrl, entryReportsMarkdown } from '../components/entryExport';
import { EntryHistoryTab } from '../components/EntryHistoryTab';
import { loadEntrySequence } from '../components/entryNav';
import { EntryRelatedTab, useRelatedEntries } from '../components/EntryRelatedTab';
import { EntryReportsTab } from '../components/EntryReportsTab';
import { useFavorites } from '../components/favorites';
import { GhidraSection } from '../components/GhidraSection';
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
import { LookalikeWarning } from '../components/LookalikeWarning';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { OfficeSection } from '../components/OfficeSection';
import { PageCaptureSection } from '../components/PageCaptureSection';
import { PageHeader } from '../components/PageHeader';
import { QrSection, qrUrls, useQr } from '../components/QrSection';
import { RelationMap } from '../components/RelationMap';
import {
  ReputationSection,
  reputationSummary,
  useReputation,
} from '../components/ReputationSection';
import {
  EntryStatusNotice,
  ResolutionForm,
  ResolutionNotice,
} from '../components/ResolutionSection';
import { RiskSection } from '../components/RiskSection';
import { SandboxLaunchDialog } from '../components/SandboxLaunchDialog';
import { openConsoleWindow } from '../components/sandboxOpen';
import { SandboxPanel } from '../components/SandboxPanel';
import { isSandboxActive, isSandboxWorking, useMinutesLeft } from '../components/sandboxStatus';
import { latestRunSummary, runSummaryMarkdown } from '../components/sandboxSummary';
import { ScriptSection, ScriptWarning } from '../components/ScriptSection';
import {
  AndroidSection,
  ConfigSection,
  DotnetSection,
  EmulationSection,
  JarSection,
  JsdeobSection,
  MetadataSection,
  useServiceAnalysis,
} from '../components/ServiceSections';
import { useDecoder } from '../components/shortcuts';
import { AgeText } from '../components/sla';
import { DisguisedFileWarning, StaticAnalysisSection } from '../components/StaticAnalysisSection';
import { PriorityTag, StatusTag, StatusText, TypeTag, VerdictTag } from '../components/tags';
import { UnpackSection } from '../components/UnpackSection';
import { useWorkspaceTitle } from '../components/workspace';
import { useYara, YaraSection } from '../components/YaraSection';
import { getLocale, intlLocale } from '../i18n';
import { t as tr } from '../i18n/entry';
import { t as tSandbox } from '../i18n/sandbox';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

export function EntryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const decode = useDecoder();
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
      api.get<{
        enabled: boolean;
        consoleEnabled: boolean;
        /** Teto da duracao e captura configurada (dialogo de inicio). */
        ttlMinutes?: number;
        captureEnabled?: boolean;
        memoryDumpEnabled?: boolean;
        session: SandboxSession | null;
        sysmonIndicators?: string[];
        networkIndicators?: string[];
      }>(`/entries/${id}/sandbox`),
    enabled: canTriage,
    refetchInterval: (q) => (isSandboxWorking(q.state.data?.session?.status) ? 2500 : false),
    refetchOnWindowFocus: true,
  });

  // Reputacao externa: resumo no topo (a secao da aba Detalhes usa a mesma consulta).
  const reputation = reputationSummary(useReputation(id).data);
  // Antivirus: "Infectado" tambem aparece no topo.
  const antivirus = useAntivirus(id, true).data;
  // Analise de funcoes (item 7.2): as sugestoes do relatorio usam a mesma consulta da secao.
  const capa = useCapa(id, query.data?.entry.type === 'FILE').data;
  const qr = useQr(id).data;
  // IOCs dos servicos novos (plans/novas-analises): emulacao, configuracao e APK.
  const isFile = query.data?.entry.type === 'FILE';
  const emulation = useServiceAnalysis('emulation', id, isFile).data;
  const config = useServiceAnalysis('config', id, isFile).data;
  const android = useServiceAnalysis('android', id, isFile).data;
  // Casos da amostra (analistas; item 55).
  const entryCases = useQuery({
    queryKey: ['entry-cases', id],
    queryFn: () =>
      api.get<{ cases: { id: string; code: string; title: string }[] }>(`/entries/${id}/cases`),
    enabled: canTriage,
  });
  // YARA: acertos tambem aparecem no topo.
  const yara = useYara(id, true).data;

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
  const [compareOpen, setCompareOpen] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const confirm = useConfirm();
  const reloadAfterDuplicate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['entry'] }),
      queryClient.invalidateQueries({ queryKey: ['entries'] }),
    ]);
  const undoDuplicate = async () => {
    const ok = await confirm({
      title: tr('undoDuplicate'),
      message: tr('undoDuplicateHelp'),
      confirmLabel: tr('undo'),
      cancelLabel: tr('cancel'),
    });
    if (!ok) return;
    try {
      await api.del(`/entries/${id}/duplicate`);
      await reloadAfterDuplicate();
      setPinNotice({ ok: true, text: tr('undoneDuplicate') });
    } catch (err) {
      setPinNotice({ ok: false, text: (err as Error).message });
    }
  };

  // Lixeira (admin): a ficha some de todas as telas; a aba vira a Lixeira, onde da para restaurar.
  const isAdmin = user?.role === 'ADMIN';
  const moveToTrash = async (title: string) => {
    const ok = await confirm({
      title: tr('moveToTrash'),
      message: tr('moveToTrashConfirm', { title }),
      confirmLabel: tr('moveToTrash'),
      cancelLabel: tr('cancel'),
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
  const [pinNotice, setPinNotice] = useState<{
    ok: boolean;
    text: string;
    /** Aviso (amarelo) no lugar de sucesso ou erro: o pop-up do console bloqueado. */
    warning?: boolean;
  } | null>(null);
  // Dialogo com as opcoes de inicio do ambiente isolado (botao da barra de ferramentas).
  const [launchOpen, setLaunchOpen] = useState(false);
  const [pinning, setPinning] = useState(false);
  const togglePin = async () => {
    setPinNotice(null);
    setPinning(true);
    try {
      if (pinned) {
        await favs.remove(pinned.id);
        setPinNotice({ ok: true, text: tr('unpinned') });
      } else {
        await favs.pinEntry(id);
        setPinNotice({ ok: true, text: tr('pinned') });
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

  if (query.isLoading) return <HpsmLoading text={tr('loadingSample')} />;
  if (query.isError || !entry) {
    return <HpsmMessage kind="error">{tr('sampleNotFound')}</HpsmMessage>;
  }

  const reports = entry.reports ?? [];
  // IOCs sugeridos: analise estatica e, num e-mail, os links e os dominios de
  // quem enviou / para quem responder.
  const suggestedIocs = [
    ...new Set([
      ...(entry.staticInfo?.iocCandidates.map((i) => i.value) ?? []),
      // Strings que so o FLOSS ve (item 7.2).
      ...(capa?.analysis?.iocCandidates?.map((i) => i.value) ?? []),
      ...(entry.emailInfo?.links ?? []),
      // Enderecos de QR codes (plano pos-revisao, item 2.2).
      ...qrUrls(qr),
      // Dominios e IPs que o Sysmon da VM viu (plano pos-revisao, item 5.3).
      ...(sandboxQuery.data?.sysmonIndicators ?? []),
      // Dominios, hosts e IPs do trafego, pelo Suricata (plano pos-revisao, item 5.4).
      ...(sandboxQuery.data?.networkIndicators ?? []),
      // Destinos da emulacao, C2 da configuracao e enderecos do APK (plans/novas-analises).
      ...(emulation?.analysis?.iocs ?? []),
      ...(config?.analysis?.iocs ?? []),
      ...(android?.analysis?.iocs ?? []),
      ...[entry.emailInfo?.from, ...(entry.emailInfo?.replyTo ?? [])]
        .map((p) => p?.address?.split('@')[1]?.toLowerCase())
        .filter((d): d is string => Boolean(d)),
    ]),
  ];
  // Tecnicas ATT&CK dos relatorios publicados (resumo do topo).
  const attackIds = [
    ...new Set(
      reports.filter((r) => r.status === 'PUBLISHED').flatMap((r) => r.attackTechniques ?? []),
    ),
  ].sort();

  const tabs: HpsmTabItem[] = [
    { id: 'detalhes', label: tr('tabDetails') },
    ...(canTriage
      ? [
          {
            id: 'analise',
            label: tr('tabAnalysis'),
            dot: sandboxActive,
            dotLabel: tr('sandboxActive'),
          },
        ]
      : []),
    { id: 'relatorios', label: tr('tabReports', { n: reports.length }) },
    {
      id: 'relacionadas',
      label: relatedQuery.data
        ? tr('tabRelated', { n: relatedQuery.data.total })
        : tr('tabRelatedPlain'),
    },
    // Mapa de relacoes (item 91).
    { id: 'mapa', label: tr('tabMap') },
    { id: 'historico', label: tr('tabHistory') },
  ];
  // Download (item 122): so quem enviou e os analistas. O botao baixa o ZIP com senha; o arquivo
  // original fica no menu Mais, com confirmacao (plano pos-revisao, item 2.1).
  const canDownload = entry.type === 'FILE' && (canTriage || entry.ownerId === user?.id);
  const downloadOriginal = async () => {
    const ok = await confirm({
      title: tr('downloadOriginalTitle'),
      message: tr('downloadOriginalConfirm'),
      confirmLabel: tr('downloadOriginalButton'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (ok) downloadUrl(`/api/entries/${entry.id}/download?format=raw`);
  };
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam && tabs.some((t) => t.id === tabParam) ? tabParam : 'detalhes';

  return (
    <>
      <HpsmToolbar label={tr('sampleActions')}>
        <HpsmToolbarButton label={tr('back')} icon={IconArrowLeft} onClick={() => navigate(-1)} />
        <HpsmToolbarButton label={tr('refresh')} icon={IconRefresh} onClick={reload} />
        <HpsmToolbarButton
          label={pinned ? tr('unpin') : tr('pin')}
          icon={IconStar}
          title={pinned ? tr('removeFromFavorites') : tr('addToFavorites')}
          disabled={pinning || favs.loading}
          pressed={Boolean(pinned)}
          onClick={() => void togglePin()}
        />
        {canTriage && user && entry.assignee?.id !== user.id && (
          <HpsmToolbarButton
            label={tr('takeOver')}
            icon={IconPage}
            title={tr('takeOverHelp')}
            onClick={() => quickUpdate({ assigneeId: user.id })}
          />
        )}
        {/* Ambiente isolado: so analistas, arquivo presente e nenhum ambiente ativo. Abre o dialogo
            com as opcoes de inicio; "Iniciar ambiente" leva para a aba Analise. Com um ambiente
            ativo, o mesmo lugar abre o console (no ar) ou leva ao ambiente (subindo, encerrando). */}
        {canTriage &&
          sandboxSession &&
          sandboxActive &&
          (sandboxRunning && sandboxQuery.data?.consoleEnabled !== false ? (
            <HpsmToolbarButton
              label={tSandbox('openConsole')}
              icon={IconScreen}
              onClick={() => {
                setPinNotice(null);
                if (!openConsoleWindow(entry.id)) {
                  setPinNotice({ ok: false, text: tSandbox('popupBlockedConsole'), warning: true });
                }
              }}
            />
          ) : (
            <HpsmToolbarButton
              label={tSandbox('goToEnv')}
              icon={IconScreen}
              onClick={() => changeTab('analise')}
            />
          ))}
        {canTriage &&
          entry.type === 'FILE' &&
          sandboxQuery.data?.enabled &&
          !entry.filePurgedAt &&
          !sandboxActive && (
            <HpsmToolbarButton
              label={tSandbox('openEnv')}
              icon={IconScreen}
              onClick={() => {
                setPinNotice(null);
                setLaunchOpen(true);
              }}
            />
          )}
        {position >= 0 && sequence.length > 1 && (
          <>
            <HpsmToolbarDivider />
            <HpsmToolbarButton
              label={tr('prevRecord')}
              title={tr('prevRecordHelp')}
              disabled={position === 0}
              onClick={() => goToEntry(sequence[position - 1])}
            />
            <HpsmToolbarButton
              label={tr('nextRecord')}
              title={tr('nextRecordHelp')}
              disabled={position === sequence.length - 1}
              onClick={() => goToEntry(sequence[position + 1])}
            />
          </>
        )}
        {/* Item 122: so quem enviou e os analistas. */}
        {canDownload && (
          <>
            <HpsmToolbarDivider />
            {/* Plano pos-revisao, item 2.1: ZIP com a senha "infected"; o original fica no Mais. */}
            <HpsmToolbarButton
              label={tr('downloadSample')}
              icon={IconDownload}
              href={`/api/entries/${entry.id}/download?format=zip`}
              disabled={!entry.storageKey}
              title={entry.filePurgedAt ? tr('filePurged') : tr('downloadZipHelp')}
            />
            {entry.storageKey && !entry.filePurgedAt && (
              <span className="hpsm-toolbar__note">{tr('zipPassword')}</span>
            )}
          </>
        )}
        <HpsmToolbarDivider />
        <HpsmToolbarMenu
          label={tr('more')}
          items={[
            {
              label: tr('copyLink'),
              icon: IconCopy,
              action: async () => {
                const ok = await copyText(`${window.location.origin}/entries/${entry.id}`);
                setPinNotice(
                  ok
                    ? { ok: true, text: tr('linkCopied') }
                    : { ok: false, text: tr('linkCopyFailed') },
                );
              },
            },
            {
              label: tr('openNewWindow'),
              icon: IconScreen,
              action: () => window.open(`/entries/${entry.id}`, '_blank', 'noopener'),
            },
            ...(canTriage
              ? [
                  entry.duplicateOf
                    ? {
                        label: tr('undoDuplicate'),
                        separated: true,
                        action: () => void undoDuplicate(),
                      }
                    : {
                        label: tr('markDuplicate'),
                        separated: true,
                        action: () => setDupOpen(true),
                      },
                  { label: tr('compareWith'), action: () => setCompareOpen(true) },
                  { label: tr('addToCase'), action: () => setCaseOpen(true) },
                  { label: tr('decodeText'), action: () => decode() },
                ]
              : []),
            ...(canDownload
              ? [
                  {
                    label: tr('downloadOriginal'),
                    icon: IconDownload,
                    separated: true,
                    disabled: !entry.storageKey,
                    action: () => void downloadOriginal(),
                  },
                ]
              : []),
            {
              label: tr('printRecord'),
              icon: IconPrint,
              separated: true,
              action: () => window.open(`/entries/${entry.id}/imprimir?auto=1`, '_blank'),
            },
            {
              label: tr('exportReportsMd'),
              icon: IconDownload,
              disabled: !reports.some((r) => r.status === 'PUBLISHED'),
              action: async () => {
                // Analistas levam junto o resumo da ultima execucao no ambiente isolado.
                const run = canTriage ? await latestRunSummary(entry.id).catch(() => null) : null;
                downloadText(
                  `deeplook-${entry.id}-relatorios.md`,
                  entryReportsMarkdown(
                    entry,
                    user?.displayName ?? '—',
                    run ? runSummaryMarkdown(run) : [],
                  ),
                );
              },
            },
            // IOCs dos relatorios publicados + o proprio arquivo/URL, gerados na API.
            ...(
              [
                ['csv', 'CSV'],
                ['stix', 'STIX 2.1'],
                ['misp', 'MISP'],
              ] as const
            ).map(([format, name], i) => ({
              label: tr('exportIocs', { name }),
              icon: IconDownload,
              separated: i === 0,
              action: () =>
                downloadUrl(
                  `/api/entries/${entry.id}/iocs/export?format=${format}&lang=${getLocale()}`,
                ),
            })),
            // Acao destrutiva por ultimo, separada das demais.
            ...(isAdmin
              ? [
                  {
                    label: tr('moveToTrashEllipsis'),
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
            {tr('recordOf', { n: position + 1, total: sequence.length })}
          </span>
        )}
      </HpsmToolbar>

      {launchOpen && (
        <SandboxLaunchDialog
          entryId={entry.id}
          sampleName={entry.originalFilename || entry.title}
          ttlMinutes={sandboxQuery.data?.ttlMinutes}
          captureEnabled={sandboxQuery.data?.captureEnabled}
          memoryDumpEnabled={sandboxQuery.data?.memoryDumpEnabled}
          onClose={() => setLaunchOpen(false)}
          onStarted={(result) => {
            changeTab('analise');
            if (result.kind === 'warning') {
              setPinNotice({ ok: false, text: result.text, warning: true });
            }
          }}
        />
      )}
      {caseOpen && (
        <AddToCaseDialog
          entryIds={[entry.id]}
          defaultTitle={entry.title}
          onClose={(result) => {
            setCaseOpen(false);
            if (!result) return;
            setPinNotice({
              ok: true,
              text: result.created
                ? tr('caseCreatedThis', { code: result.code })
                : tr('addedToCase', { code: result.code }),
            });
          }}
        />
      )}
      {compareOpen && (
        <EntryPickDialog
          entryId={entry.id}
          title={tr('compareTitle')}
          message={tr('compareMessage')}
          legend={tr('compareLegend')}
          otherLabel={tr('compareOther')}
          submitLabel={tr('compare')}
          busyLabel={tr('opening')}
          emptyChoice={tr('compareEmpty')}
          onPick={async (target) => {
            if (target === entry.id) return tr('compareDifferent');
            setCompareOpen(false);
            navigate(`/comparar?a=${entry.id}&b=${encodeURIComponent(target)}`);
            return null;
          }}
          onClose={() => setCompareOpen(false)}
        />
      )}
      {dupOpen && (
        <DuplicateDialog
          entryId={entry.id}
          excludeIds={(entry.duplicates ?? []).map((d) => d.id)}
          onClose={(principal) => {
            setDupOpen(false);
            if (!principal) return;
            void reloadAfterDuplicate();
            setPinNotice({ ok: true, text: tr('markedDuplicate', { title: principal.title }) });
          }}
        />
      )}

      <DisguisedFileWarning info={entry.staticInfo} />
      <DocumentWarning info={entry.staticInfo} />
      <DeliveryWarning info={entry.staticInfo} />
      <ScriptWarning info={entry.staticInfo} />
      <LnkWarning info={entry.staticInfo} />
      <LookalikeWarning hits={entry.lookalikeHits} />

      {entry.integrityFailedAt && (
        <HpsmMessage kind="error">
          {tr('integrityBanner', { date: fmtDate(entry.integrityFailedAt) })}
        </HpsmMessage>
      )}

      {pinNotice && (
        <HpsmMessage
          key={pinNotice.text}
          kind={pinNotice.warning ? 'warning' : pinNotice.ok ? 'success' : 'error'}
        >
          {pinNotice.text}
        </HpsmMessage>
      )}

      {showCountdown && minutesLeft <= 5 && (
        <HpsmMessage kind="warning">
          {tr('sandboxExpires', { n: minutesLeft })}
          <button
            type="button"
            className="dl-link-button"
            disabled={extending}
            onClick={extendSandbox}
          >
            {extending ? tr('extending') : tr('extendTime')}
          </button>
        </HpsmMessage>
      )}

      <PageHeader title={entry.title} />
      <div className="dl-summary">
        <span>
          <span className="dl-summary__label">{tr('sumType')}</span> <TypeTag type={entry.type} />
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumAssignee')}</span>{' '}
          {entry.assignee?.displayName ?? '—'}
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumStatus')}</span>{' '}
          <StatusTag status={entry.status} />
        </span>
        {entry.status !== 'COMPLETED' && entry.statusChangedAt && (
          <span>
            <span className="dl-summary__label">{tr('sumAge')}</span>{' '}
            <AgeText entry={entry} sla={query.data?.sla} />
          </span>
        )}
        <span>
          <span className="dl-summary__label">{tr('sumPriority')}</span>{' '}
          <PriorityTag priority={entry.priority} />
        </span>
        <span>
          <span className="dl-summary__label">{tr('sumVerdict')}</span>{' '}
          <VerdictTag verdict={entry.verdict} />
        </span>
        {entry.duplicateOf && (
          <span>
            <span className="dl-summary__label">{tr('sumDuplicateOf')}</span>{' '}
            <Link className="dl-link" to={`/entries/${entry.duplicateOf.id}`}>
              {entry.duplicateOf.title}
            </Link>
          </span>
        )}
        {(entry._count?.duplicates ?? 0) > 0 && (
          <span>
            <span className="dl-summary__label">{tr('sumDuplicates')}</span>{' '}
            {entry._count?.duplicates}
          </span>
        )}
        {antivirus?.enabled && antivirus.scan?.status === 'INFECTED' && (
          <span>
            <span className="dl-summary__label">{tr('sumAntivirus')}</span>{' '}
            <StatusText tone="red">
              {tr('infected', { signature: antivirus.scan.signature })}
            </StatusText>
          </span>
        )}
        {yara?.scan?.status === 'MATCHED' && (
          <span>
            <span className="dl-summary__label">YARA:</span>{' '}
            <StatusText tone="red">
              {yara.scan.matches
                .slice(0, 3)
                .map((m) => m.identifier)
                .join(', ')}
              {yara.scan.matches.length > 3 ? ` (+${yara.scan.matches.length - 3})` : ''}
            </StatusText>
          </span>
        )}
        {(entryCases.data?.cases.length ?? 0) > 0 && (
          <span className="dl-summary__cases">
            <span className="dl-summary__label">{tr('sumCases')}</span>{' '}
            {entryCases.data!.cases.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Link className="dl-link" to={caseHref(c.id)} title={c.title}>
                  {c.code}
                </Link>
              </span>
            ))}
          </span>
        )}
        {entry.parentEntry && (
          <span>
            <span className="dl-summary__label">
              {/* Item 84: filha de imagem de disco e "extraida"; de e-mail, "anexo". */}
              {/\.eml$/i.test(entry.parentEntry.originalFilename ?? '.eml')
                ? tr('attachmentOf')
                : tr('extractedFrom')}
            </span>{' '}
            <Link className="dl-link" to={`/entries/${entry.parentEntry.id}`}>
              {entry.parentEntry.title}
            </Link>
          </span>
        )}
        {attackIds.length > 0 && (
          <span className="dl-summary__attack">
            <span className="dl-summary__label">ATT&amp;CK:</span>{' '}
            {attackIds.slice(0, 4).map((techniqueId, i) => (
              <span key={techniqueId}>
                {i > 0 && ', '}
                <Link className="dl-link dl-mono" to={attackHref(techniqueId)}>
                  {techniqueId}
                </Link>
              </span>
            ))}
            {attackIds.length > 4 && ` (+${attackIds.length - 4})`}
          </span>
        )}
        {reputation && (
          <span>
            <span className="dl-summary__label">{tr('sumReputation')}</span>{' '}
            <StatusText tone={reputation.tone}>{reputation.text}</StatusText>
          </span>
        )}
        {entry.filePurgedAt && (
          <span>
            <span className="dl-summary__label">{tr('sumFile')}</span>{' '}
            {tr('purgedOn', {
              date: new Date(entry.filePurgedAt).toLocaleDateString(intlLocale()),
            })}
          </span>
        )}
        {entry.tags.length > 0 && (
          <span>
            <span className="dl-summary__label">{tr('sumTags')}</span>{' '}
            {entry.tags.map((t) => t.name).join(', ')}
          </span>
        )}
      </div>
      <ResolutionNotice resolution={entry.resolution} verdict={entry.verdict} />
      {!canTriage && (
        <EntryStatusNotice
          type={entry.type}
          status={entry.status}
          verdict={entry.verdict}
          resolution={entry.resolution}
          isOwner={entry.owner.id === user?.id}
        />
      )}

      <HpsmTabs ariaLabel={tr('sampleAria')} active={activeTab} onChange={changeTab} items={tabs} />

      {activeTab === 'detalhes' && (
        <div className="hpsm-tabpanel">
          {(entry.duplicates?.length ?? 0) > 0 && (
            <HpsmSection
              title={tr('duplicatesCount', {
                n: entry._count?.duplicates ?? entry.duplicates?.length,
              })}
            >
              <ul className="dl-dup-list">
                {entry.duplicates?.map((d) => (
                  <li key={d.id}>
                    <Link className="dl-link" to={`/entries/${d.id}`}>
                      {d.title}
                    </Link>{' '}
                    <span className="dl-dup-list__date">
                      {tr('submittedOn', { date: fmtDate(d.createdAt) })}
                    </span>
                  </li>
                ))}
              </ul>
            </HpsmSection>
          )}
          <HpsmSection title={tr('submission')}>
            <HpsmForm columns={2}>
              <HpsmField label={tr('colOwner')}>
                <HpsmReadonly>
                  {entry.owner.displayName}
                  {entry.owner.email && ` (${entry.owner.email})`}
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('colType')}>
                <HpsmReadonly>
                  {entry.type === 'FILE' ? tr('typeFile') : tr('typeUrl')}
                </HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('submittedAt')}>
                <HpsmReadonly>{fmtDate(entry.createdAt)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('updatedAt')}>
                <HpsmReadonly>{fmtDate(entry.updatedAt)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('description')} wide top>
                <HpsmReadonly multiline>{entry.description || '—'}</HpsmReadonly>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>

          {entry.type === 'FILE' ? (
            <HpsmSection title={tr('fileSection')} defaultOpen={canTriage}>
              <HpsmForm columns={2}>
                <HpsmField label={tr('fileName')}>
                  <HpsmReadonly>{entry.originalFilename || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField label={tr('size')}>
                  <HpsmReadonly>{formatFileSize(entry.fileSize)}</HpsmReadonly>
                </HpsmField>
                <HpsmField label={tr('mimeType')}>
                  <HpsmReadonly>{entry.mimeType || '—'}</HpsmReadonly>
                </HpsmField>
                {entry.sha256 && !entry.filePurgedAt && (
                  <HpsmField label={tr('integrity')}>
                    <HpsmReadonly>
                      {entry.integrityFailedAt
                        ? tr('integrityFailed', { date: fmtDate(entry.integrityFailedAt) })
                        : entry.integrityCheckedAt
                          ? tr('integrityChecked', { date: fmtDate(entry.integrityCheckedAt) })
                          : tr('integrityPending')}
                    </HpsmReadonly>
                  </HpsmField>
                )}
                {entry.filePurgedAt && (
                  <HpsmField label={tr('storage')} wide>
                    <HpsmReadonly>
                      {query.data?.retentionDays
                        ? tr('purgedStorageDays', {
                            date: fmtDate(entry.filePurgedAt),
                            days: query.data.retentionDays,
                          })
                        : tr('purgedStorage', { date: fmtDate(entry.filePurgedAt) })}
                    </HpsmReadonly>
                  </HpsmField>
                )}
                <HpsmField label="SHA-256" wide help={tr('maliciousWarning')}>
                  <HpsmReadonly
                    mono
                    copyable={entry.sha256 ? { value: entry.sha256, label: 'SHA-256' } : undefined}
                  >
                    {entry.sha256 || '—'}
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField label="TLSH" wide help={tr('tlshHelp')}>
                  <HpsmReadonly
                    mono={Boolean(entry.tlsh)}
                    copyable={entry.tlsh ? { value: `T1${entry.tlsh}`, label: 'TLSH' } : undefined}
                  >
                    {entry.tlsh
                      ? `T1${entry.tlsh}`
                      : entry.tlsh === ''
                        ? tr('tlshNone')
                        : tr('computing')}
                  </HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </HpsmSection>
          ) : null}
          {/* Conteudo do arquivo em hexa: so analistas (a rota /hex e deles). */}
          {entry.type === 'FILE' && canTriage && (
            <HexViewer entryId={entry.id} purged={Boolean(entry.filePurgedAt)} />
          )}
          {entry.type === 'FILE' && <ChannelsSection entryId={entry.id} />}
          {entry.type === 'FILE' && (
            <StaticAnalysisSection
              entryId={entry.id}
              info={entry.staticInfo}
              canTriage={canTriage}
              canDownload={canDownload && !entry.filePurgedAt}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          {entry.type === 'FILE' && (
            <CapaSection
              entryId={entry.id}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          {entry.type === 'FILE' && <UnpackSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <GhidraSection entryId={entry.id} canTriage={canTriage} />}
          {/* Emulacao, configuracao de familias e APK (plans/novas-analises, itens 4, 2 e 6). */}
          {entry.type === 'FILE' && <EmulationSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <ConfigSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <AndroidSection entryId={entry.id} canTriage={canTriage} />}
          {/* Descompilacao de .NET (plans/caca-e-formatos, item 3). */}
          {entry.type === 'FILE' && <DotnetSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <JarSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <JsdeobSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <MetadataSection entryId={entry.id} canTriage={canTriage} />}
          {entry.type === 'FILE' && <DocumentSection info={entry.staticInfo} />}
          {/* OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4). */}
          {entry.type === 'FILE' && <DeliverySection info={entry.staticInfo} />}
          {entry.type === 'FILE' && <OfficeSection entryId={entry.id} canTriage={canTriage} />}
          {/* QR code na imagem, no PDF ou no print da pagina (plano pos-revisao, item 2.2). */}
          <QrSection entry={entry} canTriage={canTriage} />
          {entry.type === 'FILE' && <ScriptSection info={entry.staticInfo} />}
          {entry.type === 'FILE' && <LnkSection info={entry.staticInfo} />}
          {entry.type === 'FILE' && (
            <DiskImageSection
              entryId={entry.id}
              info={entry.staticInfo}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          {entry.type !== 'FILE' && (
            <HpsmSection title={tr('linkSection')}>
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
          {entry.emailInfo && <EmailSection info={entry.emailInfo} />}
          {canTriage && <RiskSection entryId={entry.id} />}
          {entry.type === 'FILE' && (
            <AntivirusSection
              entryId={entry.id}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          {entry.type === 'FILE' && (
            <YaraSection
              entryId={entry.id}
              canTriage={canTriage}
              purged={Boolean(entry.filePurgedAt)}
            />
          )}
          <ReputationSection entryId={entry.id} canTriage={canTriage} />
          {entry.type === 'URL' && <PageCaptureSection entryId={entry.id} canTriage={canTriage} />}
        </div>
      )}

      {canTriage && (
        <div className="hpsm-tabpanel" hidden={activeTab !== 'analise'}>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          {saved && <HpsmMessage kind="success">{tr('recordUpdated')}</HpsmMessage>}

          <HpsmSection title={tr('triage')}>
            <HpsmForm columns={2}>
              <HpsmField label={tr('colStatus')} htmlFor="triage-status">
                <Select
                  id="triage-status"
                  labelText={tr('colStatus')}
                  hideLabel
                  value={entry.status}
                  onChange={(e) => quickUpdate({ status: e.target.value })}
                >
                  <SelectItem value="PENDING" text={tr('stPending')} />
                  <SelectItem value="IN_REVIEW" text={tr('stInReview')} />
                  <SelectItem value="COMPLETED" text={tr('stCompleted')} />
                </Select>
              </HpsmField>
              <HpsmField label={tr('colVerdict')} htmlFor="triage-verdict">
                <Select
                  id="triage-verdict"
                  labelText={tr('colVerdict')}
                  hideLabel
                  value={entry.verdict}
                  onChange={(e) => quickUpdate({ verdict: e.target.value })}
                >
                  <SelectItem value="UNKNOWN" text={tr('vUnknown')} />
                  <SelectItem value="CLEAN" text={tr('vClean')} />
                  <SelectItem value="SUSPICIOUS" text={tr('vSuspicious')} />
                  <SelectItem value="MALICIOUS" text={tr('vMalicious')} />
                </Select>
              </HpsmField>
              <HpsmField
                label={tr('colPriority')}
                htmlFor="triage-priority"
                help={
                  query.data?.sla?.byPriority
                    ? tr('slaHelp', {
                        warn: query.data.sla.byPriority[entry.priority ?? 'P3'].warnHours,
                        late: query.data.sla.byPriority[entry.priority ?? 'P3'].lateHours,
                      })
                    : undefined
                }
              >
                <Select
                  id="triage-priority"
                  labelText={tr('colPriority')}
                  hideLabel
                  value={entry.priority ?? 'P3'}
                  onChange={(e) => quickUpdate({ priority: e.target.value })}
                >
                  <SelectItem value="P1" text={tr('p1')} />
                  <SelectItem value="P2" text={tr('p2')} />
                  <SelectItem value="P3" text={tr('p3')} />
                  <SelectItem value="P4" text={tr('p4')} />
                </Select>
              </HpsmField>
              <HpsmField label={tr('colAssignee')} htmlFor="triage-assignee">
                <Select
                  id="triage-assignee"
                  labelText={tr('colAssignee')}
                  hideLabel
                  value={entry.assignee?.id ?? ''}
                  onChange={(e) => quickUpdate({ assigneeId: e.target.value || null })}
                >
                  <SelectItem value="" text={tr('noAssigneeOption')} />
                  {(analystsQuery.data?.analysts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id} text={a.displayName} />
                  ))}
                </Select>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
          {/* key: o rascunho e de uma amostra; a do cache nao passa pelo "carregando". */}
          <ResolutionForm
            key={entry.id}
            resolution={entry.resolution}
            onSave={(resolution) => quickUpdate({ resolution })}
          />

          {entry.type === 'FILE' && (
            <SandboxPanel
              entryId={entry.id}
              purgedNote={entry.filePurgedAt ? tr('sandboxPurged') : undefined}
            />
          )}
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
            suggestedIocs={suggestedIocs}
            suggestedAttack={capa?.analysis?.attack ?? []}
          />
        </div>
      )}

      {activeTab === 'relacionadas' && (
        <div className="hpsm-tabpanel">
          <EntryRelatedTab entryId={id} />
        </div>
      )}

      {activeTab === 'mapa' && (
        <div className="hpsm-tabpanel">
          <RelationMap source="entry" id={id} />
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
