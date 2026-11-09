import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { normalizeTechniques, TECHNIQUE_ID } from './attack';
import { extractIocs, type Ioc } from './iocs';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Analise de funcoes (item 7.2): o servico `capa` (apps/capa) roda o capa e o FLOSS num container
 * sem rede, sem root e com a raiz somente leitura, um container por analise. Aqui fica a fila:
 * em segundo plano, um trabalho por vez, e persistida no banco (a API pode reiniciar no meio).
 * Uma analise leva de segundos a minutos (o capa passou de 17 min num PE de 4.000 funcoes), entao
 * nunca entra no caminho do envio.
 */

/** Executaveis que o capa le (o FLOSS so decifra os do Windows; o servico decide). */
const KINDS = new Set(['pe', 'elf']);
/** Tentativas com o servico fora do ar, antes de dar a analise como falha. */
const MAX_ATTEMPTS = 3;
/** Espera entre tentativas, multiplicada pela tentativa (5, 10 min). */
const RETRY_AFTER_MS = 5 * 60 * 1000;

/** De quanto em quanto tempo a fila olha se ha trabalho (o envio tambem a acorda na hora). */
const TICK_MS = 15_000;
/**
 * Espera pelo servico (como a captura, item 6.17): cada analise roda num container novo, e entre
 * uma e outra o `capa` recusa conexao ou responde 503 enquanto o Docker o sobe de novo.
 */
const SERVICE_WAIT_MS = 120_000;
const RETRY_EVERY_MS = 2000;

/** Tempos da fila; os testes os encurtam (os de producao sao os de cima). */
export const capaTiming = {
  serviceWaitMs: SERVICE_WAIT_MS,
  retryEveryMs: RETRY_EVERY_MS,
  retryAfterMs: RETRY_AFTER_MS,
};
/** Indicadores das strings do FLOSS guardados como sugestao, por tipo. */
const IOCS_PER_KIND = 15;

const NOT_CONNECTED = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];

export function capaEnabled(): boolean {
  return Boolean(env.CAPA_URL && env.CAPA_TOKEN);
}

/** O arquivo e um executavel que o capa le e cabe no teto. */
export function capaEligible(
  detectedTypeId: string | null | undefined,
  size: number | null,
): boolean {
  return Boolean(
    detectedTypeId &&
    KINDS.has(detectedTypeId) &&
    size !== null &&
    size > 0 &&
    size <= env.CAPA_MAX_MB * 1024 * 1024,
  );
}

// ------------------------------------------------------------------ resposta do servico

/** O servico e confiavel, mas le arquivo malicioso: a resposta e validada e tem teto. */
const text = (max: number) => z.string().max(max);
const ruleSchema = z.object({
  name: text(200),
  namespace: text(200),
  attack: z.array(text(20)).max(50),
  mbc: z.array(text(300)).max(50),
  matches: z.number().int().nonnegative(),
  addresses: z.array(text(24)).max(20),
});
const capaSchema = z.object({
  format: text(40).nullish(),
  arch: text(40).nullish(),
  os: text(40).nullish(),
  functions: z.number().int().nonnegative().nullish(),
  libraryFunctions: z.number().int().nonnegative().nullish(),
  rules: z.array(ruleSchema).max(500),
  truncated: z.boolean(),
});
const flossString = z.object({ string: text(400), function: text(24).nullable() });
const flossSchema = z.object({
  stack: z.array(flossString).max(300),
  tight: z.array(flossString).max(300),
  decoded: z.array(flossString).max(300),
  truncated: z.boolean(),
});
const resultSchema = z.object({
  ok: z.literal(true),
  kind: z.enum(['pe', 'elf']).nullable(),
  versions: z.object({
    capa: text(40).nullable(),
    floss: text(40).nullable(),
    rules: text(40).nullable(),
  }),
  capa: capaSchema.nullable(),
  capaError: text(400).nullable(),
  floss: flossSchema.nullable(),
  flossError: text(400).nullable(),
  ms: z.number().int().nonnegative(),
});
export type CapaResult = z.infer<typeof capaSchema>;
export type FlossResult = z.infer<typeof flossSchema>;

