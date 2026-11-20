import { gunzipSync } from 'node:zlib';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { CANCELLED_REASON, isQueuePaused, registerQueueWaker, startJob } from './job-control';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Analise com o Ghidra (item 7.3): sob demanda (so analistas pedem), no servico `ghidra`
 * (apps/ghidra), sem rede, sem root, raiz somente leitura e um container por analise. A fila e a
 * mesma ideia da do capa (7.2): persistida no banco, um trabalho por vez, com novas tentativas
 * quando o servico esta fora. O resultado e o resumo (maiores funcoes, quem chama APIs sensiveis e
 * o pseudo-C delas) e o projeto .gzf, que tem os bytes da amostra e por isso mora sob samples/.
 * Desde plans/ghidra-pseudo-c, vem tambem o pseudo-C de todas as funcoes: um texto so no MinIO,
 * fora de samples/, e o indice em GhidraFunction, com o deslocamento de cada funcao no texto.
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
 * Onde o pseudo-C completo fica no MinIO: FORA de samples/. E texto derivado, como o resumo:
 * continua depois do expurgo da retencao e entra no backup sem amostras.
 */
export const ghidraPseudoKey = (entryId: string) => `ghidra/${entryId}.c`;

/** Teto do JSON do pseudo-C descomprimido: o mesmo do servico (apps/ghidra/server.py). */
export const ghidraPseudoMax = () => (2 * env.GHIDRA_MAX_PSEUDO_MB + 64) * 1024 * 1024;

/** Funcoes por insercao no banco (o Postgres aceita ate 65 535 parametros por comando). */
const INSERT_CHUNK = 1000;

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
  // Function ID (item 25): as funcoes de biblioteca reconhecidas e de quais bibliotecas.
  libraryFunctions: z.number().int().nonnegative().optional(),
  // BSim (item 23): funcoes parecidas em outras amostras, pelo SHA-256 delas.
  bsim: z
    .object({
      queried: z.number().int().nonnegative().optional(),
      inserted: z.number().int().nonnegative().optional(),
      shared: z
        .array(z.object({ sha256: z.string().max(64), functions: z.number().int().nonnegative() }))
        .max(50)
        .optional(),
      matches: z
        .array(
          z.object({
            function: z.string().max(300),
            address: z.string().max(40),
            matches: z
              .array(
                z.object({
                  sha256: z.string().max(64),
                  function: z.string().max(300),
                  address: z.string().max(40),
                  similarity: z.number(),
                  significance: z.number(),
                }),
              )
              .max(10),
          }),
        )
        .max(300)
        .optional(),
      error: z.string().max(300).optional(),
    })
    .optional(),
  libraries: z
    .array(z.object({ name: z.string().max(120), functions: z.number().int().nonnegative() }))
    .max(30)
    .optional(),
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
  /**
   * Analise mais leve (plans/ajustes-usabilidade, item 2): sem os analisadores listados, pelo
   * tamanho do binario (GHIDRA_LIGHT_MB no servico).
   */
  light: z.object({ reason: z.enum(['size']), analyzers: z.array(text(120)).max(10) }).optional(),
});
export type GhidraSummary = z.infer<typeof summarySchema>;

const count = z
  .number()
  .int()
  .nonnegative()
  .max(2 ** 31 - 1);
/** Pseudo-C completo (apps/ghidra/scripts/ExportDeepLook.java, pseudo.json). */
const pseudoSchema = z
  .object({
    total: count,
    deadlineHit: z.boolean(),
    capHit: z.boolean(),
    functions: z
      .array(
        z.object({
          name,
          entry: address,
          size: count,
          complexity: z
            .number()
            .int()
            .min(-1)
            .max(2 ** 31 - 1),
          isEntryPoint: z.boolean(),
          library: z.boolean(),
          sensitive: z.array(name).max(200),
          apis: z.array(name).max(40),
          callers: z.array(address).max(50),
          callerCount: count,
          callees: z.array(address).max(50),
          calleeCount: count,
          c: text(256_000).optional(),
          truncated: z.boolean().optional(),
          skipped: z.enum(['deadline', 'cap']).optional(),
          error: text(1000).nullish(),
        }),
      )
      .max(20_000),
  })
  // O endereco e a chave da funcao (link direto, chamadores, chamadas).
  .refine((p) => new Set(p.functions.map((f) => f.entry)).size === p.functions.length);
