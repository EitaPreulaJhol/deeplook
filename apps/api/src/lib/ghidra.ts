import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Analise com o Ghidra (item 7.3): sob demanda (so analistas pedem), no servico `ghidra`
 * (apps/ghidra), sem rede, sem root, raiz somente leitura e um container por analise. A fila e a
 * mesma ideia da do capa (7.2): persistida no banco, um trabalho por vez, com novas tentativas
 * quando o servico esta fora. O resultado e o resumo (maiores funcoes, quem chama APIs sensiveis e
 * o pseudo-C delas) e o projeto .gzf, que tem os bytes da amostra e por isso mora sob samples/.
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 15_000;

/** Tempos da fila; os testes os encurtam. */
export const ghidraTiming = {
  serviceWaitMs: 120_000,
  retryEveryMs: 2000,
  retryAfterMs: RETRY_AFTER_MS,
};

/** Teto do .gzf recebido (o servico ja corta em GHIDRA_MAX_GZF_MB, 64 MB). */
const MAX_GZF_BYTES = 64 * 1024 * 1024;

export function ghidraEnabled(): boolean {
  return Boolean(env.GHIDRA_URL && env.GHIDRA_TOKEN);
}

/** Onde o projeto .gzf da amostra fica no MinIO (sob samples/, como o arquivo). */
export const ghidraProjectKey = (entryId: string) => `samples/ghidra/${entryId}.gzf`;

/**
 * Por que a amostra nao vai para o Ghidra (null = vai). .NET fica de fora: o Ghidra nao
 * descompila IL, e o resultado seria so o stub do CLR (ver 7.10, ilspycmd).
 */
export function ghidraIneligible(entry: {
  type: string;
  fileSize: number | null;
  filePurgedAt: Date | null;
  staticInfo: unknown;
}): string | null {
  if (entry.type !== 'FILE') return 'Só arquivos.';
  if (entry.filePurgedAt) return 'O arquivo desta amostra foi expurgado pela política de retenção.';
  const info = entry.staticInfo as {
    detectedType?: { id?: string } | null;
    pe?: { dotnet?: unknown } | null;
  } | null;
  const kind = info?.detectedType?.id;
  if (kind !== 'pe' && kind !== 'elf') return 'Só executáveis do Windows (PE) e do Linux (ELF).';
  if (info?.pe?.dotnet) {
    return 'Executável .NET: o Ghidra não descompila o código intermediário (IL).';
  }
  if (!entry.fileSize || entry.fileSize > env.GHIDRA_MAX_MB * 1024 * 1024) {
    return `Executáveis de até ${env.GHIDRA_MAX_MB} MB.`;
  }
  return null;
}

// ------------------------------------------------------------------ resposta do servico

const text = (max: number) => z.string().max(max);
const name = text(512);
const address = text(32);
const summarySchema = z.object({
  format: text(120).nullable(),
  language: text(120).nullable(),
  compiler: text(120).nullable(),
  imageBase: address.nullable(),
  entryPoint: address.nullable(),
  functions: z.number().int().nonnegative(),
  thunks: z.number().int().nonnegative(),
  sensitiveFunctions: z.number().int().nonnegative(),
  largest: z
    .array(
      z.object({
        name,
        entry: address,
        size: z.number().int().nonnegative(),
        complexity: z.number().int(),
        calls: z.number().int().nonnegative(),
        callers: z.number().int().nonnegative(),
        apis: z.array(name).max(40),
      }),
    )
    .max(300),
  decompiled: z
    .array(
      z.object({
        name,
        entry: address,
        isEntryPoint: z.boolean(),
        sensitive: z.array(name).max(200),
        callers: z.array(name).max(10),
        c: text(20_000).optional(),
        truncated: z.boolean().optional(),
        error: text(1000).nullish(),
      }),
    )
    .max(26),
});
export type GhidraSummary = z.infer<typeof summarySchema>;

const resultSchema = z.union([
  z.object({
    ok: z.literal(true),
    kind: z.enum(['pe', 'elf']).nullable(),
    version: text(40),
    summary: summarySchema,
    // Base64 do .gzf: 4 caracteres para cada 3 bytes.
    gzf: z
      .string()
      .max(Math.ceil(MAX_GZF_BYTES / 3) * 4)
      .nullable(),
    gzfError: text(400).nullable(),
    ms: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    error: text(400),
    version: text(40).optional(),
    ms: z.number().int().nonnegative().optional(),
  }),
]);

/** O Postgres recusa \u0000 em JSON e em texto; nomes e pseudo-C vem do arquivo. */
function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutNul(v)])) as T;
  }
  return value;
}

// ------------------------------------------------------------------ projeto .gzf no MinIO