/** O Postgres recusa \u0000 em JSON e em texto; as strings vem do arquivo. */
function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutNul(v)])) as T;
  }
  return value;
}

/** Tecnicas ATT&CK das regras, so as que existem no ATT&CK embutido. */
export function capaTechniques(capa: CapaResult | null): string[] {
  const ids = (capa?.rules ?? []).flatMap((r) => r.attack).filter((id) => TECHNIQUE_ID.test(id));
  return normalizeTechniques(ids);
}

/** Indicadores nas strings que so o FLOSS ve (montadas na pilha ou decifradas). */
export function flossIocs(floss: FlossResult | null): Ioc[] {
  if (!floss) return [];
  const all = extractIocs(
    [...floss.stack, ...floss.tight, ...floss.decoded].map((s) => s.string).join('\n'),
  );
  const count = new Map<string, number>();
  return all.filter((ioc) => {
    const n = (count.get(ioc.kind) ?? 0) + 1;
    count.set(ioc.kind, n);
    return n <= IOCS_PER_KIND;
  });
}

// ------------------------------------------------------------------ chamada ao servico

class ServiceUnavailable extends Error {}

function notConnected(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === 'TimeoutError' || err.name === 'AbortError') {
    return false;
  }
  return NOT_CONNECTED.includes((err.cause as { code?: string } | undefined)?.code ?? '');
}

/** O servico esta de pe e livre (nao analisando nem trocando de container). */
async function serviceReady(): Promise<boolean> {
  try {
    const res = await fetch(`${env.CAPA_URL.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as { state?: string };
    return body.state === undefined || body.state === 'livre';
  } catch {
    return false;
  }
}

/**
 * Manda o arquivo quando o servico estiver livre. Cada analise roda num container novo, e a troca
 * leva alguns segundos: o /health (um GET, seguro de repetir) diz quando o container novo esta
 * pronto, e so entao o arquivo sai. Mandar o POST no meio da troca podia ter a conexao derrubada,
 * o que nao se distingue do arquivo derrubando o container. Conexao que cai depois de aberta NAO
 * e repetida aqui: a fila decide (conta como tentativa).
 */
export async function requestAnalysis(
  data: Uint8Array,
  { waitMs = capaTiming.serviceWaitMs, retryEveryMs = capaTiming.retryEveryMs } = {},
): Promise<Response> {
  const deadline = Date.now() + waitMs;
  const pause = () => new Promise((resolve) => setTimeout(resolve, retryEveryMs));
  for (;;) {
    if (!(await serviceReady())) {
      if (Date.now() >= deadline) throw new ServiceUnavailable('o serviço capa não respondeu');
      await pause();
      continue;
    }
    try {
      const res = await fetch(`${env.CAPA_URL.replace(/\/$/, '')}/analyze`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${env.CAPA_TOKEN}`,
        },
        body: data,
        signal: AbortSignal.timeout(env.CAPA_REQUEST_TIMEOUT_S * 1000),
      });
      if (res.status !== 503) return res;
      await res.body?.cancel();
      if (Date.now() >= deadline) throw new ServiceUnavailable('o serviço capa está ocupado');
    } catch (err) {
      if (err instanceof ServiceUnavailable) throw err;
      if (!notConnected(err)) throw err;
      if (Date.now() >= deadline) throw new ServiceUnavailable('o serviço capa não respondeu');
    }
    await pause();
  }
}

// ------------------------------------------------------------------ fila

