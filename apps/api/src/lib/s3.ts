import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../env';
import { log } from './log';

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
});

/**
 * Garante que o bucket existe. O MinIO pode demorar a subir,
 * por isso tentamos varias vezes com um pequeno delay.
 */
/** Objeto que nao esta no bucket (ex.: backup restaurado sem as amostras, item 106). */
export function isMissingObject(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

export const MISSING_OBJECT_MESSAGE = 'O arquivo desta amostra não está no armazenamento.';

export async function ensureBucket(retries = 30, delayMs = 2000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));

      log.info(`[s3] Bucket "${env.S3_BUCKET}" pronto.`);
      return;
    } catch (err: any) {
      const name = err?.name || err?.Code;
      const status = err?.$metadata?.httpStatusCode;

      if (name === 'NotFound' || status === 404) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));

          log.info(`[s3] Bucket "${env.S3_BUCKET}" criado.`);
          return;
        } catch (createErr: any) {
          if (
            createErr?.name === 'BucketAlreadyOwnedByYou' ||
            createErr?.name === 'BucketAlreadyExists'
          ) {
            return;
          }

          log.warn(`[s3] Falha ao criar bucket (tentativa ${i + 1}): ${createErr?.message}`);
        }
      } else {
        log.warn(`[s3] MinIO indisponivel (tentativa ${i + 1}): ${err?.message}`);
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[s3] Nao foi possivel garantir o bucket apos varias tentativas.');
}