type Pseudo = z.infer<typeof pseudoSchema>;

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
    // Pseudo-C completo (JSON com gzip, em base64); um servico antigo nao manda.
    pseudo: z.string().nullish(),
    pseudoError: text(400).nullish(),
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

// ------------------------------------------------------------------ pseudo-C completo

/** A analise sem o pseudo-C completo. */
const NO_PSEUDO = {
  pseudoKey: null,
  pseudoSize: null,
  pseudoError: null,
  pseudoTotal: null,
  pseudoDeadlineHit: false,
  pseudoCapHit: false,
};

/** Apaga o pseudo-C completo da amostra: o texto no MinIO e o indice (idempotente). */
export async function deleteGhidraPseudo(entryId: string): Promise<void> {
  const row = await prisma.ghidraAnalysis.findUnique({
    where: { entryId },
    select: { id: true, pseudoKey: true },
  });
  if (!row) return;
  if (row.pseudoKey) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: row.pseudoKey }));
  }
  await prisma.$transaction([
    prisma.ghidraFunction.deleteMany({ where: { analysisId: row.id } }),
    prisma.ghidraAnalysis.update({ where: { id: row.id }, data: NO_PSEUDO }),
  ]);
}

/** O codigo de uma funcao, lido do texto no MinIO so na faixa dela (Range). */
export async function readGhidraFunction(
  key: string,
  offset: number,
  length: number,
): Promise<string> {
  if (length === 0) return '';
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Range: `bytes=${offset}-${offset + length - 1}`,
    }),
  );
  return Buffer.from(await obj.Body!.transformToByteArray()).toString('utf8');
}

type PseudoRow = Omit<Prisma.GhidraFunctionCreateManyInput, 'analysisId'>;
interface PreparedPseudo {
  fields: Omit<Prisma.GhidraAnalysisUpdateInput, 'functions'>;
  rows: PseudoRow[];
}

function decodePseudo(b64: string): Pseudo | string {
  const packed = Buffer.from(b64, 'base64');
  let raw: Buffer;
  try {
    // O teto vale para o descomprimido: um gzip pequeno pode virar gigabytes (bomba de gzip).
    raw = gunzipSync(packed, { maxOutputLength: ghidraPseudoMax() });
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
      ? 'pseudo-C completo acima do limite'
      : 'pseudo-C completo em formato inesperado';
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    return 'pseudo-C completo em formato inesperado';
  }
  const parsed = pseudoSchema.safeParse(json);
  return parsed.success ? withoutNul(parsed.data) : 'pseudo-C completo em formato inesperado';
}

/**
 * Valida o pseudo-C completo, monta o texto (cada funcao precedida de um comentario com o nome e o
 * endereco, para o arquivo baixado se ler sozinho) e o grava no MinIO. Devolve as colunas da
 * analise e as linhas do indice; uma falha so tira o pseudo-C, com o motivo: o resumo vale sem ele.
 */
