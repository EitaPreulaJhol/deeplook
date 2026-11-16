import { monitorEventLoopDelay } from 'node:perf_hooks';

import { ListObjectsV2Command } from '@aws-sdk/client-s3';

import { env, sandboxEnabled } from '../env';
import { Prisma } from '../generated/prisma/client';
import {
  abortJob,
  CANCELLED_REASON,
  isQueuePaused,
  QUEUE_IDS,
  type QueueId,
  runningJobIds,
} from './job-control';
import { log, reason } from './log';
import { prisma } from './prisma';
import { pve, pveNode } from './proxmox';
import { s3 } from './s3';
import { ACTIVE_STATUSES, reconcileOrphans } from './sandbox';
import { sigmaRetroState } from './sigma-store';
import { analysisWorkerRestarts } from './static-analysis-thread';
import { cachedSystemStatus } from './status';

/**
 * Monitoramento (plans/monitoramento, itens 1, 3 e 5): a foto da operacao (ambientes do sandbox,
 * filas de analise e a propria API), as acoes do admin sobre as filas e o historico das metricas.
 *
 * As filas tem tabelas diferentes, mas o mesmo formato (status, tentativas, inicio, fim, tempo). O
 * descritor de cada uma diz as colunas; as consultas montam o SQL so com esses nomes fixos (nunca
 * com o que vem da requisicao).
 */

interface QueueTable {
  id: QueueId;
  table: string;
  enumType: string;
  /** Colunas (nomes do banco). */
  status: string;
  error: string;
  attempts: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string;
  ms: string | null;
  nextAttemptAt: string | null;
  /** Valores do status. */
  pending: string;
  running: string;
  failed: string;
  done: string;
  /** Filtro fixo da tabela (as quatro filas de servico dividem uma). */
  where?: string;
  /** A amostra vem direto (entryId) ou pela sessao do sandbox (sessionId). */
  owner: 'entry' | 'session';
  /** O que um trabalho falho precisa ter para ser refeito (o arquivo ainda guardado). */
  retryWhere?: string;
  /** A checagem do Status que diz se o servico da fila esta de pe. */
  statusCheck: string;
}

const standard = (
  id: QueueId,
  table: string,
  enumType: string,
  statusCheck: string,
  where?: string,
): QueueTable => ({
  id,
  table,
  enumType,
  status: 'status',
  error: 'error',
  attempts: 'attempts',
  createdAt: 'createdAt',
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',
  ms: 'ms',
  nextAttemptAt: 'nextAttemptAt',
  pending: 'PENDING',
  running: 'RUNNING',
  failed: 'FAILED',
  done: 'DONE',
  owner: 'entry',
  statusCheck,
  where,
});

const service = (id: QueueId, kind: string, statusCheck: string) =>
  standard(id, 'ServiceAnalysis', 'ServiceAnalysisStatus', statusCheck, `"kind" = '${kind}'`);

export const QUEUE_TABLES: Record<QueueId, QueueTable> = {
  capa: standard('capa', 'CapaAnalysis', 'CapaStatus', 'capa'),
  ghidra: standard('ghidra', 'GhidraAnalysis', 'GhidraStatus', 'ghidra'),
  unpack: standard('unpack', 'UnpackJob', 'UnpackStatus', 'unpack'),
  oletools: standard('oletools', 'OfficeAnalysis', 'OfficeStatus', 'oletools'),
  qr: standard('qr', 'QrScan', 'QrStatus', 'oletools'),
  emulation: service('emulation', 'EMULATION', 'emulate'),
  android: service('android', 'ANDROID', 'android'),
  config: service('config', 'CONFIG', 'extract'),
  dotnet: service('dotnet', 'DOTNET', 'dotnet'),
  suricata: {
    id: 'suricata',
    table: 'NetworkCapture',
    enumType: 'IdsStatus',
    status: 'idsStatus',
    error: 'idsError',
    attempts: 'idsAttempts',
    createdAt: 'idsQueuedAt',
    startedAt: 'idsStartedAt',
    finishedAt: 'idsFinishedAt',
    ms: 'idsMs',
    nextAttemptAt: 'idsNextAttemptAt',
    pending: 'PENDING',
    running: 'RUNNING',
    failed: 'FAILED',
    done: 'DONE',
    owner: 'session',
    retryWhere: '"storageKey" IS NOT NULL',
    statusCheck: 'suricata',
  },
  memdump: {
    id: 'memdump',
    table: 'SandboxMemoryDump',
    enumType: 'MemoryDumpStatus',
    status: 'status',
    error: 'error',
    attempts: 'attempts',
    createdAt: 'createdAt',
    startedAt: null,
    finishedAt: 'finishedAt',
    ms: null,
    nextAttemptAt: null,
    // Guardado e esperando a analise no extract; ANALYZING e o que esta no servico.
    pending: 'STORED',
    running: 'ANALYZING',
    failed: 'FAILED',
    done: 'DONE',
    owner: 'session',
    retryWhere: '"storageKey" IS NOT NULL',
    statusCheck: 'extract',
  },
};

