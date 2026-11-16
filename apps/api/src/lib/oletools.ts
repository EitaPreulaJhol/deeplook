import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { CANCELLED_REASON, isQueuePaused, registerQueueWaker, startJob } from './job-control';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Office e PDF mais fundo (item 7.14 do plano; revisao de novembro, 3.2): o servico `oletools`
 * (apps/oletools) roda o olevba, o MacroRaptor, o msodde, o oleid e o rtfobj num container sem
 * rede, sem root e com a raiz somente leitura, um container por analise. Ao lado do parser de
 * documentos em TypeScript (doc-analysis.ts), que segue rodando no envio, ele traz a desofuscacao
 * das macros, as macros XLM 4.0 e o veredito do MacroRaptor.
 *
 * Mesma fila do capa (lib/capa.ts), persistida no banco: em segundo plano, um por vez, com
 * tentativas quando o servico esta fora.
 */

/** Tipos (lib/file-type.ts) que o oletools le. */
const KINDS = new Set(['ole', 'docx', 'xlsx', 'pptx', 'rtf']);
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 15_000;
const SERVICE_WAIT_MS = 120_000;
const RETRY_EVERY_MS = 2000;

/** Tempos da fila; os testes os encurtam. */
export const oletoolsTiming = {
  serviceWaitMs: SERVICE_WAIT_MS,
  retryEveryMs: RETRY_EVERY_MS,
  retryAfterMs: RETRY_AFTER_MS,
};

export function oletoolsEnabled(): boolean {
  return Boolean(env.OLETOOLS_URL && env.OLETOOLS_TOKEN);
}

/** Documento que o oletools le, dentro do teto. */
export function oletoolsEligible(
  detectedTypeId: string | null | undefined,
  size: number | null,
): boolean {
  return Boolean(
    detectedTypeId &&
    KINDS.has(detectedTypeId) &&
    size !== null &&
    size > 0 &&
    size <= env.OLETOOLS_MAX_MB * 1024 * 1024,
  );
}

const text = (max: number) => z.string().max(max);
const toolError = text(400).nullable();
const resultSchema = z.object({
  ok: z.boolean(),
  error: text(400).optional(),
  version: text(40).nullable().optional(),
  ms: z.number().int().nonnegative().optional(),
  vba: z
    .object({
      macros: z.boolean(),
      xlm: z.boolean(),
      stomping: z.boolean(),
      modules: z
        .array(
          z.object({
            name: text(300).nullable(),
            lines: z.number().int().nonnegative(),
            code: text(25_000),
            truncated: z.boolean(),
          }),
        )
        .max(60),
      keywords: z
        .array(
          z.object({
            type: text(60).nullable(),
            keyword: text(400).nullable(),
            description: text(400).nullable(),
          }),
        )
        .max(250),
      xlmLines: z.array(text(500).nullable()).max(400),
      mraptor: z
        .object({
          suspicious: z.boolean(),
          autoexec: z.boolean(),
          write: z.boolean(),
          execute: z.boolean(),
          flags: text(20).nullable(),
        })
        .nullable(),
      error: toolError,
    })
    .optional(),
  dde: z.object({ links: z.array(text(5000)).max(60), error: toolError }).optional(),
  oleid: z
    .object({
      indicators: z
        .array(
          z.object({
            id: text(80).nullable(),
            name: text(150).nullable(),
            value: text(250).nullable(),
            risk: text(30).nullable(),
            description: text(400).nullable(),
          }),
        )
        .max(50),
      error: toolError,
    })
    .optional(),
  rtf: z
    .object({
      objects: z
        .array(
          z.object({
            ole: z.boolean(),
            package: z.boolean(),
            className: text(150).nullable(),
            filename: text(250).nullable(),
            size: z.number().int().nonnegative(),
          }),
        )
        .max(60),
      error: toolError,
    })
    .nullable()
    .optional(),
});
export type OletoolsResult = z.infer<typeof resultSchema>;

export type OfficeAlert = { level: 'high' | 'medium' | 'info'; text: string };

/** Classes de objeto OLE de exploits conhecidos (Equation Editor: CVE-2017-11882 e CVE-2018-0802). */
const EXPLOIT_CLASSES = /^(equation\.3|equation\.dsmt|msequation)/i;

/** Alertas legiveis a partir do resultado (a ficha e a pontuacao de risco leem estes). */
export function officeAlerts(result: OletoolsResult): OfficeAlert[] {
  const alerts: OfficeAlert[] = [];
  const vba = result.vba;
  if (vba?.mraptor?.suspicious) {
    const what = [
      vba.mraptor.autoexec && 'executa ao abrir',
      vba.mraptor.write && 'grava arquivos',
      vba.mraptor.execute && 'executa programas',
    ].filter(Boolean);
    alerts.push({ level: 'high', text: `Macro suspeita pelo MacroRaptor: ${what.join(', ')}.` });
  } else if (vba?.macros) {
    alerts.push({ level: 'medium', text: `Contém macros VBA (${vba.modules.length} módulo(s)).` });
  }
  if (vba?.xlm) {
    alerts.push({
      level: 'high',
      text: 'Contém macros XLM 4.0 (Excel 4), muito usadas por malware.',
    });
  }
  if (vba?.stomping) {
    alerts.push({
      level: 'high',
      text: 'VBA stomping: o código-fonte não bate com o compilado (o que roda não é o que se vê).',
    });
  }
  const iocs = vba?.keywords.filter((k) => k.type === 'IOC').length ?? 0;
  if (iocs) alerts.push({ level: 'medium', text: `${iocs} indicador(es) nas macros.` });
  const decoded = vba?.keywords.filter((k) => /decod|base64|hex|dridex/i.test(k.type ?? '')).length;
  if (decoded)
    alerts.push({ level: 'medium', text: `${decoded} texto(s) ofuscado(s) decodificado(s).` });
  if (result.dde?.links.length) {
    alerts.push({
      level: 'high',
      text: `Campo DDE (executa comandos sem macro): ${result.dde.links[0].slice(0, 160)}`,
    });
  }
  const objects = result.rtf?.objects ?? [];
  const exploit = objects.find((o) => o.className && EXPLOIT_CLASSES.test(o.className));
  if (exploit) {
    alerts.push({
      level: 'high',
      text: `Objeto ${exploit.className} no RTF: o Equation Editor é alvo de exploits conhecidos (CVE-2017-11882).`,
    });
  } else if (objects.length) {
    alerts.push({ level: 'medium', text: `${objects.length} objeto(s) embutido(s) no RTF.` });
  }
  const encrypted = result.oleid?.indicators.find((i) => i.id === 'encrypted');
  if (encrypted && /true|yes/i.test(encrypted.value ?? '')) {
    alerts.push({
      level: 'info',
      text: 'Documento cifrado: parte da análise pode não ter visto o conteúdo.',
    });
  }
  return alerts;
}

