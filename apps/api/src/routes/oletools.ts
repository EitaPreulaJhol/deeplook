import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { enqueueOletools, oletoolsEligible, oletoolsEnabled } from '../lib/oletools';
import { prisma } from '../lib/prisma';

const analysisSelect = {
  status: true,
  result: true,
  alerts: true,
  error: true,
  version: true,
  ms: true,
  attempts: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

/** Tipo real e tamanho da amostra: so documento OLE, OOXML ou RTF vai para o oletools. */
async function eligibility(id: string) {
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: { type: true, fileSize: true, filePurgedAt: true, staticInfo: true },
  });
  if (!entry) return null;
  const typeId = (entry.staticInfo as { detectedType?: { id?: string } | null } | null)
    ?.detectedType?.id;
  return {
    eligible:
      entry.type === 'FILE' &&
      !entry.filePurgedAt &&
      oletoolsEligible(typeId, entry.fileSize ?? null),
    purged: Boolean(entry.filePurgedAt),
  };
}

/**
 * Office e PDF mais fundo (item 7.14; revisao de novembro, 3.2): o resultado do oletools. Roda
 * sozinho depois do envio de um documento; analistas pedem de novo. Quem ve a amostra ve a
 * analise (o requireUser ja barra a amostra de outro dono).
 */
export async function oletoolsRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/office', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const state = await eligibility(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const analysis = await prisma.officeAnalysis.findUnique({
      where: { entryId: id },
      select: analysisSelect,
    });
    return reply.send({
      enabled: oletoolsEnabled(),
      eligible: state.eligible,
      maxMb: env.OLETOOLS_MAX_MB,
      analysis,
    });
  });

  app.post('/api/entries/:id/office', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem a análise do documento.' });
    }
    if (!oletoolsEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A análise de documentos está desligada (OLETOOLS_URL / OLETOOLS_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const state = await eligibility(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (!state.eligible) {
      return reply.code(400).send({
        error: state.purged
          ? 'O arquivo desta amostra foi expurgado pela política de retenção.'
          : `Só documentos do Office (antigos ou novos) e RTF de até ${env.OLETOOLS_MAX_MB} MB.`,
      });
    }
    const current = await prisma.officeAnalysis.findUnique({
      where: { entryId: id },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A análise do documento já está na fila.' });
    }
    await enqueueOletools(id);
    return reply.code(202).send({ ok: true });
  });
}