/** Apaga o projeto .gzf da amostra (idempotente). Lixeira e retencao chamam junto com o arquivo. */
export async function deleteGhidraProject(entryId: string): Promise<void> {
  const row = await prisma.ghidraAnalysis.findUnique({
    where: { entryId },
    select: { gzfKey: true },
  });
  if (!row?.gzfKey) return;
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: row.gzfKey }));
  await prisma.ghidraAnalysis.update({
    where: { entryId },
    data: { gzfKey: null, gzfSize: null },
  });
}

// ------------------------------------------------------------------ fila

const service = (): AnalysisService => ({
  name: 'ghidra',
  url: env.GHIDRA_URL,
  token: env.GHIDRA_TOKEN,
  timeoutS: env.GHIDRA_REQUEST_TIMEOUT_S,
});

/** Pede a analise (nova ou de novo). */
export async function enqueueGhidra(entryId: string, requestedById: string): Promise<void> {
  // O projeto anterior sai antes: o novo tem a mesma chave, e uma falha nao deixa o velho
  // parecendo o da analise nova.
  await deleteGhidraProject(entryId).catch(() => undefined);
  const fresh = {
    status: 'PENDING' as const,
    requestedById,
    summary: Prisma.DbNull,
    gzfKey: null,
    gzfSize: null,
    gzfError: null,
    error: null,
    version: null,
    ms: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.ghidraAnalysis.upsert({
    where: { entryId },
    create: { entryId, requestedById },
    update: fresh,
  });
  wake();
}

let worker: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let logger: { info: (m: string) => void; error: (o: object, m: string) => void } = {
  info: () => undefined,
  error: () => undefined,
};

function wake(): void {
  if (!worker && ghidraEnabled()) worker = drain().finally(() => (worker = null));
}

/** Para os testes: espera a fila esvaziar. */
export async function ghidraIdle(): Promise<void> {
  while (worker) await worker;
}

async function claim() {
  const next = await prisma.ghidraAnalysis.findFirst({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.ghidraAnalysis.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.ghidraAnalysis.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    const job = await claim();
    if (!job) return;
    try {
      await analyzeJob(job.id, job.entryId, job.attempts);
    } catch (err) {
      logger.error({ err }, '[ghidra] falha na análise');
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    }
  }
}

function finish(id: string, data: Prisma.GhidraAnalysisUpdateInput) {
  return prisma.ghidraAnalysis.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

async function analyzeJob(id: string, entryId: string, attempts: number): Promise<void> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { storageKey: true, bucket: true, filePurgedAt: true },
  });
  if (!entry?.storageKey || entry.filePurgedAt) {
    await finish(id, { status: 'FAILED', error: 'o arquivo não está mais disponível' });
    return;
  }
  let data: Uint8Array;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
    );
    data = await obj.Body!.transformToByteArray();
  } catch {
    await finish(id, {
      status: 'FAILED',
      error: 'não foi possível ler o arquivo no armazenamento',
    });
    return;
  }

  let res: Response;
  try {
    res = await requestAnalysis(service(), data, {
      waitMs: ghidraTiming.serviceWaitMs,
      retryEveryMs: ghidraTiming.retryEveryMs,
    });
  } catch (err) {
    const reason = requestFailure(service(), err);
    if (attempts < MAX_ATTEMPTS) {
      await prisma.ghidraAnalysis.update({
        where: { id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + ghidraTiming.retryAfterMs * attempts),
        },
      });
    } else {
      await finish(id, { status: 'FAILED', error: reason });
    }
    return;
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error.slice(0, 300)
        : `o serviço respondeu ${res.status}`;
    await finish(id, { status: 'FAILED', error });
    return;
  }
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) {
    await finish(id, { status: 'FAILED', error: 'resposta do serviço em formato inesperado' });
    return;
  }
  const result = parsed.data;
  if (!result.ok) {
    await finish(id, {
      status: 'FAILED',
      error: result.error,
      version: result.version ?? null,
      ms: result.ms ?? null,
    });
    return;
  }

  let gzfKey: string | null = null;
  let gzfSize: number | null = null;
  let gzfError = result.gzfError;
  if (result.gzf) {
    const bytes = Buffer.from(result.gzf, 'base64');
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: ghidraProjectKey(entryId),
          Body: bytes,
          ContentType: 'application/octet-stream',
        }),
      );
      gzfKey = ghidraProjectKey(entryId);
      gzfSize = bytes.length;
    } catch {
      gzfError = 'não foi possível gravar o projeto no armazenamento';
    }
  }
  await finish(id, {
    status: 'DONE',
    summary: withoutNul(result.summary) as unknown as Prisma.InputJsonValue,
    gzfKey,
    gzfSize,
    gzfError,
    error: null,
    version: result.version,
    ms: result.ms,
  });
  logger.info(`[ghidra] amostra ${entryId}: concluída em ${result.ms} ms`);
}

/** Sobe a fila (o que estava em andamento quando a API parou volta para a fila ou falha). */
export async function startGhidraQueue(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.ghidraAnalysis.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.ghidraAnalysis.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

export function stopGhidraQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
