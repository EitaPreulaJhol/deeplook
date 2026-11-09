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
import { applyTriageRulesQuietly } from './triage-rules';
import { extractZipEntry, listZip, ZipError } from './zip';

/**
 * Identificar e desempacotar (itens 7.8 e 7.9): o servico `unpack` (apps/unpack) identifica o
 * arquivo com o Detect It Easy (compilador, empacotador, protetor, instalador) e roda upx, 7-Zip,
 * innoextract e pyinstxtractor num container sem rede. Cada arquivo que sai vira uma amostra filha,
 * que passa por toda a analise de novo: assim o capa e o Ghidra veem o codigo de verdade, nao o
 * descompactador do UPX nem o instalador. A fila e a mesma ideia da do capa (7.2).
 */

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 15_000;
/**
 * Geracoes de desempacotamento: a amostra, o que saiu dela e o que saiu disso (um instalador com
 * um UPX dentro). Dali em diante o arquivo so e identificado, contra instalador dentro de
 * instalador sem fim.
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

/**
 * Tipos reais que vao para o servico: o Detect It Easy (item 7.9) identifica todos; os
 * desempacotadores so agem em executavel do Windows ou do Linux.
 */
const KINDS = new Set(['pe', 'elf', 'macho', 'apk', 'jar']);

