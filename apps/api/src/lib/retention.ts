import { DeleteObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import { recordEvent } from './events';
import { deleteGhidraProject } from './ghidra';
import { log, reason } from './log';
import { prisma } from './prisma';
import { s3 } from './s3';
import { ACTIVE_STATUSES } from './sandbox';

/** Arquivos expurgados por rodada (a proxima rodada continua de onde parou). */
const BATCH = 100;
const HOUR_MS = 60 * 60 * 1000;

/** Apaga o arquivo da amostra no MinIO (idempotente: objeto ausente nao e erro). */
export async function deleteStoredFile(entry: {
  storageKey: string | null;
  bucket: string | null;
}) {
  if (!entry.storageKey) return;
  await s3.send(
    new DeleteObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
  );
}

/**
 * Retencao (RETENTION_DAYS): apaga o ARQUIVO das amostras concluidas ha mais de
 * N dias. Ficha, relatorios, IOCs e hash ficam. Nunca mexe em amostra com
 * sandbox ativo nem na lixeira (o filtro da lixeira ja as tira da consulta).
 * Apaga o objeto antes de marcar a ficha: se o banco falhar no meio, a proxima
 * rodada tenta de novo e termina.
 */
export async function purgeExpiredFiles(now = new Date()): Promise<number> {
  const days = env.RETENTION_DAYS;
  if (!days) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * HOUR_MS);
  const due = await prisma.entry.findMany({
    where: {
      type: 'FILE',
      storageKey: { not: null },
      status: 'COMPLETED',
      statusChangedAt: { lt: cutoff },
      sandboxSessions: { none: { status: { in: ACTIVE_STATUSES } } },
    },
    select: { id: true, storageKey: true, bucket: true },
    orderBy: { statusChangedAt: 'asc' },
    take: BATCH,
  });

  let purged = 0;
  for (const entry of due) {
    try {
      await deleteStoredFile(entry);
      // O projeto do Ghidra (item 7.3) tem os bytes da amostra: sai junto.
      await deleteGhidraProject(entry.id);
    } catch (err) {
      log.warn(`[retencao] falha ao apagar ${entry.storageKey}: ${reason(err)}`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.entry.updateMany({
        where: { id: entry.id, storageKey: entry.storageKey },
        data: { storageKey: null, filePurgedAt: now },
      });
      if (count) {
        await recordEvent(tx, {
          entryId: entry.id,
          actorId: null,
          type: 'FILE_PURGED',
          detail: `retenção de ${days} dias após a conclusão`,
        });
      }
    });
    purged += 1;
  }
  return purged;
}

/** Liga a retencao: uma rodada ao subir e depois a cada hora. */
export function startRetention(log: {
  info: (msg: string) => void;
  error: (obj: object, msg: string) => void;
}) {
  if (!env.RETENTION_DAYS) return;
  const run = () =>
    purgeExpiredFiles()
      .then((n) => {
        if (n) log.info(`[retencao] ${n} arquivo(s) expurgado(s).`);
      })
      .catch((err: unknown) => log.error({ err }, '[retencao] falha na rodada'));
  void run();
  setInterval(() => void run(), HOUR_MS).unref();
}
