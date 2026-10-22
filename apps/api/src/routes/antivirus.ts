import type { FastifyInstance } from 'fastify';

import { isAnalyst, requireUser } from '../lib/auth';
import { clamavEnabled, scanEntry } from '../lib/clamav';
import { prisma } from '../lib/prisma';

/**
 * Antivirus da amostra (secao da ficha): ultima varredura do ClamAV e
 * "Escanear de novo" para analistas (le o arquivo do MinIO).
 */
export async function antivirusRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/antivirus', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, createdAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    const scan =
      entry.type === 'FILE'
        ? await prisma.antivirusScan.findUnique({
            where: { entryId: id },
            select: {
              status: true,
              signature: true,
              error: true,
              engine: true,
              dbVersion: true,
              dbDate: true,
              scannedAt: true,
            },
          })
        : null;
    // Varredura em andamento, ou arquivo recem-enviado cuja varredura ainda nao comecou.
    const enabled = clamavEnabled();
    const pending =
      enabled &&
      entry.type === 'FILE' &&
      (scan?.status === 'PENDING' || (!scan && Date.now() - entry.createdAt.getTime() < 60_000));
    return reply.send({ enabled, pending, scan });
  });

  app.post('/api/entries/:id/antivirus', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas escaneiam de novo.' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, storageKey: true, filePurgedAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    if (!clamavEnabled()) return reply.code(409).send({ error: 'O ClamAV não está configurado.' });
    if (entry.type !== 'FILE')
      return reply.code(400).send({ error: 'Só arquivos são escaneados.' });
    if (entry.filePurgedAt || !entry.storageKey) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    void scanEntry(id).catch((err) => req.log.error({ err }, '[clamav] falha'));
    return reply.code(202).send({ ok: true });
  });
}
