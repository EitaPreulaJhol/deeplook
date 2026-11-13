import { PutObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { recordEvent } from './events';
import { phashIsFlat, validPhash } from './phash';
import { prisma } from './prisma';
import { enqueueQr, qrEnabled } from './qr';
import { s3 } from './s3';

/** Tempo maximo de uma captura (o servico tem 20 s de navegacao + print). */
const CAPTURE_TIMEOUT_MS = 90_000;
/**
 * Espera pelo servico (item 6.17): cada captura roda num container novo, e entre uma e outra
 * o `capture` responde 503 ou nem aceita conexao enquanto o Docker o sobe de novo (cerca de
 * 10 s depois da subida anterior). Pedidos ao mesmo tempo esperam a vez aqui.
 */
const SERVICE_WAIT_MS = 120_000;
const RETRY_EVERY_MS = 1000;

/** Nao houve conexao: o pedido nem chegou ao servico (container subindo). Repetir e seguro. */
const NOT_CONNECTED = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];
/**
 * A conexao caiu depois de aberta. Pode ser o container antigo saindo (repetir resolve) ou a
 * propria captura derrubando o navegador, por exemplo uma pagina que estoura a memoria e leva o
 * container junto. Repetir sem limite revisitaria a mesma pagina maliciosa a cada reinicio (e
 * cada container que vive menos de 10 s aumenta o atraso do Docker para as capturas seguintes):
 * so uma nova tentativa.
 */
const DROPPED = ['ECONNRESET', 'UND_ERR_SOCKET'];
const MAX_DROPPED_RETRIES = 1;

/** Erro de conexao (e de que tipo), e nao uma captura que estourou o tempo. */
function connectionError(err: unknown): 'not-connected' | 'dropped' | null {
  if (!(err instanceof Error) || err.name === 'TimeoutError' || err.name === 'AbortError') {
    return null;
  }
  const code = (err.cause as { code?: string } | undefined)?.code ?? '';
  if (NOT_CONNECTED.includes(code)) return 'not-connected';
  if (DROPPED.includes(code)) return 'dropped';
  return null;
}

/**
 * Pede a captura, esperando a vez enquanto o servico troca de container. Devolve a resposta
 * (que pode ser de erro) ou lanca se o servico nao atendeu dentro da espera.
 */
export async function requestCapture(
  url: string,
  { waitMs = SERVICE_WAIT_MS, retryEveryMs = RETRY_EVERY_MS } = {},
): Promise<Response> {
  const deadline = Date.now() + waitMs;
  let dropped = 0;
  for (;;) {
    try {
      const res = await fetch(`${env.CAPTURE_URL.replace(/\/$/, '')}/capture`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.CAPTURE_TOKEN}`,
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      });
      if (res.status !== 503 || Date.now() >= deadline) return res;
      await res.body?.cancel();
    } catch (err) {
      const kind = connectionError(err);
      if (!kind || Date.now() >= deadline) throw err;
      if (kind === 'dropped' && ++dropped > MAX_DROPPED_RETRIES) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, retryEveryMs));
  }
}

/** Captura de pagina ligada (servico do navegador isolado configurado). */
export function captureEnabled(): boolean {
  return Boolean(env.CAPTURE_URL && env.CAPTURE_TOKEN);
}

interface ServiceResult {
  ok: boolean;
  error?: string;
  finalUrl?: string;
  title?: string;
  status?: number | null;
  redirects?: { url: string; status: number | null }[];
  certificate?: Record<string, string | null> | null;
  html?: string;
  htmlTruncated?: boolean;
  screenshot?: string;
  /** Hash perceptual do topo do print (apps/capture); ausente nas versoes antigas do servico. */
  screenshotHash?: string | null;
  blocked?: { host: string; reason: string }[];
}

/**
 * Captura da pagina de um link (item 80): pede ao navegador isolado (servico
 * `capture`), guarda print e HTML no MinIO e o resto na ficha da captura. O
 * HTML so e baixado como texto, nunca aberto. Falha vira FAILED com o motivo.
 */
export async function runCapture(
  captureId: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<void> {
  const capture = await prisma.pageCapture.findUnique({ where: { id: captureId } });
  if (!capture) return;
  const fail = (error: string, blocked?: ServiceResult['blocked']) =>
    prisma.pageCapture.update({
      where: { id: captureId },
      data: {
        status: 'FAILED',
        error: error.slice(0, 300),
        blocked: (blocked ?? []) as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });

  let result: ServiceResult;
  try {
    const res = await requestCapture(capture.url);
    if (!res.ok && res.status !== 200) {
      await fail(`serviço de captura respondeu ${res.status}`);
      return;
    }
    result = (await res.json()) as ServiceResult;
  } catch (err) {
    log.error({ err }, '[captura] serviço indisponível');
    await fail('serviço de captura indisponível');
    return;
  }
  if (!result.ok) {
    await fail(result.error ?? 'falha na captura', result.blocked);
    return;
  }

  try {
    const base = `captures/${capture.entryId}/${capture.id}`;
    const screenshot = Buffer.from(result.screenshot ?? '', 'base64');
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: `${base}.png`,
        Body: screenshot,
        ContentType: 'image/png',
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: `${base}.html.txt`,
        Body: Buffer.from(result.html ?? '', 'utf8'),
        ContentType: 'text/plain; charset=utf-8',
      }),
    );
    const redirects = result.redirects ?? [];
    const hash = validPhash(result.screenshotHash);
    await prisma.$transaction(async (tx) => {
      await tx.pageCapture.update({
        where: { id: captureId },
        data: {
          status: 'DONE',
          finalUrl: result.finalUrl?.slice(0, 2000) ?? null,
          title: result.title?.slice(0, 300) || null,
          httpStatus: result.status ?? null,
          redirects: redirects as unknown as Prisma.InputJsonValue,
          certificate: (result.certificate ?? undefined) as Prisma.InputJsonValue | undefined,
          blocked: (result.blocked ?? []) as unknown as Prisma.InputJsonValue,
          screenshotKey: `${base}.png`,
          // Pagina sem estrutura (em branco) fica sem hash: ligaria todas as vazias entre si.
          screenshotHash: hash && !phashIsFlat(hash) ? hash : null,
          htmlKey: `${base}.html.txt`,
          htmlTruncated: Boolean(result.htmlTruncated),
          finishedAt: new Date(),
        },
      });
      await recordEvent(tx, {
        entryId: capture.entryId,
        actorId: capture.requestedById,
        type: 'PAGE_CAPTURED',
        toValue: result.status ? String(result.status) : null,
        detail: `${Math.max(0, redirects.length - 1)} redirecionamento(s)`,
      });
    });
  } catch (err) {
    log.error({ err }, '[captura] falha ao guardar');
    await fail('falha ao guardar a captura');
    return;
  }
  // QR code no print da pagina (plano pos-revisao, item 2.2): cada captura nova e lida de novo.
  if (qrEnabled()) {
    await enqueueQr(capture.entryId).catch((err: unknown) =>
      log.error({ err }, '[qr] falha ao enfileirar o print'),
    );
  }
}

/** Capturas em andamento quando a API reiniciou: marcadas como falha. */
export async function failInterruptedCaptures(): Promise<number> {
  const { count } = await prisma.pageCapture.updateMany({
    where: { status: 'PENDING' },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  return count;
}