const raw = Prisma.raw;
const col = (name: string) => raw(`"${name}"`);
const lit = (value: string) => raw(`'${value}'`);
const tableOf = (q: QueueTable) => raw(`"${q.table}"`);
const extra = (q: QueueTable) => raw(q.where ? `AND ${q.where}` : '');
const statusIs = (q: QueueTable, value: string) =>
  Prisma.sql`${col(q.status)}::text = ${lit(value)}`;

// ------------------------------------------------------------------------------- contagens

export interface QueueCounts {
  id: QueueId;
  paused: boolean;
  /** Pendentes prontos para pegar agora / com nova tentativa agendada. */
  ready: number;
  scheduled: number;
  running: number;
  oldestRunningAt: Date | null;
  oldestPendingAt: Date | null;
  done24h: number;
  failed24h: number;
  done1m: number;
  failed1m: number;
  avgMs: number | null;
  p95Ms: number | null;
}

async function countQueue(q: QueueTable): Promise<QueueCounts> {
  const next = q.nextAttemptAt ? col(q.nextAttemptAt) : raw('NULL::timestamp');
  const started = q.startedAt ? col(q.startedAt) : raw('NULL::timestamp');
  const ms = q.ms ? col(q.ms) : raw('NULL::int');
  const fin = col(q.finishedAt);
  const [row] = await prisma.$queryRaw<
    {
      ready: bigint;
      scheduled: bigint;
      running: bigint;
      oldest_running: Date | null;
      oldest_pending: Date | null;
      done24: bigint;
      failed24: bigint;
      done1: bigint;
      failed1: bigint;
      avg_ms: number | null;
      p95_ms: number | null;
    }[]
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE ${statusIs(q, q.pending)} AND (${next} IS NULL OR ${next} <= now())) AS ready,
      count(*) FILTER (WHERE ${statusIs(q, q.pending)} AND ${next} > now()) AS scheduled,
      count(*) FILTER (WHERE ${statusIs(q, q.running)}) AS running,
      min(${started}) FILTER (WHERE ${statusIs(q, q.running)}) AS oldest_running,
      min(${col(q.createdAt)}) FILTER (WHERE ${statusIs(q, q.pending)}) AS oldest_pending,
      count(*) FILTER (WHERE ${statusIs(q, q.done)} AND ${fin} >= now() - interval '24 hours') AS done24,
      count(*) FILTER (WHERE ${statusIs(q, q.failed)} AND ${fin} >= now() - interval '24 hours') AS failed24,
      count(*) FILTER (WHERE ${statusIs(q, q.done)} AND ${fin} >= now() - interval '1 minute') AS done1,
      count(*) FILTER (WHERE ${statusIs(q, q.failed)} AND ${fin} >= now() - interval '1 minute') AS failed1,
      avg(${ms}) FILTER (WHERE ${statusIs(q, q.done)} AND ${fin} >= now() - interval '24 hours')::float8 AS avg_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY ${ms})
        FILTER (WHERE ${statusIs(q, q.done)} AND ${fin} >= now() - interval '24 hours'))::float8 AS p95_ms
    FROM ${tableOf(q)}
    WHERE ${col(q.status)} IS NOT NULL ${extra(q)}
  `);
  const n = (v: bigint | undefined) => Number(v ?? 0);
  return {
    id: q.id,
    paused: isQueuePaused(q.id),
    ready: n(row?.ready),
    scheduled: n(row?.scheduled),
    running: n(row?.running),
    oldestRunningAt: row?.oldest_running ?? null,
    oldestPendingAt: row?.oldest_pending ?? null,
    done24h: n(row?.done24),
    failed24h: n(row?.failed24),
    done1m: n(row?.done1),
    failed1m: n(row?.failed1),
    avgMs: row?.avg_ms === null || row?.avg_ms === undefined ? null : Math.round(row.avg_ms),
    p95Ms: row?.p95_ms === null || row?.p95_ms === undefined ? null : Math.round(row.p95_ms),
  };
}

export const queueCounts = (): Promise<QueueCounts[]> =>
  Promise.all(QUEUE_IDS.map((id) => countQueue(QUEUE_TABLES[id])));

// --------------------------------------------------------------------------- trabalhos

export type JobState = 'pending' | 'running' | 'failed';
export const JOB_PAGE = 50;

export interface QueueJob {
  id: string;
  state: string;
  attempts: number;
  createdAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  entryId: string;
  entryTitle: string;
}

const stateValue = (q: QueueTable, state: JobState) =>
  state === 'pending' ? q.pending : state === 'running' ? q.running : q.failed;

/** Os trabalhos da fila num estado (os falhos, os mais recentes primeiro). */
export async function queueJobs(
  queue: QueueId,
  state: JobState,
  page: number,
): Promise<{ total: number; jobs: QueueJob[] }> {
  const q = QUEUE_TABLES[queue];
  const value = stateValue(q, state);
  const join =
    q.owner === 'entry'
      ? raw(`JOIN "Entry" e ON e."id" = t."entryId"`)
      : raw(
          `JOIN "SandboxSession" s ON s."id" = t."sessionId" JOIN "Entry" e ON e."id" = s."entryId"`,
        );
  const where = Prisma.sql`t.${col(q.status)}::text = ${lit(value)} ${raw(q.where ? `AND t.${q.where}` : '')}`;
  const order =
    state === 'failed'
      ? raw(`t."${q.finishedAt}" DESC NULLS LAST`)
      : raw(`t."${q.createdAt}" ASC NULLS LAST`);
  const [count] = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*) AS n FROM ${tableOf(q)} t WHERE ${where}`,
  );
  const rows = await prisma.$queryRaw<QueueJob[]>(Prisma.sql`
    SELECT t."id", t.${col(q.status)}::text AS state, t.${col(q.attempts)} AS attempts,
      t.${col(q.createdAt)} AS "createdAt",
      ${q.startedAt ? raw(`t."${q.startedAt}"`) : raw('NULL::timestamp')} AS "startedAt",
      t.${col(q.finishedAt)} AS "finishedAt", t.${col(q.error)} AS error,
      e."id" AS "entryId", e."title" AS "entryTitle"
    FROM ${tableOf(q)} t ${join}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${JOB_PAGE} OFFSET ${(page - 1) * JOB_PAGE}
  `);
  return { total: Number(count?.n ?? 0), jobs: rows };
}

