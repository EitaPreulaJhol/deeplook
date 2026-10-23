import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';
import { sendValidationError } from '../lib/validation';

/** Visualizador hexadecimal (item 57): ate 64 KB do comeco do arquivo, em blocos. */
export const HEX_MAX_BYTES = 64 * 1024;
const HEX_BLOCK = 4 * 1024;

const HexQuery = z.object({
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(HEX_MAX_BYTES - 1)
    .default(0),
  length: z.coerce.number().int().min(1).max(HEX_BLOCK).default(HEX_BLOCK),
});

/**
 * Bytes do arquivo para o visualizador hexadecimal da aba Analise (so
 * analistas). Le do MinIO so a faixa pedida (Range): nada e baixado inteiro
 * nem executado.
 */
export async function hexRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/hex', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas veem o conteúdo do arquivo.' });
    }
    const parsed = HexQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parametros invalidos.');
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, storageKey: true, bucket: true, fileSize: true, filePurgedAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    if (entry.type !== 'FILE') return reply.code(400).send({ error: 'Links não têm conteúdo.' });
    if (entry.filePurgedAt || !entry.storageKey) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    const size = entry.fileSize ?? 0;
    const { offset } = parsed.data;
    const limit = Math.min(size, HEX_MAX_BYTES);
    if (offset >= limit) {
      return reply.send({ offset, size, limit, data: '' });
    }
    const end = Math.min(offset + parsed.data.length, limit) - 1;
    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: entry.bucket || env.S3_BUCKET,
          Key: entry.storageKey,
          Range: `bytes=${offset}-${end}`,
        }),
      );
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      return reply.send({ offset, size, limit, data: bytes.toString('base64') });
    } catch (err) {
      req.log.error({ err }, 'Falha ao ler a amostra no MinIO');
      return reply.code(502).send({ error: 'Nao foi possivel ler o arquivo no armazenamento.' });
    }
  });
}
