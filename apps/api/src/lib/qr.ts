import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { CANCELLED_REASON, isQueuePaused, registerQueueWaker, startJob } from './job-control';
import { oletoolsEnabled } from './oletools';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * QR code em imagens, PDFs e no print da pagina (plano pos-revisao, item 2.2). Phishing por QR
 * code (inclusive boleto) passa pelos filtros porque o link nao esta no texto. O leitor (zxing-cpp,
 * com o pdfium para as paginas do PDF) roda no servico `oletools` (POST /qr, apps/oletools/qr.py),
 * fora da API, como todo parser de conteudo hostil no projeto.
 *
 * O que vai para o leitor: a amostra, se for imagem (PNG, JPEG, GIF) ou PDF; ou, numa amostra de
 * link, o print da captura mais recente. Mesma fila do oletools (lib/oletools.ts): persistida no
 * banco, em segundo plano, um por vez, com tentativas quando o servico esta fora.
 */

/** Tipos (lib/file-type.ts) que o leitor abre. */
const KINDS = new Set(['png', 'jpeg', 'gif', 'pdf']);
const MAX_ATTEMPTS = 3;
const TICK_MS = 15_000;

/** Tempos da fila; os testes os encurtam. */
export const qrTiming = { serviceWaitMs: 120_000, retryEveryMs: 2000, retryAfterMs: 5 * 60 * 1000 };

/** O leitor usa o servico do oletools: ligado com ele. */
export const qrEnabled = (): boolean => oletoolsEnabled();

/** Arquivo que o leitor abre, dentro do teto do servico. */
export function qrEligibleFile(detectedTypeId: string | null | undefined, size: number | null) {
  return Boolean(
    detectedTypeId &&
    KINDS.has(detectedTypeId) &&
    size !== null &&
    size > 0 &&
    size <= env.OLETOOLS_MAX_MB * 1024 * 1024,
  );
}

const codeSchema = z.object({
  text: z.string().max(2000),
  truncated: z.boolean().optional(),
  source: z.enum(['image', 'pdf']),
  page: z.number().int().positive().nullable().optional(),
});
const resultSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(400).optional(),
  codes: z.array(codeSchema).max(20).optional(),
  pages: z.number().int().nonnegative().nullable().optional(),
  pagesRead: z.number().int().nonnegative().nullable().optional(),
  zxing: z.string().max(40).nullable().optional(),
  ms: z.number().int().nonnegative().optional(),
});

export interface QrCode {
  text: string;
  truncated: boolean;
  /** De onde veio: a imagem, uma pagina do PDF ou o print da pagina (amostra de link). */
  source: 'image' | 'pdf' | 'screenshot';
  page: number | null;
  /** O texto e um endereco http(s): vira IOC sugerido e pode ser analisado como link. */
  url: string | null;
}

/** O texto como endereco http(s), ou null. */
export function qrUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

const service = (): AnalysisService => ({
  name: 'oletools',
  url: env.OLETOOLS_URL,
  token: env.OLETOOLS_TOKEN,
  timeoutS: env.OLETOOLS_REQUEST_TIMEOUT_S,
});

// ------------------------------------------------------------------ fila

