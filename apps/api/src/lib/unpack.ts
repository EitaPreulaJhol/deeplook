import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { sha256Hex } from './crypto';
import { recordEvent } from './events';
import { prisma } from './prisma';
import { s3 } from './s3';
import { extractZipEntry, listZip, ZipError } from './zip';

/**
 * Desempacotar e extrair (item 7.8): o servico `unpack` (apps/unpack) roda upx, 7-Zip, innoextract
 * e pyinstxtractor num container sem rede, e cada arquivo que sai vira uma amostra filha, que passa
 * por toda a analise de novo. Assim o capa e o Ghidra veem o codigo de verdade, nao o
 * descompactador do UPX nem o instalador. A fila e a mesma ideia da do capa (7.2).
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 15_000;
/**
 * Geracoes de desempacotamento: a amostra, o que saiu dela e o que saiu disso (um instalador com
 * um UPX dentro). Mais que isso para, contra instalador dentro de instalador sem fim.
 */
const MAX_DEPTH = 2;

/** Tempos da fila; os testes os encurtam. */
export const unpackTiming = {
  serviceWaitMs: 120_000,
  retryEveryMs: 2000,
  retryAfterMs: RETRY_AFTER_MS,
};

export function unpackEnabled(): boolean {
  return Boolean(env.UNPACK_URL && env.UNPACK_TOKEN);
}

const NSIS = Buffer.from('NullsoftInst');
const INNO = Buffer.from('Inno Setup Setup Data');
const PYINSTALLER = Buffer.from([0x4d, 0x45, 0x49, 0x0c, 0x0b, 0x0a, 0x0b, 0x0e]);

/**
 * A amostra vale a viagem ao servico? Barato, na chegada: executavel com empacotador conhecido,
 * dados anexados (instalador, autoextraivel, dropper) ou a marca de NSIS, Inno ou PyInstaller. O
 * servico decide de verdade qual desempacotador usar.
 */
export function unpackCandidate(
  buffer: Buffer,
  staticInfo:
    | {
        detectedType?: { id?: string } | null;
        pe?: { packer?: string | null; overlay?: unknown; dotnet?: unknown } | null;
        elf?: { packer?: string | null } | null;
      }
    | null
    | undefined,
): boolean {
  const kind = staticInfo?.detectedType?.id;
  if ((kind !== 'pe' && kind !== 'elf') || buffer.length > env.UNPACK_MAX_MB * 1024 * 1024) {
    return false;
  }
  if (staticInfo?.pe?.packer || staticInfo?.elf?.packer || staticInfo?.pe?.overlay) return true;
  if (buffer.includes(NSIS) || buffer.includes(INNO)) return true;
  // O cookie do PyInstaller fica no fim do arquivo.
  return buffer.subarray(Math.max(0, buffer.length - (4 << 20))).includes(PYINSTALLER);
}

/** Quantas geracoes de desempacotamento ha acima da amostra (pais que tem um UnpackJob). */
async function unpackDepth(entryId: string): Promise<number> {
  let depth = 0;
  let current = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { parentEntryId: true },
  });
  while (current?.parentEntryId && depth <= MAX_DEPTH) {
    const parent = await prisma.entry.findUnique({
      where: { id: current.parentEntryId },
      select: { parentEntryId: true, unpackJob: { select: { id: true } } },
    });
    if (!parent) break;
    if (parent.unpackJob) depth++;
    current = parent;
  }
  return depth;
}

// ------------------------------------------------------------------ resposta do servico

const manifestSchema = z.union([
  z.object({
    ok: z.literal(true),
    unpacker: z.string().max(40).nullable(),
    label: z.string().max(80).optional(),
    note: z.string().max(200).nullish(),
    files: z
      .array(
        z.object({
          name: z.string().max(300),
          entry: z.string().regex(/^f\d{4}$/),
          size: z.number().int().positive(),
        }),
      )
      .max(100),
    skipped: z
      .array(
        z.object({
          name: z.string().max(300),
          size: z.number().int().nonnegative(),
          reason: z.string().max(200),
        }),
      )
      .max(10_000),
    ms: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ok: z.literal(false),
    unpacker: z.string().max(40).optional(),
    label: z.string().max(80).optional(),
    error: z.string().max(300),
    ms: z.number().int().nonnegative().optional(),
  }),
]);