/** Pede a analise (nova ou de novo): a amostra volta para o fim da fila. */
export async function enqueueCapa(entryId: string): Promise<void> {
  const fresh = {
    status: 'PENDING' as const,
    capa: Prisma.DbNull,
    floss: Prisma.DbNull,
    attack: [],
    iocCandidates: Prisma.DbNull,
    capaError: null,
    flossError: null,
    error: null,
    versions: Prisma.DbNull,
    ms: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.capaAnalysis.upsert({
    where: { entryId },
    create: { entryId, attack: [] },
    update: fresh,
  });
  wake();
}

/** Depois do envio: so executavel do Windows ou do Linux dentro do teto, com o servico ligado. */
export async function enqueueCapaIfEligible(
  entryId: string,
  detectedTypeId: string | null | undefined,
  size: number,
  log: { error: (o: object, m: string) => void },
): Promise<void> {
  if (!capaEnabled() || !capaEligible(detectedTypeId, size)) return;
  await enqueueCapa(entryId).catch((err) => log.error({ err }, '[capa] falha ao enfileirar'));
}

let worker: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let logger: { info: (m: string) => void; error: (o: object, m: string) => void } = {
  info: () => undefined,
  error: () => undefined,
};

/** Acorda a fila agora (sem esperar o proximo tique). */
function wake(): void {
  if (!worker && capaEnabled()) worker = drain().finally(() => (worker = null));
}

/** Para os testes: espera a fila esvaziar. */
export async function capaIdle(): Promise<void> {
  while (worker) await worker;
}

/** Proxima analise da fila, marcada como em andamento (so uma instancia a pega). */
async function claim() {
  const next = await prisma.capaAnalysis.findFirst({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.capaAnalysis.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.capaAnalysis.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    const job = await claim();
    if (!job) return;
    try {
      await analyzeJob(job.id, job.entryId, job.attempts);
    } catch (err) {
      logger.error({ err }, '[capa] falha na análise');
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    }
  }
}

function finish(id: string, data: Prisma.CapaAnalysisUpdateInput) {
  return prisma.capaAnalysis.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

async function analyzeJob(id: string, entryId: string, attempts: number): Promise<void> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { storageKey: true, bucket: true, filePurgedAt: true, deletedAt: true },
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
    res = await requestAnalysis(data);
  } catch (err) {
    const reason =
      err instanceof ServiceUnavailable
        ? err.message
        : err instanceof Error && err.name === 'TimeoutError'
          ? `sem resposta em ${env.CAPA_REQUEST_TIMEOUT_S} s`
          : 'a conexão com o serviço caiu durante a análise';
    // Servico fora do ar: tenta de novo mais tarde. Conexao que caiu no meio pode ser o proprio
    // arquivo derrubando o container: conta como tentativa, e na ultima a analise falha.
    if (attempts < MAX_ATTEMPTS) {
      await prisma.capaAnalysis.update({
        where: { id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + capaTiming.retryAfterMs * attempts),
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
  const result = withoutNul(parsed.data);
  const done = Boolean(result.capa || result.floss);
  await finish(id, {
    status: done ? 'DONE' : 'FAILED',
    capa: (result.capa ?? undefined) as Prisma.InputJsonValue | undefined,
    floss: (result.floss ?? undefined) as Prisma.InputJsonValue | undefined,
    attack: capaTechniques(result.capa),
    iocCandidates: flossIocs(result.floss) as unknown as Prisma.InputJsonValue,
    capaError: result.capaError,
    flossError: result.flossError,
    error: done ? null : (result.capaError ?? 'o capa não produziu resultado'),
    versions: result.versions as Prisma.InputJsonValue,
    ms: result.ms,
  });
  logger.info(`[capa] amostra ${entryId}: ${done ? 'concluída' : 'falhou'} em ${result.ms} ms`);
}

/**
 * Sobe a fila: o que estava em andamento quando a API parou volta para a fila (ou falha, se ja
 * gastou as tentativas), e depois a cada TICK_MS a fila procura trabalho.
 */
export async function startCapaQueue(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.capaAnalysis.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.capaAnalysis.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

/** Para os testes: desliga o tique. */
export function stopCapaQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