/**
 * Cancela trabalhos: o pendente falha na hora, com o motivo; o em andamento tem o pedido ao servico
 * interrompido (a fila grava a falha). Em andamento que esta API nao esta rodando (reiniciou no
 * meio) falha direto. Sem `ids`, todos os pendentes da fila.
 */
export async function cancelJobs(
  queue: QueueId,
  ids: string[] | null,
): Promise<{ pending: number; running: number }> {
  const q = QUEUE_TABLES[queue];
  const only = ids ? Prisma.sql`AND "id" = ANY(${ids})` : Prisma.empty;
  const fail = Prisma.sql`${col(q.status)} = ${lit(q.failed)}::${raw(`"${q.enumType}"`)},
      ${col(q.error)} = ${CANCELLED_REASON}, ${col(q.finishedAt)} = now()`;
  const pending = await prisma.$executeRaw(Prisma.sql`
    UPDATE ${tableOf(q)} SET ${fail}
    WHERE ${statusIs(q, q.pending)} ${extra(q)} ${only}
  `);
  if (!ids) return { pending, running: 0 };
  let running = 0;
  const live = new Set(runningJobIds(queue));
  const stale: string[] = [];
  for (const id of ids) {
    if (live.has(id) && abortJob(queue, id)) running += 1;
    else stale.push(id);
  }
  if (stale.length) {
    running += await prisma.$executeRaw(Prisma.sql`
      UPDATE ${tableOf(q)} SET ${fail}
      WHERE ${statusIs(q, q.running)} ${extra(q)} AND "id" = ANY(${stale})
    `);
  }
  return { pending, running };
}

