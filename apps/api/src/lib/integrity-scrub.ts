import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import { type IntegrityOutcome, type IntegrityTarget, judge, recordIntegrity } from './integrity';
import { log } from './log';
import { prisma } from './prisma';
import { isMissingObject, s3 } from './s3';

/**
 * Scrub de integridade (item 4.2): em segundo plano, le as amostras guardadas e confere o
 * SHA-256 com o da ficha. Pega corrupcao de armazenamento sem esperar alguem baixar o
 * arquivo. Comeca pelas nunca conferidas e segue pelas conferidas ha mais tempo, ate gastar
 * o orcamento da rodada (INTEGRITY_SCRUB_MAX_MB), entao o custo e previsivel; um arquivo
 * maior que o orcamento ainda e conferido, sozinho, na sua vez.
 */

export interface ScrubResult {
  /** Arquivos lidos por inteiro e julgados. */
  checked: number;
  ok: number;
  /** Conteudo diferente do gravado na ficha. */
  mismatch: number;
  /** Objeto que nao existe mais no armazenamento. */
  missing: number;
  /** Falha de leitura (rede, MinIO fora): nada e marcado, fica para a proxima rodada. */
  errors: number;
  bytes: number;
}

const FIRST_RUN_DELAY_MS = 5 * 60_000;
/** Candidatas por rodada: com o orcamento comum, bem mais do que cabe ler. */
const BATCH = 500;
/** MinIO fora: desiste da rodada em vez de tentar as 500, uma a uma. */
const MAX_CONSECUTIVE_ERRORS = 3;

let running = false;

type Candidate = IntegrityTarget & { bucket: string | null; storageKey: string };

async function readAndJudge(entry: Candidate): Promise<IntegrityOutcome> {
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
    );
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of obj.Body as Readable) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
    }
    return judge(entry, { sha256: hash.digest('hex'), bytes });
  } catch (err) {
    if (isMissingObject(err)) return { state: 'missing' };
    throw err;
  }
}

/** Uma rodada. `maxBytes` so existe para o teste usar um orcamento pequeno. */
export async function scrubIntegrity(
  maxBytes = env.INTEGRITY_SCRUB_MAX_MB * 1024 * 1024,
): Promise<ScrubResult> {
  const result: ScrubResult = { checked: 0, ok: 0, mismatch: 0, missing: 0, errors: 0, bytes: 0 };
  if (running) return result;
  running = true;
  try {
    const rows = await prisma.entry.findMany({
      where: {
        type: 'FILE',
        storageKey: { not: null },
        sha256: { not: null },
        filePurgedAt: null,
      },
      orderBy: [{ integrityCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: BATCH,
      select: {
        id: true,
        title: true,
        ownerId: true,
        bucket: true,
        storageKey: true,
        sha256: true,
        fileSize: true,
      },
    });

    let consecutiveErrors = 0;
    for (const row of rows) {
      const size = row.fileSize ?? 0;
      // O orcamento barra a proxima, nunca a primeira: um arquivo grande nao fica sem vez.
      if (result.bytes > 0 && result.bytes + size > maxBytes) break;
      const entry: Candidate = {
        id: row.id,
        title: row.title,
        ownerId: row.ownerId,
        bucket: row.bucket,
        storageKey: row.storageKey as string,
        sha256: row.sha256 as string,
        fileSize: row.fileSize,
      };
      let outcome: IntegrityOutcome;
      try {
        outcome = await readAndJudge(entry);
      } catch (err) {
        result.errors += 1;
        log.warn(
          { err, entryId: entry.id },
          '[integridade] falha ao ler o arquivo; fica para depois',
        );
        if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log.warn('[integridade] armazenamento sem responder: encerro a rodada');
          break;
        }
        continue;
      }
      consecutiveErrors = 0;
      await recordIntegrity(entry, outcome, { via: 'scrub' });
      result.checked += 1;
      result.bytes += size;
      if (outcome.state === 'ok') result.ok += 1;
      else if (outcome.state === 'mismatch') result.mismatch += 1;
      else result.missing += 1;
    }
    return result;
  } finally {
    running = false;
  }
}

/** Liga o job (INTEGRITY_SCRUB_INTERVAL_MINUTES = 0 desliga). */
export function startIntegrityScrub(): void {
  const minutes = env.INTEGRITY_SCRUB_INTERVAL_MINUTES;
  if (!minutes) return;
  const run = () =>
    scrubIntegrity()
      .then((r) => {
        if (r.checked || r.errors) {
          log.info(
            r,
            `[integridade] rodada: ${r.checked} conferido(s), ${r.mismatch} divergente(s), ` +
              `${r.missing} ausente(s), ${r.errors} falha(s) de leitura`,
          );
        }
      })
      .catch((err: unknown) => log.error({ err }, '[integridade] falha na rodada'));
  // Espera o boot assentar (migracao, seed, bucket) antes da primeira leitura.
  setTimeout(() => void run(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void run(), minutes * 60_000).unref();
}