/** O que a fila precisa para criar a amostra filha (a funcao vem das rotas de amostras). */
export interface UnpackedChild {
  parentId: string;
  ownerId: string;
  tags: { id: string }[];
  buffer: Buffer;
  filename: string;
  title: string;
  description: string;
}
type ChildCreator = (child: UnpackedChild) => Promise<{ id: string }>;

// ------------------------------------------------------------------ fila

const service = (): AnalysisService => ({
  name: 'unpack',
  url: env.UNPACK_URL,
  token: env.UNPACK_TOKEN,
  timeoutS: env.UNPACK_REQUEST_TIMEOUT_S,
});

async function enqueue(entryId: string): Promise<void> {
  await prisma.unpackJob.upsert({
    where: { entryId },
    create: { entryId },
    update: {
      status: 'PENDING',
      unpacker: null,
      label: null,
      note: null,
      files: Prisma.DbNull,
      error: null,
      ms: null,
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    },
  });
  wake();
}

/** Na chegada: executavel candidato, servico ligado e sem passar do limite de geracoes. */
export async function enqueueUnpackIfCandidate(
  entryId: string,
  buffer: Buffer,
  staticInfo: Parameters<typeof unpackCandidate>[1],
  log: { error: (o: object, m: string) => void },
): Promise<void> {
  try {
    if (!unpackEnabled() || !unpackCandidate(buffer, staticInfo)) return;
    if ((await unpackDepth(entryId)) >= MAX_DEPTH) return;
    await enqueue(entryId);
  } catch (err) {
    log.error({ err }, '[unpack] falha ao enfileirar');
  }
}

/** Pedido do analista (mesmo sem a amostra parecer candidata). */
export async function requestUnpack(entryId: string): Promise<void> {
  await enqueue(entryId);
}

let worker: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let logger: FastifyBaseLogger | null = null;
let createChild: ChildCreator | null = null;

function wake(): void {
  if (!worker && unpackEnabled() && createChild) {
    worker = drain().finally(() => (worker = null));
  }
}

/** Para os testes: espera a fila esvaziar. */
export async function unpackIdle(): Promise<void> {
  while (worker) await worker;
}