/** Volta trabalhos falhos para a fila, do zero. Sem `ids`, os que falharam desde `since`. */
export async function retryJobs(
  queue: QueueId,
  ids: string[] | null,
  since: Date,
): Promise<number> {
  const q = QUEUE_TABLES[queue];
  const which = ids
    ? Prisma.sql`AND "id" = ANY(${ids})`
    : Prisma.sql`AND ${col(q.finishedAt)} >= ${since}`;
  const sets = [
    Prisma.sql`${col(q.status)} = ${lit(q.pending)}::${raw(`"${q.enumType}"`)}`,
    Prisma.sql`${col(q.attempts)} = 0`,
    Prisma.sql`${col(q.error)} = NULL`,
    Prisma.sql`${col(q.finishedAt)} = NULL`,
    ...(q.startedAt ? [Prisma.sql`${col(q.startedAt)} = NULL`] : []),
    ...(q.nextAttemptAt ? [Prisma.sql`${col(q.nextAttemptAt)} = now()`] : []),
  ];
  return prisma.$executeRaw(Prisma.sql`
    UPDATE ${tableOf(q)} SET ${Prisma.join(sets)}
    WHERE ${statusIs(q, q.failed)} ${extra(q)} ${raw(q.retryWhere ? `AND ${q.retryWhere}` : '')} ${which}
  `);
}

// ------------------------------------------------------------------------------ sandbox

/** Promessa com prazo: o Proxmox lento nao segura a tela inteira. */
function within<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('sem resposta')), ms).unref()),
  ]);
}

interface VmStats {
  status: string | null;
  cpu: number | null;
  cpus: number | null;
  mem: number | null;
  maxmem: number | null;
  netin: number | null;
  netout: number | null;
}

async function vmStats(node: string, vmid: number): Promise<VmStats | null> {
  try {
    const s = await within(
      pve<Record<string, unknown>>(`/nodes/${node}/qemu/${vmid}/status/current`),
    );
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      status: typeof s?.status === 'string' ? s.status : null,
      cpu: num(s?.cpu),
      cpus: num(s?.cpus),
      mem: num(s?.mem),
      maxmem: num(s?.maxmem),
      netin: num(s?.netin),
      netout: num(s?.netout),
    };
  } catch {
    return null;
  }
}

export interface NodeStats {
  /** false: sem a permissao Sys.Audit no no (opcional; docs/proxmox.md). */
  available: boolean;
  reason: 'permission' | 'error' | null;
  cpu: number | null;
  memUsed: number | null;
  memTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
}

let nodeCache: { at: number; value: NodeStats } | null = null;

