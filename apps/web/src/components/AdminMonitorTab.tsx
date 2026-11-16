import {
  Button,
  Checkbox,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type {
  MonitorHistory,
  MonitorJobs,
  MonitorQueue,
  MonitorQueueId,
  MonitorSnapshot,
  StatusLevel,
} from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/admin';
import { useConfirm, usePrompt } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconRefresh } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { MonitorChart } from './MonitorChart';
import { StatusText, type StatusTone } from './tags';

/** A foto e relida a cada 10 s enquanto a aba esta aberta (e visivel). */
const REFRESH_MS = 10_000;

const SERVICE_TONE: Record<StatusLevel, StatusTone> = {
  ok: 'green',
  warn: 'orange',
  error: 'red',
  off: 'gray',
};

const queueName = (id: MonitorQueueId) => t(`q.${id}`);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)}%`;
const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' })
    : '—';

/** Duracao legivel: "850 ms", "12 s", "3 min", "2 h 5 min", "3 d 4 h". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Aba "Monitoramento" da Administracao (plans/monitoramento): os ambientes do sandbox (encerrar um,
 * varios ou todos), as filas de analise (pausar, cancelar e refazer trabalhos), a propria API e o
 * historico das metricas. So para administradores.
 */
export function AdminMonitorTab() {
  const [notice, setNotice] = useState<{ ok: boolean; text: string; at: number } | null>(null);
  const onNotice: Notice = (n) => setNotice({ ...n, at: Date.now() });
  const query = useQuery({
    queryKey: ['admin', 'monitor'],
    queryFn: () => api.get<MonitorSnapshot>('/admin/monitor'),
    // O react-query nao rele com a aba do navegador escondida.
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;
  return (
    <>
      <HpsmToolbar label={t('monActions')}>
        <HpsmToolbarButton
          label={query.isFetching ? t('checking') : t('refresh')}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
        {data && (
          <span className="hpsm-toolbar__info">
            {t('monCheckedAt', {
              time: new Date(data.checkedAt).toLocaleTimeString(intlLocale()),
            })}
          </span>
        )}
      </HpsmToolbar>
      {notice && (
        // Remonta a cada aviso: o "fechar" de um nao esconde o proximo.
        <HpsmMessage key={notice.at} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text={t('monLoading')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('monError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {data && (
        <>
          <SandboxBlock snapshot={data} onNotice={onNotice} />
          <QueuesBlock queues={data.queues} onNotice={onNotice} />
          <PlatformBlock platform={data.platform} />
          <HistoryBlock
            limit={data.sandbox.enabled ? data.sandbox.limit : null}
            sandbox={data.sandbox.enabled}
          />
        </>
      )}
    </>
  );
}

type Notice = (n: { ok: boolean; text: string }) => void;

// ------------------------------------------------------------------------------- sandbox

function SandboxBlock({ snapshot, onNotice }: { snapshot: MonitorSnapshot; onNotice: Notice }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const sandbox = snapshot.sandbox;
  if (!sandbox.enabled) {
    return (
      <HpsmSection title={t('monSandbox')}>
        <p className="dl-hint-muted">{t('monSandboxOff')}</p>
      </HpsmSection>
    );
  }
  const sessions = sandbox.sessions;
  const live = new Set(sessions.map((s) => s.id));
  const chosen = [...selected].filter((id) => live.has(id));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'monitor'] });
  const stop = async (ids: string[] | 'all') => {
    const n = ids === 'all' ? sessions.length : ids.length;
    if (ids === 'all') {
      const typed = await prompt({
        title: t('monStopAllTitle'),
        message: t('monStopAllMsg', { n }),
        label: t('monStopAllLabel'),
        maxLength: 6,
        confirmLabel: t('monStopAll'),
      });
      if (typed === null) return;
      if (typed.trim() !== String(n)) {
        onNotice({ ok: false, text: t('monStopAllMismatch') });
        return;
      }
    }
    const reason = await prompt({
      title: t('monStopTitle'),
      message: t('monStopMsg', { n }),
      label: t('monStopReason'),
      maxLength: 300,
      optional: true,
      confirmLabel: t('monStop'),
    });
    if (reason === null) return;
    setBusy(true);
    try {
      const res = await api.post<{ stopped: number; failed: number }>(
        '/admin/monitor/sandbox/stop',
        {
          ...(ids === 'all' ? { all: true } : { ids }),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      setSelected(new Set());
      onNotice({
        ok: res.failed === 0,
        text: res.failed
          ? t('monStoppedFailed', { n: res.stopped, failed: res.failed })
          : t('monStopped', { n: res.stopped }),
      });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const sweep = async () => {
    if (!(await confirm({ title: t('monSweepTitle'), message: t('monSweepMsg'), danger: true }))) {
      return;
    }
    try {
      const res = await api.post<{ vms: number; isos: number }>(
        '/admin/monitor/sandbox/orphans/sweep',
        {},
      );
      onNotice({ ok: true, text: t('monSwept', res) });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    } finally {
      await refresh();
    }
  };

  const node = sandbox.node;
  const now = Date.now();
  return (
    <HpsmSection title={t('monSandbox')}>
      <ul className="dl-monitor__facts">
        <li>
          {t('monUsage', { n: sessions.length, limit: sandbox.limit, per: sandbox.perUserLimit })}
        </li>
        <li>
          <span className="dl-monitor__label">{t('monNode')}:</span>{' '}
          {node.available
            ? t('monNodeStats', {
                cpu: pct(node.cpu),
                mem: formatFileSize(node.memUsed),
                memTotal: formatFileSize(node.memTotal),
                memPct: pct(node.memUsed && node.memTotal ? node.memUsed / node.memTotal : null),
                disk: formatFileSize(node.diskUsed),
                diskTotal: formatFileSize(node.diskTotal),
              })
            : node.reason === 'permission'
              ? t('monNodePermission')
              : t('monNodeError')}
        </li>
        <li>
          {sandbox.orphans ? (
            <>
              {t('monOrphans', sandbox.orphans)}
              {(sandbox.orphans.vms > 0 || sandbox.orphans.isos > 0) && (
                <>
                  {' '}
                  <button type="button" className="dl-link-button" onClick={() => void sweep()}>
                    {t('monSweep')}
                  </button>
                </>
              )}
            </>
          ) : (
            t('monOrphansUnknown')
          )}
        </li>
      </ul>
      {sessions.length === 0 ? (
        <p className="dl-hint-muted">{t('monNoSessions')}</p>
      ) : (
        <>
          <div className="dl-monitor__bar">
            <Button
              size="sm"
              kind="tertiary"
              disabled={busy || chosen.length === 0}
              onClick={() => void stop(chosen)}
            >
              {t('monStopSelected', { n: chosen.length })}
            </Button>
            <Button
              size="sm"
              kind="danger--tertiary"
              disabled={busy}
              onClick={() => void stop('all')}
            >
              {t('monStopAll')}
            </Button>
          </div>
          <TableContainer>
            <Table size="xs" aria-label={t('monSessionsAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">
                    <Checkbox
                      id="mon-select-all"
                      labelText={t('monSelectAll')}
                      hideLabel
                      checked={chosen.length === sessions.length}
                      indeterminate={chosen.length > 0 && chosen.length < sessions.length}
                      onChange={(_, { checked }) =>
                        setSelected(checked ? new Set(sessions.map((s) => s.id)) : new Set())
                      }
                    />
                  </TableHeader>
                  <TableHeader scope="col">{t('monSample')}</TableHeader>
                  <TableHeader scope="col">{t('monAnalyst')}</TableHeader>
                  <TableHeader scope="col">{t('monPhase')}</TableHeader>
                  <TableHeader scope="col">{t('monSince')}</TableHeader>
                  <TableHeader scope="col">{t('monExpires')}</TableHeader>
                  <TableHeader scope="col">{t('monVm')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => {
                  const left = Math.round((new Date(s.expiresAt).getTime() - now) / 60_000);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Checkbox
                          id={`mon-select-${s.id}`}
                          labelText={t('monSelectOne', { title: s.entry.title })}
                          hideLabel
                          checked={selected.has(s.id)}
                          onChange={(_, { checked }) => {
                            const next = new Set(selected);
                            if (checked) next.add(s.id);
                            else next.delete(s.id);
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Link to={`/entries/${s.entry.id}?execucao=${s.id}`}>{s.entry.title}</Link>
                      </TableCell>
                      <TableCell>
                        {s.analyst.displayName}
                        {s.analystAtLimit && (
                          <>
                            {' '}
                            <StatusText tone="orange">{t('monAtLimit')}</StatusText>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.status}
                        {s.phase ? ` · ${s.phase}` : ''}
                      </TableCell>
                      <TableCell>{fmtTime(s.startedAt ?? s.createdAt)}</TableCell>
                      <TableCell>
                        {left < 0 ? (
                          <StatusText tone="red">{t('monExpired')}</StatusText>
                        ) : left < 10 ? (
                          <StatusText tone="orange">{t('monExpiresIn', { n: left })}</StatusText>
                        ) : (
                          t('monExpiresIn', { n: left })
                        )}
                      </TableCell>
                      <TableCell>
                        {s.vm
                          ? t('monVmStats', {
                              cpu: pct(s.vm.cpu),
                              mem: formatFileSize(s.vm.mem),
                              max: formatFileSize(s.vm.maxmem),
                            })
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          kind="danger--tertiary"
                          disabled={busy}
                          onClick={() => void stop([s.id])}
                        >
                          {t('monStop')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </HpsmSection>
  );
}

// --------------------------------------------------------------------------------- filas

function QueuesBlock({ queues, onNotice }: { queues: MonitorQueue[]; onNotice: Notice }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<MonitorQueueId | null>(null);
  const now = Date.now();
  const togglePause = async (q: MonitorQueue) => {
    try {
      await api.patch(`/admin/monitor/queues/${q.id}`, { paused: !q.paused });
      onNotice({
        ok: true,
        text: t(q.paused ? 'monResumedMsg' : 'monPausedMsg', { queue: queueName(q.id) }),
      });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'monitor'] });
    }
  };
  return (
    <HpsmSection title={t('monQueues')}>
      <p className="dl-hint-muted">{t('monQueuesHelp')}</p>
      <TableContainer>
        <Table size="xs" aria-label={t('monQueuesAria')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('monQueue')}</TableHeader>
              <TableHeader scope="col">{t('monService')}</TableHeader>
              <TableHeader scope="col">{t('monPending')}</TableHeader>
              <TableHeader scope="col">{t('monRunning')}</TableHeader>
              <TableHeader scope="col">{t('monDone24')}</TableHeader>
              <TableHeader scope="col">{t('monFailed24')}</TableHeader>
              <TableHeader scope="col">{t('monTimes')}</TableHeader>
              <TableHeader scope="col">{t('monQueueState')}</TableHeader>
              <TableHeader scope="col">{t('actions')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {queues.map((q) => (
              <TableRow
                key={q.id}
                className={q.paused ? 'dl-status-row dl-status-row--warn' : undefined}
              >
                <TableCell>
                  <strong>{queueName(q.id)}</strong>
                </TableCell>
                <TableCell>
                  {q.service ? (
                    <StatusText tone={SERVICE_TONE[q.service.level]}>
                      {q.service.summary}
                    </StatusText>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {q.ready}
                  {q.scheduled > 0 && (
                    <span className="dl-hint-muted"> {t('monScheduled', { n: q.scheduled })}</span>
                  )}
                </TableCell>
                <TableCell>
                  {q.running}
                  {q.oldestRunningAt && (
                    <span className="dl-hint-muted">
                      {' '}
                      {t('monRunningFor', {
                        t: fmtDuration(now - new Date(q.oldestRunningAt).getTime()),
                      })}
                    </span>
                  )}
                </TableCell>
                <TableCell>{q.done24h}</TableCell>
                <TableCell>
                  {q.failed24h > 0 ? <StatusText tone="orange">{q.failed24h}</StatusText> : 0}
                </TableCell>
                <TableCell>
                  {q.avgMs === null ? '—' : `${fmtDuration(q.avgMs)} · ${fmtDuration(q.p95Ms)}`}
                </TableCell>
                <TableCell>
                  <StatusText tone={q.paused ? 'orange' : 'green'}>
                    {q.paused ? t('monPaused') : t('monActive')}
                  </StatusText>
                </TableCell>
                <TableCell>
                  <span className="dl-monitor__actions">
                    <Button size="sm" kind="tertiary" onClick={() => void togglePause(q)}>
                      {q.paused ? t('monResume') : t('monPause')}
                    </Button>
                    <Button
                      size="sm"
                      kind="ghost"
                      aria-expanded={open === q.id}
                      onClick={() => setOpen(open === q.id ? null : q.id)}
                    >
                      {open === q.id ? t('monHideJobs') : t('monJobs')}
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {open && <QueueJobs key={open} queue={open} onNotice={onNotice} />}
    </HpsmSection>
  );
}

function QueueJobs({ queue, onNotice }: { queue: MonitorQueueId; onNotice: Notice }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [state, setState] = useState<MonitorJobs['state']>('pending');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admin', 'monitor', 'jobs', queue, state, page],
    queryFn: () =>
      api.get<MonitorJobs>(`/admin/monitor/queues/${queue}/jobs?state=${state}&page=${page}`),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'monitor'] });

  const cancel = async (body: { ids: string[] } | { allPending: true }) => {
    if (
      !(await confirm({ title: t('monCancelTitle'), message: t('monCancelMsg'), danger: true }))
    ) {
      return;
    }
    try {
      const res = await api.post<{ pending: number; running: number }>(
        `/admin/monitor/queues/${queue}/cancel`,
        body,
      );
      onNotice({ ok: true, text: t('monCancelled', { n: res.pending + res.running }) });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    } finally {
      await refresh();
    }
  };
  const retry = async (body: { ids: string[] } | { failedSinceHours: number }) => {
    try {
      const res = await api.post<{ retried: number }>(`/admin/monitor/queues/${queue}/retry`, body);
      onNotice({ ok: true, text: t('monRetried', { n: res.retried }) });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    } finally {
      await refresh();
    }
  };

  return (
    <div className="dl-monitor__jobs">
      <h4 className="dl-static-title">{t('monJobsTitle', { queue: queueName(queue) })}</h4>
      <div className="dl-monitor__bar">
        <Select
          id="mon-jobs-state"
          labelText={t('monQueueState')}
          hideLabel
          size="sm"
          value={state}
          onChange={(e) => {
            setState(e.target.value as MonitorJobs['state']);
            setPage(1);
          }}
        >
          <SelectItem value="pending" text={t('monStatePending')} />
          <SelectItem value="running" text={t('monStateRunning')} />
          <SelectItem value="failed" text={t('monStateFailed')} />
        </Select>
        {state === 'pending' && (data?.total ?? 0) > 0 && (
          <Button
            size="sm"
            kind="danger--tertiary"
            onClick={() => void cancel({ allPending: true })}
          >
            {t('monCancelAll')}
          </Button>
        )}
        {state === 'failed' && (data?.total ?? 0) > 0 && (
          <Button size="sm" kind="tertiary" onClick={() => void retry({ failedSinceHours: 24 })}>
            {t('monRetry24')}
          </Button>
        )}
      </div>
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {!data ? (
        <HpsmLoading text={t('monLoading')} />
      ) : data.jobs.length === 0 ? (
        <p className="dl-hint-muted">{t('monNoJobs')}</p>
      ) : (
        <TableContainer>
          <Table size="xs" aria-label={t('monJobsAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('monSample')}</TableHeader>
                <TableHeader scope="col">{t('monAttempts')}</TableHeader>
                <TableHeader scope="col">
                  {state === 'failed'
                    ? t('monFinishedAt')
                    : state === 'running'
                      ? t('monStartedAt')
                      : t('monQueuedAt')}
                </TableHeader>
                {state === 'failed' && <TableHeader scope="col">{t('monReason')}</TableHeader>}
                <TableHeader scope="col">{t('actions')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    <Link to={`/entries/${j.entryId}`}>{j.entryTitle}</Link>
                  </TableCell>
                  <TableCell>{j.attempts}</TableCell>
                  <TableCell>
                    {fmtTime(
                      state === 'failed'
                        ? j.finishedAt
                        : state === 'running'
                          ? j.startedAt
                          : j.createdAt,
                    )}
                  </TableCell>
                  {state === 'failed' && (
                    <TableCell className="dl-break">{j.error ?? '—'}</TableCell>
                  )}
                  <TableCell>
                    {state === 'failed' ? (
                      <Button size="sm" kind="tertiary" onClick={() => void retry({ ids: [j.id] })}>
                        {t('monRetry')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        kind="danger--tertiary"
                        onClick={() => void cancel({ ids: [j.id] })}
                      >
                        {t('monCancel')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {pages > 1 && (
        <div className="dl-pager">
          <Button size="sm" kind="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('previous')}
          </Button>
          <span>{t('monPage', { page, pages })}</span>
          <Button
            size="sm"
            kind="tertiary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('next')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- plataforma

function PlatformBlock({ platform }: { platform: MonitorSnapshot['platform'] }) {
  const storage = platform.storage;
  const rows: [string, string][] = [
    [t('monApiUptime'), fmtDuration(platform.uptimeS * 1000)],
    [
      t('monApiMemory'),
      t('monApiMemoryValue', {
        rss: formatFileSize(platform.rss),
        heap: formatFileSize(platform.heapUsed),
        heapTotal: formatFileSize(platform.heapTotal),
      }),
    ],
    [t('monLoop'), t('monLoopValue', platform.loop)],
    [t('monWorkerRestarts'), String(platform.workerRestarts)],
    [
      t('monSigmaRetro'),
      platform.sigmaRetro.current
        ? t('monSigmaBusy', { rule: platform.sigmaRetro.current, n: platform.sigmaRetro.queued })
        : t('monSigmaIdle'),
    ],
    [t('monRetroscans'), String(platform.yaraRetroscans)],
    [t('monDb'), formatFileSize(platform.dbBytes)],
    [
      t('monStorage'),
      storage?.bytes !== undefined
        ? `${t('monStorageValue', {
            size: formatFileSize(storage.bytes),
            n: storage.objects ?? 0,
            time: fmtTime(storage.at),
          })}${storage.partial ? ` ${t('monStoragePartial')}` : ''}`
        : t('monStoragePending'),
    ],
  ];
  return (
    <HpsmSection title={t('monPlatform')}>
      <dl className="dl-monitor__platform">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}:</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </HpsmSection>
  );
}

// ----------------------------------------------------------------------------- historico

function HistoryBlock({ limit, sandbox }: { limit: number | null; sandbox: boolean }) {
  const [range, setRange] = useState<MonitorHistory['range']>('24h');
  const query = useQuery({
    queryKey: ['admin', 'monitor', 'history', range],
    queryFn: () => api.get<MonitorHistory>(`/admin/monitor/history?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = query.data;
  const series = (key: string) => data?.series[key] ?? [];
  /** A soma das filas por intervalo (as chaves queue.*). */
  const queued = () => {
    const sum = new Map<number, number>();
    for (const [key, points] of Object.entries(data?.series ?? {})) {
      if (!key.startsWith('queue.')) continue;
      for (const [time, v] of points) sum.set(time, (sum.get(time) ?? 0) + v);
    }
    return [...sum.entries()].sort((a, b) => a[0] - b[0]);
  };
  const until = Date.now();
  const since = data ? new Date(data.since).getTime() : until - 86_400_000;
  const int = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const charts: {
    key: string;
    title: string;
    points: [number, number][];
    format: (v: number) => string;
    reference?: { value: number; label: string };
  }[] = [
    ...(sandbox
      ? [
          {
            key: 'active',
            title: t('monChartActive'),
            points: series('sandbox.active'),
            format: int,
            reference: limit ? { value: limit, label: t('monChartLimit') } : undefined,
          },
        ]
      : []),
    { key: 'queued', title: t('monChartQueued'), points: queued(), format: int },
    { key: 'running', title: t('monChartRunning'), points: series('jobs.running'), format: int },
    { key: 'done', title: t('monChartDone'), points: series('jobs.done'), format: int },
    { key: 'failed', title: t('monChartFailed'), points: series('jobs.failed'), format: int },
    {
      key: 'rss',
      title: t('monChartRss'),
      points: series('api.rss').map(([time, v]) => [time, v / 1024 / 1024]),
      format: (v) => v.toFixed(0),
    },
    { key: 'loop', title: t('monChartLoop'), points: series('api.loopP99'), format: int },
    ...(series('node.cpu').length
      ? [
          {
            key: 'nodeCpu',
            title: t('monChartNodeCpu'),
            points: series('node.cpu').map(([time, v]): [number, number] => [time, v * 100]),
            format: (v: number) => v.toFixed(0),
          },
          {
            key: 'nodeMem',
            title: t('monChartNodeMem'),
            points: series('node.mem').map(([time, v]): [number, number] => [time, v * 100]),
            format: (v: number) => v.toFixed(0),
          },
        ]
      : []),
  ];
  const durations = Object.entries(data?.durations ?? {}) as [
    MonitorQueueId,
    NonNullable<MonitorHistory['durations'][MonitorQueueId]>,
  ][];
  const empty = data && Object.keys(data.series).length === 0;
  return (
    <HpsmSection title={t('monHistory')}>
      <div className="dl-monitor__bar">
        <Select
          id="mon-history-range"
          labelText={t('monRange')}
          hideLabel
          size="sm"
          value={range}
          onChange={(e) => setRange(e.target.value as MonitorHistory['range'])}
        >
          <SelectItem value="24h" text={t('monRange24h')} />
          <SelectItem value="7d" text={t('monRange7d')} />
        </Select>
      </div>
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {!data ? (
        <HpsmLoading text={t('monLoading')} />
      ) : empty ? (
        <p className="dl-hint-muted">{t('monNoSamples')}</p>
      ) : (
        <div className="dl-monitor__charts">
          {charts.map((c) => (
            <MonitorChart
              key={c.key}
              title={c.title}
              points={c.points}
              since={since}
              until={until}
              format={c.format}
              reference={c.reference}
            />
          ))}
        </div>
      )}
      <h4 className="dl-static-title">{t('monDurations')}</h4>
      {durations.length === 0 ? (
        <p className="dl-hint-muted">{t('monNoDurations')}</p>
      ) : (
        <TableContainer>
          <Table size="xs" aria-label={t('monDurationsAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('monQueue')}</TableHeader>
                <TableHeader scope="col">{t('monDay')}</TableHeader>
                <TableHeader scope="col">{t('monCount')}</TableHeader>
                <TableHeader scope="col">{t('monTimes')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {durations.flatMap(([queue, days]) =>
                days.map((d) => (
                  <TableRow key={`${queue}-${d.day}`}>
                    <TableCell>{queueName(queue)}</TableCell>
                    <TableCell>
                      {new Date(`${d.day}T12:00:00Z`).toLocaleDateString(intlLocale())}
                    </TableCell>
                    <TableCell>{d.n}</TableCell>
                    <TableCell>
                      {fmtDuration(d.avgMs)} · {fmtDuration(d.p95Ms)}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </HpsmSection>
  );
}
