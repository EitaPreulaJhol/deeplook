import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { PE_REVISION, relationHashes } from './pe-analysis';
import { replacePivots, staticPivots } from './pivots';
import { prisma } from './prisma';
import { s3 } from './s3';
import { analyzeInThread } from './static-analysis-thread';

const PAGE = 20;

/**
 * Executaveis do Windows analisados numa versao anterior da analise de PE (item 7.1: imphash, Rich
 * header, recursos e assinatura; plans/analise-estatica-ampliada: debug, pivos...): refaz a analise
 * estatica em segundo plano, um arquivo por vez e na thread de analise, para a ficha ganhar o que
 * falta e a aba Relacionadas poder liga-los. A marca de "ja feito" e `pe.rev` (PE_REVISION);
 * arquivo expurgado ou ilegivel ganha so essa marca, para nao repetir.
 */
export async function backfillPeAnalysis(log: {
  info: (msg: string) => void;
  error: (obj: object, msg: string) => void;
}): Promise<number> {
  let done = 0;
  try {
    for (;;) {
      const page = await prisma.$queryRaw<
        {
          id: string;
          storageKey: string | null;
          bucket: string | null;
          originalFilename: string | null;
          filePurgedAt: Date | null;
        }[]
      >`
        SELECT "id", "storageKey", "bucket", "originalFilename", "filePurgedAt"
        FROM "Entry"
        WHERE "type" = 'FILE'
          AND jsonb_typeof("staticInfo"->'pe') = 'object'
          AND COALESCE(("staticInfo"->'pe'->>'rev')::int, 0) < ${PE_REVISION}
        ORDER BY "createdAt" DESC
        LIMIT ${PAGE}`;
      if (!page.length) break;
      for (const entry of page) {
        let analyzed = false;
        if (entry.storageKey && !entry.filePurgedAt) {
          try {
            const obj = await s3.send(
              new GetObjectCommand({
                Bucket: entry.bucket || env.S3_BUCKET,
                Key: entry.storageKey,
              }),
            );
            const buffer = Buffer.from(await obj.Body!.transformToByteArray());
            const staticInfo = await analyzeInThread(buffer, entry.originalFilename);
            // A nova analise pode ter falhado em ler o PE: a marca vai assim mesmo.
            const pe = staticInfo.pe
              ? { ...staticInfo.pe, imphash: staticInfo.pe.imphash ?? null }
              : null;
            const fresh = { ...staticInfo, pe };
            await prisma.entry.update({
              where: { id: entry.id },
              data: {
                staticInfo: fresh as unknown as Prisma.InputJsonValue,
                ...relationHashes(pe),
              },
            });
            await replacePivots(prisma, entry.id, 'static', staticPivots(fresh));
            analyzed = Boolean(pe);
          } catch {
            analyzed = false;
          }
        }
        if (!analyzed) {
          await prisma.$executeRaw`
            UPDATE "Entry"
            SET "staticInfo" = jsonb_set(
              jsonb_set("staticInfo", '{pe,imphash}', COALESCE("staticInfo"->'pe'->'imphash', 'null'::jsonb)),
              '{pe,rev}', to_jsonb(${PE_REVISION}::int))
            WHERE "id" = ${entry.id} AND jsonb_typeof("staticInfo"->'pe') = 'object'`;
        }
        done += 1;
        // Deixa a API respirar entre um arquivo e outro.
        await new Promise((r) => setImmediate(r));
      }
    }
    if (done) log.info(`[pe] ${done} executável(is) antigo(s) reanalisado(s).`);
  } catch (err) {
    log.error({ err }, '[pe] falha ao reanalisar os executáveis antigos');
  }
  return done;
}