async function nodeStats(): Promise<NodeStats> {
  if (nodeCache && Date.now() - nodeCache.at < 10_000) return nodeCache.value;
  let value: NodeStats;
  try {
    const s = await within(
      pve<{
        cpu?: number;
        memory?: { used?: number; total?: number };
        rootfs?: { used?: number; total?: number };
      }>(`/nodes/${pveNode()}/status`),
    );
    value = {
      available: true,
      reason: null,
      cpu: s?.cpu ?? null,
      memUsed: s?.memory?.used ?? null,
      memTotal: s?.memory?.total ?? null,
      diskUsed: s?.rootfs?.used ?? null,
      diskTotal: s?.rootfs?.total ?? null,
    };
  } catch (err) {
    const status = (err as { pveStatus?: number | null }).pveStatus;
    value = {
      available: false,
      reason: status === 403 ? 'permission' : 'error',
      cpu: null,
      memUsed: null,
      memTotal: null,
      diskUsed: null,
      diskTotal: null,
    };
  }
  nodeCache = { at: Date.now(), value };
  return value;
}

let orphanCache: { at: number; value: { vms: number; isos: number } | null } | null = null;

/** VMs e ISOs orfaos desta instancia, pela regra da limpeza (so conta; cache de 1 min). */
async function orphans(): Promise<{ vms: number; isos: number } | null> {
  if (orphanCache && Date.now() - orphanCache.at < 60_000) return orphanCache.value;
  const value = await within(reconcileOrphans({ dryRun: true }), 10_000).catch(() => null);
  orphanCache = { at: Date.now(), value };
  return value;
}

/** Depois da limpeza manual, a contagem e refeita na proxima foto. */
export function forgetOrphanCount(): void {
  orphanCache = null;
}

async function sandboxSnapshot() {
  if (!sandboxEnabled) return { enabled: false as const };
  const sessions = await prisma.sandboxSession.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      phase: true,
      node: true,
      vmid: true,
      createdAt: true,
      startedAt: true,
      expiresAt: true,
      entry: { select: { id: true, title: true } },
      analyst: { select: { id: true, displayName: true } },
    },
  });
  const [stats, node, orphan] = await Promise.all([
    Promise.all(
      sessions.map((s) =>
        s.vmid && s.status === 'RUNNING' ? vmStats(s.node || pveNode(), s.vmid) : null,
      ),
    ),
    nodeStats(),
    orphans(),
  ]);
  const perAnalyst = new Map<string, number>();
  for (const s of sessions) perAnalyst.set(s.analyst.id, (perAnalyst.get(s.analyst.id) ?? 0) + 1);
  return {
    enabled: true as const,
    limit: env.SANDBOX_MAX_ACTIVE,
    perUserLimit: env.SANDBOX_MAX_PER_USER,
    sessions: sessions.map((s, i) => ({
      id: s.id,
      status: s.status,
      phase: s.phase,
      vmid: s.vmid,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
      entry: s.entry,
      analyst: s.analyst,
      analystAtLimit: (perAnalyst.get(s.analyst.id) ?? 0) >= env.SANDBOX_MAX_PER_USER,
      vm: stats[i],
    })),
    node,
    orphans: orphan,
  };
}

// ----------------------------------------------------------------------------- plataforma

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/** O atraso do event loop do ultimo minuto (lido pelo amostrador; ms). */
let lastLoop = { p50: 0, p99: 0 };

/** Atraso do event loop desde a ultima leitura (ms). */
function readLoopDelay(): { p50: number; p99: number } {
  return {
    p50: Math.round(loopDelay.percentile(50) / 1e6),
    p99: Math.round(loopDelay.percentile(99) / 1e6),
  };
}

/** Tamanho do armazenamento (MinIO): listar tudo e caro, entao fica 15 min em cache. */
const STORAGE_CACHE_MS = 15 * 60_000;
const STORAGE_MAX_OBJECTS = 200_000;
let storageCache: {
  at: number;
  value: { bytes: number; objects: number; partial: boolean } | null;
} | null = null;
let storageRunning: Promise<void> | null = null;