/** O Postgres recusa \u0000 em JSON: o texto vem do documento. */
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

// ------------------------------------------------------------------ chamada ao servico

const service = (): AnalysisService => ({
  name: 'oletools',
  url: env.OLETOOLS_URL,
  token: env.OLETOOLS_TOKEN,
  timeoutS: env.OLETOOLS_REQUEST_TIMEOUT_S,
});

// ------------------------------------------------------------------ fila

/** Pede a analise (nova ou de novo): a amostra volta para o fim da fila. */
export async function enqueueOletools(entryId: string): Promise<void> {
  const fresh = {
    status: 'PENDING' as const,
    result: Prisma.DbNull,
    alerts: Prisma.DbNull,
    error: null,
    version: null,
    ms: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.officeAnalysis.upsert({ where: { entryId }, create: { entryId }, update: fresh });
  wake();
}

/** Depois do envio: so documento que o oletools le, com o servico ligado. */
export async function enqueueOletoolsIfEligible(
  entryId: string,
  detectedTypeId: string | null | undefined,
  size: number,
  log: { error: (o: object, m: string) => void },
): Promise<void> {
  if (!oletoolsEnabled() || !oletoolsEligible(detectedTypeId, size)) return;
  await enqueueOletools(entryId).catch((err) =>
    log.error({ err }, '[oletools] falha ao enfileirar'),
  );
}

let worker: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let logger: { info: (m: string) => void; error: (o: object, m: string) => void } = {
  info: () => undefined,
  error: () => undefined,
};

function wake(): void {
  if (worker || !oletoolsEnabled()) return;
  // Como no capa (item 8.1): sem o catch, o banco falhando vira rejeicao sem tratamento.
  worker = drain()
    .catch((err: unknown) =>
      logger.error({ err }, '[oletools] a fila parou; volta no próximo tique'),
    )
    .finally(() => (worker = null));
}

/** Para os testes: espera a fila esvaziar. */
export async function oletoolsIdle(): Promise<void> {
  while (worker) await worker;
}

async function claim() {
  const next = await prisma.officeAnalysis.findFirst({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.officeAnalysis.updateMany({
    where: { id: next.id, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  return taken.count ? prisma.officeAnalysis.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    // Fila pausada pelo Monitoramento: o que esta em andamento termina, nada novo comeca.
    if (isQueuePaused('oletools')) return;
    const job = await claim();
    if (!job) return;
    const run = startJob('oletools', job.id);
    try {
      await analyzeJob(job.id, job.entryId, job.attempts, run.signal);
    } catch (err) {
      logger.error({ err }, '[oletools] falha na análise');
      await finish(job.id, { status: 'FAILED', error: 'falha interna na análise' });
    } finally {
      run.done();
    }
  }
}

function finish(id: string, data: Prisma.OfficeAnalysisUpdateInput) {
  return prisma.officeAnalysis.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
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
      waitMs: oletoolsTiming.serviceWaitMs,
      retryEveryMs: oletoolsTiming.retryEveryMs,
    });
  } catch (err) {
    if (signal.aborted) {
      await finish(id, { status: 'FAILED', error: CANCELLED_REASON });
      return;
    }
    const reason = requestFailure(service(), err);
    if (attempts < MAX_ATTEMPTS) {
      await prisma.officeAnalysis.update({
        where: { id },
        data: {
          status: 'PENDING',
          error: reason,
          nextAttemptAt: new Date(Date.now() + oletoolsTiming.retryAfterMs * attempts),
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
  if (!result.ok) {
    await finish(id, {
      status: 'FAILED',
      error: (result.error ?? 'a análise falhou').slice(0, 300),
      version: result.version ?? null,
      ms: result.ms ?? null,
    });
    return;
  }
  await finish(id, {
    status: 'DONE',
    result: result as unknown as Prisma.InputJsonValue,
    alerts: officeAlerts(result) as unknown as Prisma.InputJsonValue,
    error: null,
    version: result.version ?? null,
    ms: result.ms ?? null,
  });
  logger.info(`[oletools] amostra ${entryId}: concluída em ${result.ms ?? '?'} ms`);
}

/** Sobe a fila: o que estava em andamento volta para a fila (ou falha, se ja gastou as tentativas). */
export async function startOletoolsQueue(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.officeAnalysis.updateMany({
    where: { status: 'RUNNING', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.officeAnalysis.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  registerQueueWaker('oletools', wake);
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

/** Para os testes: desliga o tique. */
export function stopOletoolsQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