/** Pede a leitura (nova ou de novo): a amostra volta para o fim da fila. */
export async function enqueueQr(entryId: string): Promise<void> {
  const fresh = {
    status: 'PENDING' as const,
    codes: Prisma.DbNull,
    pages: null,
    error: null,
    ms: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.qrScan.upsert({ where: { entryId }, create: { entryId }, update: fresh });
  wake();
}

/** Depois do envio: so imagem ou PDF, com o servico ligado. */
export async function enqueueQrIfEligible(
  entryId: string,
  detectedTypeId: string | null | undefined,
  size: number,
  log: { error: (o: object, m: string) => void },
): Promise<void> {
  if (!qrEnabled() || !qrEligibleFile(detectedTypeId, size)) return;
  await enqueueQr(entryId).catch((err) => log.error({ err }, '[qr] falha ao enfileirar'));
}

let worker: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let logger: { info: (m: string) => void; error: (o: object, m: string) => void } = {
  info: () => undefined,
  error: () => undefined,
};

function wake(): void {
  if (worker || !qrEnabled()) return;
  worker = drain()
    .catch((err: unknown) => logger.error({ err }, '[qr] a fila parou; volta no próximo tique'))
    .finally(() => (worker = null));
}

/** Para os testes: espera a fila esvaziar. */
export async function qrIdle(): Promise<void> {
  while (worker) await worker;
}

async function claim() {
  const next = await prisma.qrScan.findFirst({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.qrScan.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.qrScan.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    // Fila pausada pelo Monitoramento: o que esta em andamento termina, nada novo comeca.
    if (isQueuePaused('qr')) return;
    const job = await claim();
    if (!job) return;
    const run = startJob('qr', job.id);
    try {
      await scanJob(job.id, job.entryId, job.attempts, run.signal);
    } catch (err) {
      logger.error({ err }, '[qr] falha na leitura');
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    } finally {
      run.done();
    }
  }
}

function finish(id: string, data: Prisma.QrScanUpdateInput) {
  return prisma.qrScan.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

/** O que vai para o leitor: o arquivo (imagem ou PDF) ou o print da captura mais recente. */
async function source(
  entryId: string,
): Promise<{ key: string; bucket: string; screenshot: boolean } | null> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { type: true, storageKey: true, bucket: true, filePurgedAt: true },
  });
  if (!entry) return null;
  if (entry.type === 'FILE') {
    if (!entry.storageKey || entry.filePurgedAt) return null;
    return { key: entry.storageKey, bucket: entry.bucket || env.S3_BUCKET, screenshot: false };
  }
  const capture = await prisma.pageCapture.findFirst({
    where: { entryId, status: 'DONE', screenshotKey: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { screenshotKey: true },
  });
  return capture?.screenshotKey
    ? { key: capture.screenshotKey, bucket: env.S3_BUCKET, screenshot: true }
    : null;
}

async function scanJob(
  id: string,
  entryId: string,
  attempts: number,
  signal: AbortSignal,
): Promise<void> {
  const from = await source(entryId);
  if (!from) {
    await finish(id, { status: 'FAILED', error: 'o arquivo não está mais disponível' });
    return;
  }
  let data: Uint8Array;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: from.bucket, Key: from.key }));
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
      signal,
      path: '/qr',
      waitMs: qrTiming.serviceWaitMs,
      retryEveryMs: qrTiming.retryEveryMs,
    });
  } catch (err) {
    if (signal.aborted) {
      await finish(id, { status: 'FAILED', error: CANCELLED_REASON });
      return;
    }
    const reason = requestFailure(service(), err);
    if (attempts < MAX_ATTEMPTS) {
      await prisma.qrScan.update({
        where: { id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + qrTiming.retryAfterMs * attempts),
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
      error: (result.error ?? 'a análise falhou').slice(0, 300),
      ms: result.ms ?? null,
    });
    return;
  }
  const codes: QrCode[] = (result.codes ?? []).map((c) => {
    const text = c.text.replaceAll('\u0000', '');
    return {
      text,
      truncated: Boolean(c.truncated),
      source: from.screenshot ? 'screenshot' : c.source,
      page: c.page ?? null,
      url: qrUrl(text),
    };
  });
  await finish(id, {
    status: 'DONE',
    codes: codes as unknown as Prisma.InputJsonValue,
    pages: result.pages ?? null,
    error: null,
    ms: result.ms ?? null,
  });
  logger.info(`[qr] amostra ${entryId}: ${codes.length} código(s) em ${result.ms ?? '?'} ms`);
}

/** Sobe a fila: o que estava em andamento volta para a fila (ou falha, se ja gastou as tentativas). */
export async function startQrQueue(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.qrScan.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.qrScan.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  registerQueueWaker('qr', wake);
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

/** Para os testes: desliga o tique. */
export function stopQrQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
