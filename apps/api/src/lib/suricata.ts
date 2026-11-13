import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * Suricata sobre o pcap do sandbox (plano pos-revisao, item 5.4). O servico `suricata`
 * (apps/suricata/server.py) roda `suricata -r` com as regras ET Open e devolve o eve.json resumido:
 * alertas, DNS, HTTP e TLS. Mesma fila das outras analises (lib/qr.ts): persistida no banco, em
 * segundo plano, uma por vez, com tentativas quando o servico esta fora ou atualizando as regras.
 */

const MAX_ATTEMPTS = 3;
const TICK_MS = 15_000;

/** Tempos da fila; os testes os encurtam. A primeira subida baixa as regras: espera longa. */
export const suricataTiming = {
  serviceWaitMs: 15 * 60 * 1000,
  retryEveryMs: 3000,
  retryAfterMs: 5 * 60 * 1000,
};

export const suricataEnabled = (): boolean => Boolean(env.SURICATA_URL && env.SURICATA_TOKEN);

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.slice(0, max));
const endpoint = text(80).nullable().optional();

const alertSchema = z.object({
  sid: z.number().int(),
  signature: text(500),
  category: text(120).nullable().optional(),
  severity: z.number().int().nullable().optional(),
  proto: text(10).nullable().optional(),
  src: endpoint,
  dst: endpoint,
  time: text(40).nullable().optional(),
  count: z.number().int().nonnegative(),
});
const dnsSchema = z.object({
  name: text(255),
  type: text(10).nullable().optional(),
  answers: z.array(text(255)).max(10),
  time: text(40).nullable().optional(),
  count: z.number().int().nonnegative(),
});
const httpSchema = z.object({
  host: text(255).nullable().optional(),
  method: text(16).nullable().optional(),
  url: text(500).nullable().optional(),
  status: z.number().int().nullable().optional(),
  userAgent: text(255).nullable().optional(),
  dst: endpoint,
  time: text(40).nullable().optional(),
  count: z.number().int().nonnegative(),
});
const tlsSchema = z.object({
  sni: text(255).nullable().optional(),
  subject: text(500).nullable().optional(),
  issuer: text(500).nullable().optional(),
  version: text(20).nullable().optional(),
  notAfter: text(40).nullable().optional(),
  dst: endpoint,
  time: text(40).nullable().optional(),
  count: z.number().int().nonnegative(),
});
const resultSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(400).optional(),
  version: z.string().max(40).nullable().optional(),
  rules: z
    .object({
      count: z.number().int().nonnegative(),
      updatedAt: z.string().max(40).nullable(),
      lastError: z.string().max(400).nullable().optional(),
    })
    .optional(),
  alerts: z.array(alertSchema).max(200).optional(),
  dns: z.array(dnsSchema).max(500).optional(),
  http: z.array(httpSchema).max(500).optional(),
  tls: z.array(tlsSchema).max(500).optional(),
  alertsTotal: z.number().int().nonnegative().optional(),
  ms: z.number().int().nonnegative().optional(),
});

export type SuricataResult = Required<
  Pick<z.infer<typeof resultSchema>, 'alerts' | 'dns' | 'http' | 'tls' | 'alertsTotal'>
> & {
  version: string | null;
  rules: { count: number; updatedAt: string | null } | null;
};

const service = (): AnalysisService => ({
  name: 'Suricata',
  url: env.SURICATA_URL,
  token: env.SURICATA_TOKEN,
  timeoutS: env.SURICATA_REQUEST_TIMEOUT_S,
});

// ------------------------------------------------------------------ indicadores

const PRIVATE_IP =
  /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|255\.|22[4-9]\.|23\d\.)/;
const ipOf = (endpointText: string | null | undefined) =>
  endpointText ? endpointText.replace(/:\d+$/, '') : null;

/**
 * Indicadores do trafego: nomes consultados no DNS, hosts HTTP, SNI do TLS e os IPs publicos de
 * destino dos alertas. Vao para os IOCs sugeridos da amostra.
 */
export function suricataIndicators(result: SuricataResult | null): string[] {
  if (!result) return [];
  const out = new Set<string>();
  const host = (h: string | null | undefined) => {
    const v = h?.trim().toLowerCase();
    if (v && !v.endsWith('.invalid') && !v.endsWith('.local') && v.includes('.')) out.add(v);
  };
  for (const d of result.dns) host(d.name);
  for (const h of result.http) host(h.host?.replace(/:\d+$/, ''));
  for (const t of result.tls) host(t.sni);
  for (const a of result.alerts) {
    for (const ip of [ipOf(a.dst), ipOf(a.src)]) {
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !PRIVATE_IP.test(ip)) out.add(ip);
    }
  }
  return [...out];
}

// ------------------------------------------------------------------ fila

