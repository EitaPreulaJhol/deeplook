import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import { prisma } from './prisma';
import { s3 } from './s3';
import { tlsh, TLSH_MAX_BYTES } from './tlsh';

const PAGE = 50;

/**
 * TLSH das amostras enviadas antes do item 71: calculado em segundo plano,
 * um arquivo por vez, depois de a API comecar a responder. Arquivo grande,
 * expurgado ou ilegivel fica com '' (nao calculavel) para nao repetir.
 */
export async function backfillTlsh(log: {
  info: (msg: string) => void;
  error: (obj: object, msg: string) => void;
}): Promise<void> {
  let done = 0;
  try {
    for (;;) {
      const page = await prisma.entry.findMany({
        where: { type: 'FILE', tlsh: null },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        select: { id: true, storageKey: true, bucket: true, fileSize: true, filePurgedAt: true },
      });
      if (!page.length) break;
      for (const entry of page) {
        let value = '';
        if (entry.storageKey && !entry.filePurgedAt && (entry.fileSize ?? 0) <= TLSH_MAX_BYTES) {
          try {
            const obj = await s3.send(
              new GetObjectCommand({
                Bucket: entry.bucket || env.S3_BUCKET,
                Key: entry.storageKey,
              }),
            );
            value = tlsh(await obj.Body!.transformToByteArray()) ?? '';
          } catch {
            value = '';
          }
        }
        await prisma.entry.update({ where: { id: entry.id }, data: { tlsh: value } });
        done += 1;
        // Deixa a API respirar entre um arquivo e outro.
        await new Promise((r) => setImmediate(r));
      }
    }
    if (done) log.info(`[tlsh] ${done} amostra(s) antiga(s) com hash parecido calculado.`);
  } catch (err) {
    log.error({ err }, '[tlsh] falha ao calcular os hashes antigos');
  }
}
