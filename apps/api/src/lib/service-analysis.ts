import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { z } from 'zod';

import { env } from '../env';
import { Prisma, type ServiceKind } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Fila dos servicos novos (plans/novas-analises): emulacao (emulate, item 4), APK (android, item 6)
 * e configuracao de familias (extract, item 2). Mesmo desenho da fila do oletools, generalizado: a
 * analise fica em ServiceAnalysis (uma por amostra e tipo), em segundo plano, um trabalho por vez
 * para cada tipo, com tentativas quando o servico esta fora. Cada tipo diz o servico, o que e
 * elegivel, o formato da resposta, os alertas e os IOCs (ServiceDef, nos arquivos de cada um).
 */

export type ServiceAlert = { level: 'high' | 'medium' | 'info'; text: string };

export interface ServiceDef<R = unknown> {
  kind: ServiceKind;
  /** Nome nas mensagens ("o serviço emulate não respondeu"). */
  name: string;
  url: () => string;
  token: () => string;
  timeoutS: () => number;
  maxMb: () => number;
  /** Rota do servico (ex.: "/config"). */
  path: string;
  /** Tipos (lib/file-type.ts) que vao sozinhos para a fila no envio. */
  autoKinds: Set<string>;
  /** Filtro a mais no envio, sobre a analise estatica (ex.: so o PE que e .NET). */
  autoOk?: (staticInfo: unknown) => boolean;
  /** Tipos que um analista pode pedir (os automaticos e, na emulacao, qualquer arquivo como shellcode). */
  manualOk: (typeId: string | null | undefined, options: Record<string, string>) => boolean;
  /** Query do pedido a partir das opcoes (ex.: "?kind=shellcode&arch=x86"). */
  query: (options: Record<string, string>) => string;
  /** O resultado do servico (sem ok/error/version/ms, que a fila trata). */
  schema: z.ZodType<R>;
  alerts: (result: R) => ServiceAlert[];
  iocs: (result: R) => string[];
  /**
   * Guarda o que e pesado demais para o banco (no armazenamento, ou como amostras filhas) e devolve
   * o resultado que fica em ServiceAnalysis.result. Os alertas e os IOCs saem do resultado inteiro.
   */
  persist?: (entryId: string, result: R) => Promise<unknown>;
}

const MAX_ATTEMPTS = 3;
const TICK_MS = 15_000;

/** Tempos da fila; os testes os encurtam. */
export const serviceTiming = {
  serviceWaitMs: 120_000,
  retryEveryMs: 2000,
  retryAfterMs: 5 * 60 * 1000,
};

const defs = new Map<ServiceKind, ServiceDef>();

export function registerService<R>(def: ServiceDef<R>): ServiceDef<R> {
  defs.set(def.kind, def as ServiceDef);
  return def;
}

export const serviceDef = (kind: ServiceKind) => defs.get(kind);

export function serviceEnabled(kind: ServiceKind): boolean {
  const def = defs.get(kind);
  return Boolean(def && def.url() && def.token());
}

/** Arquivo do tipo e do tamanho que o servico le sozinho. */
export function serviceAutoEligible(
  def: ServiceDef,
  typeId: string | null | undefined,
  size: number | null,
): boolean {
  return Boolean(
    typeId && def.autoKinds.has(typeId) && size && size > 0 && size <= def.maxMb() * 1024 * 1024,
  );
}

/** O Postgres recusa \u0000 em JSON: o texto vem da amostra. */
function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k.replaceAll('\u0000', ''), withoutNul(v)]),
    ) as T;
  }
  return value;
}

const serviceOf = (def: ServiceDef): AnalysisService => ({
  name: def.name,
  url: def.url(),
  token: def.token(),
  timeoutS: def.timeoutS(),
});

// ------------------------------------------------------------------ fila