async function claim() {
  const next = await prisma.unpackJob.findFirst({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.unpackJob.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.unpackJob.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    const job = await claim();
    if (!job) return;
    try {
      await unpackJob(job.id, job.entryId, job.attempts);
    } catch (err) {
      logger?.error({ err }, '[unpack] falha');
      await finish(job.id, { status: 'FAILED', error: 'falha interna ao desempacotar' });
    }
  }
}

function finish(id: string, data: Prisma.UnpackJobUpdateInput) {
  return prisma.unpackJob.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

/** Nome do arquivo da filha: o caminho dentro do pacote ou, no UPX, o nome da amostra marcado. */
function childFilename(name: string, parentFilename: string | null): string {
  const base = name.split('/').pop() || 'arquivo';
  if (name !== 'desempacotado') return base.slice(0, 200);
  const original = parentFilename || 'amostra';
  const dot = original.lastIndexOf('.');
  return dot > 0
    ? `${original.slice(0, dot)}.desempacotado${original.slice(dot)}`
    : `${original}.desempacotado`;
}

async function unpackJob(id: string, entryId: string, attempts: number): Promise<void> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: {
      title: true,
      ownerId: true,
      sha256: true,
      originalFilename: true,
      storageKey: true,
      bucket: true,
      filePurgedAt: true,
      staticInfo: true,
      tags: { select: { id: true } },
    },
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
      waitMs: unpackTiming.serviceWaitMs,
      retryEveryMs: unpackTiming.retryEveryMs,
    });
  } catch (err) {
    const reason = requestFailure(service(), err);
    if (attempts < MAX_ATTEMPTS) {
      await prisma.unpackJob.update({
        where: { id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + unpackTiming.retryAfterMs * attempts),
        },
      });
    } else {
      await finish(id, { status: 'FAILED', error: reason });
    }
    return;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error =
      typeof body?.error === 'string'
        ? body.error.slice(0, 300)
        : `o serviço respondeu ${res.status}`;
    await finish(id, { status: 'FAILED', error });
    return;
  }
  // A resposta e um ZIP sem compressao: manifest.json e os arquivos (f0001, f0002...). O leitor de
  // ZIP do envio confere tamanho e CRC e para no teto (zip bomb).
  const maxFile = env.MAX_UPLOAD_MB * 1024 * 1024;
  const zip = Buffer.from(await res.arrayBuffer());
  let entries: ReturnType<typeof listZip>;
  let manifest: z.infer<typeof manifestSchema>;
  try {
    entries = listZip(zip);
    const raw = entries.find((e) => e.path === 'manifest.json');
    if (!raw) throw new ZipError('CORRUPT', 'sem manifest.json');
    const parsed = manifestSchema.safeParse(
      JSON.parse(extractZipEntry(zip, raw, '', 1024 * 1024).toString('utf8')),
    );
    if (!parsed.success) throw new ZipError('CORRUPT', 'manifesto inesperado');
    manifest = parsed.data;
  } catch {
    await finish(id, { status: 'FAILED', error: 'resposta do serviço em formato inesperado' });
    return;
  }

  if (!manifest.ok) {
    await finish(id, {
      status: 'FAILED',
      unpacker: manifest.unpacker ?? null,
      label: manifest.label ?? null,
      error: manifest.error,
      ms: manifest.ms ?? null,
    });
    return;
  }
  if (!manifest.unpacker) {
    // O 7.1 reconhece o UPX pelo codigo de entrada mesmo sem a marca UPX!; o upx, nao.
    const packer = (entry.staticInfo as { pe?: { packer?: string | null } | null } | null)?.pe
      ?.packer;
    await finish(
      id,
      packer === 'UPX'
        ? {
            status: 'FAILED',
            unpacker: 'upx',
            label: 'UPX',
            error: 'UPX sem a marca UPX! (disfarçado): o upx não desempacota sem ela',
          }
        : { status: 'DONE', note: 'nenhum desempacotador reconheceu o arquivo', files: [] },
    );
    return;
  }

  const label = manifest.label ?? manifest.unpacker;
  const files: { name: string; size: number; entryId?: string; skipped?: string }[] = [];
  for (const file of manifest.files) {
    const zipEntry = entries.find((e) => e.path === file.entry);
    if (!zipEntry) {
      files.push({ name: file.name, size: file.size, skipped: 'faltou na resposta' });
      continue;
    }
    if (file.size > maxFile) {
      files.push({
        name: file.name,
        size: file.size,
        skipped: `maior que ${env.MAX_UPLOAD_MB} MB`,
      });
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = extractZipEntry(zip, zipEntry, '', maxFile);
    } catch {
      files.push({ name: file.name, size: file.size, skipped: 'não foi possível ler os bytes' });
      continue;
    }
    if (entry.sha256 && sha256Hex(buffer) === entry.sha256) {
      files.push({ name: file.name, size: file.size, skipped: 'igual à própria amostra' });
      continue;
    }
    const child = await createChild!({
      parentId: entryId,
      ownerId: entry.ownerId,
      tags: entry.tags,
      buffer,
      filename: childFilename(file.name, entry.originalFilename),
      title:
        file.name === 'desempacotado'
          ? `${entry.title} (desempacotado)`.slice(0, 200)
          : file.name.slice(0, 200),
      description: `Extraído de "${entry.title}" pelo desempacotador ${label}${
        file.name === 'desempacotado' ? '' : ` (${file.name})`
      }.`,
    });
    files.push({ name: file.name, size: file.size, entryId: child.id });
  }
  for (const s of manifest.skipped) files.push({ name: s.name, size: s.size, skipped: s.reason });
  const created = files.filter((f) => f.entryId).length;
  await finish(id, {
    status: 'DONE',
    unpacker: manifest.unpacker,
    label,
    note: manifest.note ?? null,
    files: files as unknown as Prisma.InputJsonValue,
    ms: manifest.ms ?? null,
  });
  if (created) {
    await recordEvent(prisma, {
      entryId,
      actorId: null,
      type: 'FILES_EXTRACTED',
      detail: `${created} arquivo(s) pelo desempacotador ${label}`,
    });
  }
  logger?.info(`[unpack] amostra ${entryId}: ${label}, ${created} arquivo(s)`);
}

/**
 * Sobe a fila. `creator` cria a amostra filha (as rotas de amostras a passam: e a mesma criacao de
 * um envio, com analise estatica, antivirus, YARA, capa e o proprio desempacotador).
 */
export async function startUnpackQueue(
  log: FastifyBaseLogger,
  creator: ChildCreator,
): Promise<void> {
  logger = log;
  createChild = creator;
  await prisma.unpackJob.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompido (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.unpackJob.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

export function stopUnpackQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