function refreshStorage(): void {
  if (storageRunning) return;
  storageRunning = (async () => {
    let bytes = 0;
    let objects = 0;
    let token: string | undefined;
    let partial = false;
    try {
      do {
        const page = await s3.send(
          new ListObjectsV2Command({ Bucket: env.S3_BUCKET, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? []) {
          bytes += o.Size ?? 0;
          objects += 1;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (objects >= STORAGE_MAX_OBJECTS && token) {
          partial = true;
          break;
        }
      } while (token);
      storageCache = { at: Date.now(), value: { bytes, objects, partial } };
    } catch (err) {
      log.warn(`[monitor] tamanho do armazenamento: ${reason(err)}`);
      storageCache = { at: Date.now(), value: null };
    }
  })().finally(() => {
    storageRunning = null;
  });
}

/** O ultimo tamanho calculado (a primeira foto dispara o calculo em segundo plano). */
function storageSize() {
  if (!storageCache || Date.now() - storageCache.at > STORAGE_CACHE_MS) refreshStorage();
  return storageCache ? { ...storageCache.value, at: new Date(storageCache.at) } : null;
}

async function platformSnapshot() {
  const mem = process.memoryUsage();
  const [db, retroscans] = await Promise.all([
    prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
    prisma.yaraRetroscan.count({ where: { status: 'RUNNING' } }),
  ]);
  const sigma = sigmaRetroState();
  return {
    uptimeS: Math.round(process.uptime()),
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    loop: { p50: lastLoop.p50, p99: lastLoop.p99 },
    workerRestarts: analysisWorkerRestarts(),
    sigmaRetro: { current: sigma.current, queued: sigma.queued.length },
    yaraRetroscans: retroscans,
    dbBytes: Number(db[0]?.bytes ?? 0),
    storage: storageSize(),
  };
}

// ----------------------------------------------------------------------------------- foto

export async function monitorSnapshot() {
  const [sandbox, queues, platform, status] = await Promise.all([
    sandboxSnapshot(),
    queueCounts(),
    platformSnapshot(),
    cachedSystemStatus().catch(() => null),
  ]);
  const checks = new Map((status?.checks ?? []).map((c) => [c.id as string, c]));
  return {
    checkedAt: new Date(),
    sandbox,
    queues: queues.map((q) => {
      const check = checks.get(QUEUE_TABLES[q.id].statusCheck);
      return {
        ...q,
        service: check ? { level: check.level, summary: check.summary } : null,
      };
    }),
    platform,
  };
}

let snapshotCache: { at: number; value: ReturnType<typeof monitorSnapshot> } | null = null;

/** A foto com cache de 5 s: varios admins com a aba aberta nao multiplicam as consultas. */
export function cachedMonitorSnapshot(): ReturnType<typeof monitorSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < 5000) return snapshotCache.value;
  const value = monitorSnapshot();
  snapshotCache = { at: Date.now(), value };
  value.catch(() => {
    if (snapshotCache?.value === value) snapshotCache = null;
  });
  return value;
}

/** Depois de uma acao do admin: a proxima leitura ja mostra o efeito. */
export function forgetMonitorSnapshot(): void {
  snapshotCache = null;
}

// ------------------------------------------------------------------------------ historico

const SAMPLE_EVERY_MS = 60_000;
export const SAMPLE_RETENTION_DAYS = 7;

/** Grava a amostra do minuto (e apaga as de mais de 7 dias). */
export async function sampleMetrics(now = new Date()): Promise<void> {
  lastLoop = readLoopDelay();
  loopDelay.reset();
  const [queues, active, node] = await Promise.all([
    queueCounts(),
    sandboxEnabled
      ? prisma.sandboxSession.count({ where: { status: { in: ACTIVE_STATUSES } } })
      : Promise.resolve(0),
    sandboxEnabled ? nodeStats() : Promise.resolve(null),
  ]);
  const mem = process.memoryUsage();
  const values: [string, number | null][] = [
    ['sandbox.active', active],
    ['jobs.running', queues.reduce((n, q) => n + q.running, 0)],
    ['jobs.done', queues.reduce((n, q) => n + q.done1m, 0)],
    ['jobs.failed', queues.reduce((n, q) => n + q.failed1m, 0)],
    ...queues.map((q): [string, number] => [`queue.${q.id}`, q.ready + q.scheduled]),
    ['api.rss', mem.rss],
    ['api.heap', mem.heapUsed],
    ['api.loopP99', lastLoop.p99],
    ['node.cpu', node?.cpu ?? null],
    ['node.mem', node?.memUsed && node.memTotal ? node.memUsed / node.memTotal : null],
  ];
  const at = new Date(Math.floor(now.getTime() / SAMPLE_EVERY_MS) * SAMPLE_EVERY_MS);
  await prisma.monitorSample.createMany({
    data: values
      .filter((v): v is [string, number] => v[1] !== null && Number.isFinite(v[1]))
      .map(([key, value]) => ({ at, key, value })),
    skipDuplicates: true,
  });
  await prisma.monitorSample.deleteMany({
    where: { at: { lt: new Date(now.getTime() - SAMPLE_RETENTION_DAYS * 86_400_000) } },
  });
}

let sampler: NodeJS.Timeout | null = null;

export function startMonitorSampler(logger: { warn: (m: string) => void }): void {
  if (sampler) return;
  const run = () =>
    void sampleMetrics().catch((err: unknown) =>
      logger.warn(`[monitor] amostra das métricas: ${reason(err)}`),
    );
  sampler = setInterval(run, SAMPLE_EVERY_MS);
  sampler.unref();
}

/** Somados no intervalo (contagens por minuto); os outros sao a media do intervalo. */
const COUNTERS = new Set(['jobs.done', 'jobs.failed']);

export const HISTORY_RANGES = {
  '24h': { hours: 24, bucketMin: 15 },
  '7d': { hours: 24 * 7, bucketMin: 60 },
} as const;

/** As series do historico, em intervalos de 15 min (24 h) ou 1 h (7 dias). */
export async function monitorHistory(range: keyof typeof HISTORY_RANGES) {
  const { hours, bucketMin } = HISTORY_RANGES[range];
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await prisma.$queryRaw<{ key: string; bucket: Date; avg: number; sum: number }[]>`
    SELECT "key", date_bin(${`${bucketMin} minutes`}::interval, "at", TIMESTAMP '2000-01-01') AS bucket,
      avg("value")::float8 AS avg, sum("value")::float8 AS sum
    FROM "MonitorSample"
    WHERE "at" >= ${since}
    GROUP BY 1, 2
    ORDER BY 2
  `;
  const series: Record<string, [number, number][]> = {};
  for (const r of rows) {
    (series[r.key] ??= []).push([r.bucket.getTime(), COUNTERS.has(r.key) ? r.sum : r.avg]);
  }
  return { range, since, bucketMs: bucketMin * 60_000, series, durations: await durations() };
}

/** Tempo medio e p95 por dia de cada fila nos ultimos 7 dias, direto dos trabalhos. */
async function durations() {
  const out: Partial<Record<QueueId, { day: string; n: number; avgMs: number; p95Ms: number }[]>> =
    {};
  await Promise.all(
    QUEUE_IDS.map(async (id) => {
      const q = QUEUE_TABLES[id];
      if (!q.ms) return;
      const rows = await prisma.$queryRaw<
        { day: Date; n: bigint; avg_ms: number; p95_ms: number }[]
      >(Prisma.sql`
        SELECT date_trunc('day', ${col(q.finishedAt)}) AS day, count(*) AS n,
          avg(${col(q.ms)})::float8 AS avg_ms,
          (percentile_cont(0.95) WITHIN GROUP (ORDER BY ${col(q.ms)}))::float8 AS p95_ms
        FROM ${tableOf(q)}
        WHERE ${statusIs(q, q.done)} ${extra(q)} AND ${col(q.ms)} IS NOT NULL
          AND ${col(q.finishedAt)} >= now() - interval '7 days'
        GROUP BY 1 ORDER BY 1
      `);
      if (rows.length) {
        out[id] = rows.map((r) => ({
          day: r.day.toISOString().slice(0, 10),
          n: Number(r.n),
          avgMs: Math.round(r.avg_ms),
          p95Ms: Math.round(r.p95_ms),
        }));
      }
    }),
  );
  return out;
}