/** Vai para o servico? Executavel (ou pacote Android/Java) dentro do teto. */
export function identifiable(
  staticInfo: { detectedType?: { id?: string } | null } | null | undefined,
  size: number,
): boolean {
  const kind = staticInfo?.detectedType?.id;
  return Boolean(kind && KINDS.has(kind) && size > 0 && size <= env.UNPACK_MAX_MB * 1024 * 1024);
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

const detectionSchema = z.object({
  filetype: z.string().max(40),
  type: z.string().max(40),
  name: z.string().max(120),
  version: z.string().max(80),
  info: z.string().max(120),
  string: z.string().max(240),
});
export type Detection = z.infer<typeof detectionSchema>;
const ident = {
  detections: z.array(detectionSchema).max(50).optional(),
  dieVersion: z.string().max(20).nullish(),
  dieError: z.string().max(300).nullish(),
};

const manifestSchema = z.union([
  z.object({
    ...ident,
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
          // A filha ja identificada pelo servico, e se algum desempacotador a reconhece.
          detections: z.array(detectionSchema).max(50).optional(),
          dieError: z.string().max(300).nullish(),
          candidate: z.boolean().optional(),
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
    ...ident,
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
  /** Ja identificada na mesma rodada; `candidate` falso = nada a desempacotar, sem nova rodada. */
  identified?: Identified;
}

export interface Identified {
  detections: Detection[];
  dieVersion: string | null;
  dieError: string | null;
  candidate: boolean;
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

/** Na chegada: todo executavel (ou pacote) dentro do teto, com o servico ligado. */
export async function enqueueIdentify(
  entryId: string,
  size: number,
  staticInfo: Parameters<typeof identifiable>[0],
  log: { error: (o: object, m: string) => void },
): Promise<void> {
  try {
    if (!unpackEnabled() || !identifiable(staticInfo, size)) return;
    await enqueue(entryId);
  } catch (err) {
    log.error({ err }, '[unpack] falha ao enfileirar');
  }
}

/**
 * Amostra filha que o servico ja identificou e que nenhum desempacotador reconhece: o trabalho ja
 * nasce concluido, sem outra rodada (cada rodada custa um container novo, de 10 s ou mais).
 */
export async function recordIdentified(
  entryId: string,
  identified: Identified,
  staticInfo: unknown,
): Promise<void> {
  const outcome = notUnpacked(identified.detections, staticInfo, true);
  await prisma.unpackJob.upsert({
    where: { entryId },
    create: {
      entryId,
      ...(outcome as Prisma.UnpackJobCreateWithoutEntryInput),
      detections: identified.detections as unknown as Prisma.InputJsonValue,
      dieVersion: identified.dieVersion,
      dieError: identified.dieError,
      attempts: 0,
      finishedAt: new Date(),
    },
    update: {},
  });
  await applyTriageRulesQuietly(entryId);
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
  if (worker || !unpackEnabled() || !createChild) return;
  // Sem o catch, o banco falhando no claim() derruba a API (ver o wake de lib/capa.ts).
  worker = drain()
    .catch((err: unknown) =>
      logger?.error({ err }, '[unpack] a fila parou; volta no próximo tique'),
    )
    .finally(() => (worker = null));
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

/**
 * Nenhum desempacotador agiu: por que, com o que o Detect It Easy viu. Protetor (Themida,
 * VMProtect...) e empacotador sem desempacotador estatico viram nota; o UPX alterado (marca UPX!
 * apagada), que o 7.1 e o DIE reconhecem mas o upx nao desempacota, vira falha com o motivo.
 */
function notUnpacked(
  detections: Detection[],
  staticInfo: unknown,
  unpack: boolean,
): Prisma.UnpackJobUpdateInput {
  if (!unpack) {
    return {
      status: 'DONE',
      files: [],
      note: 'só identificado: já há duas gerações desempacotadas acima',
    };
  }
  const packer7 = (staticInfo as { pe?: { packer?: string | null } | null } | null)?.pe?.packer;
  const upxModified = detections.some(
    (d) => d.type.toLowerCase() === 'packer' && /upx/i.test(d.name) && /modified/i.test(d.info),
  );
  if (packer7 === 'UPX' || upxModified) {
    return {
      status: 'FAILED',
      unpacker: 'upx',
      label: 'UPX',
      error: 'UPX sem a marca UPX! (disfarçado): o upx não desempacota sem ela',
    };
  }
  const protector = detections.find((d) => d.type.toLowerCase() === 'protector');
  if (protector) {
    return {
      status: 'DONE',
      files: [],
      note: `protegido com ${protector.name} (Detect It Easy): precisa de um desempacotador que execute a amostra`,
    };
  }
  const packer = detections.find((d) => d.type.toLowerCase() === 'packer');
  if (packer) {
    return {
      status: 'DONE',
      files: [],
      note: `empacotado com ${packer.name} (Detect It Easy): nenhum desempacotador estático para ele`,
    };
  }
  return { status: 'DONE', files: [], note: 'nada a desempacotar' };
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

  // Duas geracoes de desempacotamento acima: so identificar.
  const unpack = (await unpackDepth(entryId)) < MAX_DEPTH;
  let res: Response;
  try {
    res = await requestAnalysis(service(), data, {
      waitMs: unpackTiming.serviceWaitMs,
      retryEveryMs: unpackTiming.retryEveryMs,
      query: unpack ? '' : '?unpack=0',
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

  const identified = {
    detections: (manifest.detections ?? []) as unknown as Prisma.InputJsonValue,
    dieVersion: manifest.dieVersion ?? null,
    dieError: manifest.dieError ?? null,
  };
  if (!manifest.ok) {
    await finish(id, {
      status: 'FAILED',
      unpacker: manifest.unpacker ?? null,
      label: manifest.label ?? null,
      error: manifest.error,
      ms: manifest.ms ?? null,
      ...identified,
    });
    await applyTriageRulesQuietly(entryId);
    return;
  }
  // O limite de geracoes vale aqui, nao so no servico: um que ignore o ?unpack=0 e devolva arquivos
  // (o que este teste simula) criaria filha de filha sem fim.
  if (!manifest.unpacker || !unpack) {
    await finish(id, {
      ...notUnpacked(manifest.detections ?? [], entry.staticInfo, unpack),
      ...identified,
    });
    await applyTriageRulesQuietly(entryId);
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
    const input: UnpackedChild = {
      parentId: entryId,
      ownerId: entry.ownerId,
      tags: entry.tags,
      buffer,
      filename: childFilename(file.name, entry.originalFilename),
      title:
        file.name === 'desempacotado'
          ? `${entry.title} (desempacotado)`.slice(0, 200)
          : file.name.slice(0, 200),
      identified: file.detections
        ? {
            detections: file.detections,
            dieVersion: manifest.dieVersion ?? null,
            dieError: file.dieError ?? null,
            candidate: file.candidate ?? true,
          }
        : undefined,
      description: `Extraído de "${entry.title}" pelo desempacotador ${label}${
        file.name === 'desempacotado' ? '' : ` (${file.name})`
      }.`,
    };
    let child: { id: string };
    try {
      child = await createChild!(input);
    } catch (err) {
      // Falhou no meio (armazenamento ou banco fora): as filhas ja criadas ficam na lista, para a
      // ficha mostra-las e para um novo pedido nao as duplicar.
      logger?.error({ err }, '[unpack] falha ao criar a amostra filha');
      const made = files.filter((f) => f.entryId).length;
      await finish(id, {
        status: 'FAILED',
        unpacker: manifest.unpacker,
        label,
        files: files as unknown as Prisma.InputJsonValue,
        error: `falha ao criar as amostras filhas (${made} de ${manifest.files.length} criadas)`,
        ms: manifest.ms ?? null,
        ...identified,
      });
      return;
    }
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
    ...identified,
  });
  await applyTriageRulesQuietly(entryId);
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
