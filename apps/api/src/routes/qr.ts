import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import { enqueueQr, qrEligibleFile, qrEnabled } from '../lib/qr';

/** Imagem ou PDF que o leitor abre, ou amostra de link (o print da captura). */
async function applicability(id: string) {
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: { type: true, fileSize: true, filePurgedAt: true, staticInfo: true },
  });
  if (!entry) return null;
  if (entry.type === 'URL') {
    const captured = await prisma.pageCapture.count({
      where: { entryId: id, status: 'DONE', screenshotKey: { not: null } },
    });
    return { applicable: true, ready: captured > 0, purged: false };
  }
  const typeId = (entry.staticInfo as { detectedType?: { id?: string } | null } | null)
    ?.detectedType?.id;
  const applicable = qrEligibleFile(typeId, entry.fileSize ?? null);
  return {
    applicable,
    ready: applicable && !entry.filePurgedAt,
    purged: Boolean(entry.filePurgedAt),
  };
}

/**
 * QR code em imagens, PDFs e no print da pagina (plano pos-revisao, item 2.2). Roda sozinho depois
 * do envio de uma imagem ou PDF e depois de cada captura de link; analistas pedem de novo. Quem ve a
 * amostra ve os codigos (o requireUser ja barra a amostra de outro dono).
 */
export async function qrRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/qr', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const state = await applicability(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const scan = await prisma.qrScan.findUnique({
      where: { entryId: id },
      select: {
        status: true,
        codes: true,
        pages: true,
        error: true,
        ms: true,
        createdAt: true,
        finishedAt: true,
      },
    });
    return reply.send({
      enabled: qrEnabled(),
      applicable: state.applicable,
      ready: state.ready,
      // Motivo da falha no idioma de quem pede (plano pos-revisao, item 1.4).
      scan: scan && { ...scan, error: localizeText(scan.error, requestLang(req)) },
    });
  });

  app.post('/api/entries/:id/qr', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem a leitura de QR code.' });
    }
    if (!qrEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A leitura de QR code está desligada (OLETOOLS_URL / OLETOOLS_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const state = await applicability(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (!state.ready) {
      return reply.code(400).send({
        error: state.purged
          ? 'O arquivo desta amostra foi expurgado pela política de retenção.'
          : state.applicable
            ? 'A página ainda não foi capturada.'
            : `Só imagens (PNG, JPEG, GIF), PDFs de até ${env.OLETOOLS_MAX_MB} MB e links capturados.`,
      });
    }
    const current = await prisma.qrScan.findUnique({
      where: { entryId: id },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A leitura de QR code já está na fila.' });
    }
    await enqueueQr(id);
    return reply.code(202).send({ ok: true });
  });
}