async function preparePseudo(
  entryId: string,
  b64: string | null | undefined,
  serviceError: string | null | undefined,
): Promise<PreparedPseudo> {
  if (!b64) return { fields: { ...NO_PSEUDO, pseudoError: serviceError ?? null }, rows: [] };
  const pseudo = decodePseudo(b64);
  if (typeof pseudo === 'string')
    return { fields: { ...NO_PSEUDO, pseudoError: pseudo }, rows: [] };

  const chunks: Buffer[] = [];
  let offset = 0;
  const rows = pseudo.functions.map((f, rank): PseudoRow => {
    let cOffset: number | null = null;
    let cLength: number | null = null;
    if (f.c !== undefined) {
      const label = `${f.name} @ ${f.entry}`.replaceAll('*/', '*\\/').replace(/[\r\n]+/g, ' ');
      const head = Buffer.from(`/* ${label} */\n`, 'utf8');
      const code = Buffer.from(f.c, 'utf8');
      cOffset = offset + head.length;
      cLength = code.length;
      chunks.push(head, code, Buffer.from('\n\n'));
      offset = cOffset + cLength + 2;
    }
    return {
      rank,
      entry: f.entry,
      name: f.name,
      size: f.size,
      complexity: f.complexity,
      isEntryPoint: f.isEntryPoint,
      library: f.library,
      sensitive: f.sensitive,
      apis: f.apis,
      callers: f.callers,
      callerCount: f.callerCount,
      callees: f.callees,
      calleeCount: f.calleeCount,
      cOffset,
      cLength,
      truncated: f.truncated ?? false,
      skipped: f.c === undefined ? (f.skipped ?? null) : null,
      error: f.c === undefined && !f.skipped ? (f.error ?? 'sem resultado') : null,
    };
  });
  const key = ghidraPseudoKey(entryId);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: Buffer.concat(chunks, offset),
        // A rota de download poe o charset; aqui so o tipo.
        ContentType: 'text/plain',
      }),
    );
  } catch {
    return {
      fields: { ...NO_PSEUDO, pseudoError: 'não foi possível gravar o pseudo-C no armazenamento' },
      rows: [],
    };
  }
  return {
    fields: {
      pseudoKey: key,
      pseudoSize: offset,
      pseudoError: null,
      pseudoTotal: pseudo.total,
      pseudoDeadlineHit: pseudo.deadlineHit,
      pseudoCapHit: pseudo.capHit,
    },
    rows,
  };
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
  // O projeto e o pseudo-C anteriores saem antes: os novos tem a mesma chave, e uma falha nao
  // deixa os velhos parecendo os da analise nova.
  await deleteGhidraProject(entryId).catch(() => undefined);
  await deleteGhidraPseudo(entryId).catch(() => undefined);
  const fresh = {
    ...NO_PSEUDO,
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
  if (worker || !ghidraEnabled()) return;
  // Sem o catch, o banco falhando no claim() derruba a API (ver o wake de lib/capa.ts).
  worker = drain()
    .catch((err: unknown) => logger.error({ err }, '[ghidra] a fila parou; volta no próximo tique'))
    .finally(() => (worker = null));
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
    // Fila pausada pelo Monitoramento: o que esta em andamento termina, nada novo comeca.
    if (isQueuePaused('ghidra')) return;
    const job = await claim();
    if (!job) return;
    const run = startJob('ghidra', job.id);
    try {
      await analyzeJob(job.id, job.entryId, job.attempts, run.signal);
    } catch (err) {
      logger.error({ err }, '[ghidra] falha na análise');
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    } finally {
      run.done();
    }
  }
}

function finish(id: string, data: Prisma.GhidraAnalysisUpdateInput) {
  return prisma.ghidraAnalysis.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

async function analyzeJob(
  id: string,
  entryId: string,
  attempts: number,
  signal: AbortSignal,
): Promise<void> {
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
      signal,
      waitMs: ghidraTiming.serviceWaitMs,
      retryEveryMs: ghidraTiming.retryEveryMs,
    });
  } catch (err) {
    if (signal.aborted) {
      await finish(id, { status: 'FAILED', error: CANCELLED_REASON });
      return;
    }
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
  const pseudo = await preparePseudo(entryId, result.pseudo, result.pseudoError);
  try {
    // O indice e a analise concluida juntos: nunca uma analise DONE com metade das funcoes.
    await prisma.$transaction(
      async (tx) => {
        await tx.ghidraFunction.deleteMany({ where: { analysisId: id } });
        for (let i = 0; i < pseudo.rows.length; i += INSERT_CHUNK) {
          await tx.ghidraFunction.createMany({
            data: pseudo.rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, analysisId: id })),
          });
        }
        await tx.ghidraAnalysis.update({
          where: { id },
          data: {
            finishedAt: new Date(),
            status: 'DONE',
            summary: withoutNul(result.summary) as unknown as Prisma.InputJsonValue,
            gzfKey,
            gzfSize,
            gzfError,
            ...pseudo.fields,
            error: null,
            version: result.version,
            ms: result.ms,
          },
        });
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    // O texto ja foi gravado; sem o indice, ele nao serve (drain() marca a analise como FAILED).
    if (pseudo.fields.pseudoKey) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: ghidraPseudoKey(entryId) }))
        .catch(() => undefined);
    }
    throw err;
  }
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
  registerQueueWaker('ghidra', wake);
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