/** Pede a analise (nova ou de novo): volta para o fim da fila. */
export async function enqueueSuricata(captureId: string): Promise<void> {
  await prisma.networkCapture.update({
    where: { id: captureId },
    data: {
      idsStatus: 'PENDING',
      idsResult: Prisma.DbNull,
      idsError: null,
      idsMs: null,
      idsAttempts: 0,
      idsNextAttemptAt: new Date(),
      idsQueuedAt: new Date(),
      idsStartedAt: null,
      idsFinishedAt: null,
    },
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
  if (worker || !suricataEnabled()) return;
  worker = drain()
    .catch((err: unknown) =>
      logger.error({ err }, '[suricata] a fila parou; volta no próximo tique'),
    )
    .finally(() => (worker = null));
}

/** Para os testes: espera a fila esvaziar. */
export async function suricataIdle(): Promise<void> {
  while (worker) await worker;
}

async function claim() {
  const next = await prisma.networkCapture.findFirst({
    where: { idsStatus: 'PENDING', idsNextAttemptAt: { lte: new Date() } },
    orderBy: { idsQueuedAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const taken = await prisma.networkCapture.updateMany({
    where: { id: next.id, idsStatus: 'PENDING' },
    data: { idsStatus: 'RUNNING', idsStartedAt: new Date(), idsAttempts: { increment: 1 } },
  });
  return taken.count ? prisma.networkCapture.findUnique({ where: { id: next.id } }) : null;
}

async function drain(): Promise<void> {
  for (;;) {
    const job = await claim();
    if (!job) return;
    try {
      await analyzeJob(job.id, job.storageKey, job.idsAttempts);
    } catch (err) {
      logger.error({ err }, '[suricata] falha na análise');
      await finish(job.id, { idsStatus: 'FAILED', idsError: 'falha interna na análise' });
    }
  }
}

function finish(id: string, data: Prisma.NetworkCaptureUpdateInput) {
  return prisma.networkCapture.update({
    where: { id },
    data: { idsFinishedAt: new Date(), ...data },
  });
}

async function analyzeJob(id: string, key: string | null, attempts: number): Promise<void> {
  if (!key) {
    await finish(id, { idsStatus: 'FAILED', idsError: 'o arquivo não está mais disponível' });
    return;
  }
  let data: Uint8Array;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    data = await obj.Body!.transformToByteArray();
  } catch {
    await finish(id, {
      idsStatus: 'FAILED',
      idsError: 'não foi possível ler o arquivo no armazenamento',
    });
    return;
  }
  if (data.length > env.SURICATA_MAX_MB * 1024 * 1024) {
    await finish(id, {
      idsStatus: 'FAILED',
      idsError: `arquivo acima de ${env.SURICATA_MAX_MB} MB`,
    });
    return;
  }

  let res: Response;
  try {
    res = await requestAnalysis(service(), data, {
      waitMs: suricataTiming.serviceWaitMs,
      retryEveryMs: suricataTiming.retryEveryMs,
    });
  } catch (err) {
    const why = requestFailure(service(), err);
    if (attempts < MAX_ATTEMPTS) {
      await prisma.networkCapture.update({
        where: { id },
        data: {
          idsStatus: 'PENDING',
          idsError: why,
          idsNextAttemptAt: new Date(Date.now() + suricataTiming.retryAfterMs * attempts),
        },
      });
    } else {
      await finish(id, { idsStatus: 'FAILED', idsError: why });
    }
    return;
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error.slice(0, 300)
        : `o serviço respondeu ${res.status}`;
    await finish(id, { idsStatus: 'FAILED', idsError: error });
    return;
  }
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) {
    await finish(id, {
      idsStatus: 'FAILED',
      idsError: 'resposta do serviço em formato inesperado',
    });
    return;
  }
  const r = parsed.data;
  if (!r.ok) {
    await finish(id, {
      idsStatus: 'FAILED',
      idsError: (r.error ?? 'a análise falhou').slice(0, 300),
      idsMs: r.ms ?? null,
    });
    return;
  }
  const result: SuricataResult = {
    alerts: r.alerts ?? [],
    dns: r.dns ?? [],
    http: r.http ?? [],
    tls: r.tls ?? [],
    alertsTotal: r.alertsTotal ?? 0,
    version: r.version ?? null,
    rules: r.rules ? { count: r.rules.count, updatedAt: r.rules.updatedAt } : null,
  };
  await finish(id, {
    idsStatus: 'DONE',
    idsResult: result as unknown as Prisma.InputJsonValue,
    idsError: null,
    idsMs: r.ms ?? null,
  });
  logger.info(
    `[suricata] captura ${id}: ${result.alertsTotal} alerta(s), ${result.dns.length} nome(s) em ${r.ms ?? '?'} ms`,
  );
}

/** Sobe a fila: o que estava em andamento volta para a fila (ou falha, se ja gastou as tentativas). */
export async function startSuricataQueue(log: typeof logger): Promise<void> {
  logger = log;
  await prisma.networkCapture.updateMany({
    where: { idsStatus: 'RUNNING', idsAttempts: { gte: MAX_ATTEMPTS } },
    data: {
      idsStatus: 'FAILED',
      idsError: 'interrompida (a API reiniciou)',
      idsFinishedAt: new Date(),
    },
  });
  await prisma.networkCapture.updateMany({
    where: { idsStatus: 'RUNNING' },
    data: { idsStatus: 'PENDING', idsNextAttemptAt: new Date() },
  });
  if (!timer) {
    timer = setInterval(wake, TICK_MS);
    timer.unref();
  }
  wake();
}

/** Para os testes: desliga o tique. */
export function stopSuricataQueue(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