/** Pede a analise (nova ou de novo): a amostra volta para o fim da fila daquele tipo. */
export async function enqueueService(
  kind: ServiceKind,
  entryId: string,
  options: Record<string, string> = {},
): Promise<void> {
  const fresh = {
    status: 'PENDING' as const,
    options: options as Prisma.InputJsonValue,
    result: Prisma.DbNull,
    alerts: Prisma.DbNull,
    iocs: [],
    error: null,
    version: null,
    ms: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.serviceAnalysis.upsert({
    where: { entryId_kind: { entryId, kind } },
    create: { entryId, kind, options: options as Prisma.InputJsonValue },
    update: fresh,
  });
  wake(kind);
}

/** Depois do envio: cada servico ligado pega o que le sozinho. */
export async function enqueueServicesIfEligible(
  entryId: string,
  typeId: string | null | undefined,
  size: number,
  log: { error: (o: object, m: string) => void },
  staticInfo?: unknown,
): Promise<void> {
  for (const def of defs.values()) {
    if (!serviceEnabled(def.kind) || !serviceAutoEligible(def, typeId, size)) continue;
    if (def.autoOk && !def.autoOk(staticInfo)) continue;
    await enqueueService(def.kind, entryId).catch((err) =>
      log.error({ err }, `[${def.name}] falha ao enfileirar`),
    );
  }
}

const workers = new Map<ServiceKind, Promise<void>>();
let timer: NodeJS.Timeout | null = null;
let logger: { info: (m: string) => void; error: (o: object, m: string) => void } = {
  info: () => undefined,
  error: () => undefined,
};

function wake(kind: ServiceKind): void {
  if (workers.has(kind) || !serviceEnabled(kind)) return;
  const def = defs.get(kind)!;
  workers.set(
    kind,
    drain(def)
      .catch((err: unknown) =>
        logger.error({ err }, `[${def.name}] a fila parou; volta no próximo tique`),
      )
      .finally(() => workers.delete(kind)),
  );
}

const wakeAll = () => {
  for (const kind of defs.keys()) wake(kind);
};

/** Para os testes: espera as filas esvaziarem. */
export async function servicesIdle(): Promise<void> {
  while (workers.size) await Promise.all(workers.values());
}

async function claim(kind: ServiceKind) {
  const next = await prisma.serviceAnalysis.findFirst({
    where: { kind, status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.serviceAnalysis.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.serviceAnalysis.findUnique({ where: { id: next.id } }) : null;
}

async function drain(def: ServiceDef): Promise<void> {
  for (;;) {
    const job = await claim(def.kind);
    if (!job) return;
    try {
      await analyzeJob(def, job);
    } catch (err) {
      logger.error({ err }, `[${def.name}] falha na análise`);
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    }
  }
}

function finish(id: string, data: Prisma.ServiceAnalysisUpdateInput) {
  return prisma.serviceAnalysis.update({
    where: { id },
    data: { finishedAt: new Date(), ...data },
  });
}

async function analyzeJob(
  def: ServiceDef,
  job: { id: string; entryId: string; attempts: number; options: unknown },
): Promise<void> {
  const entry = await prisma.entry.findUnique({
    where: { id: job.entryId },
    select: { storageKey: true, bucket: true, filePurgedAt: true },
  });
  if (!entry?.storageKey || entry.filePurgedAt) {
    await finish(job.id, { status: 'FAILED', error: 'o arquivo não está mais disponível' });
    return;
  }
  let data: Uint8Array;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
    );
    data = await obj.Body!.transformToByteArray();
  } catch {
    await finish(job.id, {
      status: 'FAILED',
      error: 'não foi possível ler o arquivo no armazenamento',
    });
    return;
  }
  const options = (job.options ?? {}) as Record<string, string>;
  const service = serviceOf(def);
  let res: Response;
  try {
    res = await requestAnalysis(service, data, {
      waitMs: serviceTiming.serviceWaitMs,
      retryEveryMs: serviceTiming.retryEveryMs,
      path: def.path,
      query: def.query(options),
    });
  } catch (err) {
    const reason = requestFailure(service, err);
    if (job.attempts < MAX_ATTEMPTS) {
      await prisma.serviceAnalysis.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + serviceTiming.retryAfterMs * job.attempts),
        },
      });
    } else {
      await finish(job.id, { status: 'FAILED', error: reason });
    }
    return;
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const error =
      body && typeof body.error === 'string'
        ? body.error.slice(0, 300)
        : `o serviço respondeu ${res.status}`;
    await finish(job.id, { status: 'FAILED', error });
    return;
  }
  const version = typeof body?.version === 'string' ? body.version.slice(0, 120) : null;
  const ms = typeof body?.ms === 'number' && Number.isInteger(body.ms) ? body.ms : null;
  if (!body || body.ok !== true) {
    const error = typeof body?.error === 'string' ? body.error : 'a análise falhou';
    await finish(job.id, { status: 'FAILED', error: error.slice(0, 300), version, ms });
    return;
  }
  const { ok: _ok, error: _error, version: _v, ms: _ms, ...rest } = body;
  const parsed = def.schema.safeParse(withoutNul(rest));
  if (!parsed.success) {
    await finish(job.id, {
      status: 'FAILED',
      error: 'resposta do serviço em formato inesperado',
      version,
      ms,
    });
    return;
  }
  const result = parsed.data;
  let stored: unknown = result;
  if (def.persist) {
    try {
      stored = await def.persist(job.entryId, result);
    } catch (err) {
      logger.error({ err }, `[${def.name}] falha ao guardar o resultado`);
      await finish(job.id, {
        status: 'FAILED',
        error: 'não foi possível guardar o resultado',
        version,
        ms,
      });
      return;
    }
  }
  await finish(job.id, {
    status: 'DONE',
    result: stored as Prisma.InputJsonValue,
    alerts: def.alerts(result) as unknown as Prisma.InputJsonValue,
    iocs: [...new Set(def.iocs(result))].slice(0, 300),
    error: null,
    version,
    ms,
  });
  logger.info(`[${def.name}] amostra ${job.entryId}: concluída em ${ms ?? '?'} ms`);
}

/** Sobe as filas: o que estava em andamento volta para a fila (ou falha, se gastou as tentativas). */
export async function startServiceQueues(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.serviceAnalysis.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.serviceAnalysis.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  if (!timer) {
    timer = setInterval(wakeAll, TICK_MS);
    timer.unref();
  }
  wakeAll();
}

/** Para os testes: desliga o tique. */
export function stopServiceQueues(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
