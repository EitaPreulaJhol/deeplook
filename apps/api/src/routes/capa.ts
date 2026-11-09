import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { capaEligible, capaEnabled, enqueueCapa } from '../lib/capa';
import { prisma } from '../lib/prisma';

const analysisSelect = {
  status: true,
  capa: true,
  floss: true,
  attack: true,
  iocCandidates: true,
  capaError: true,
  flossError: true,
  error: true,
  versions: true,
  ms: true,
  attempts: true,
  nextAttemptAt: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

/** Tipo real e tamanho da amostra: so executavel do Windows ou do Linux vai para o capa. */
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
      entry.type === 'FILE' && !entry.filePurgedAt && capaEligible(typeId, entry.fileSize ?? null),
    purged: Boolean(entry.filePurgedAt),
  };
}

/**
 * Analise de funcoes (item 7.2): o que cada funcao do executavel faz (capa) e as strings que so
 * aparecem na execucao (FLOSS). Roda sozinha depois do envio; analistas pedem de novo. Quem ve a
 * amostra ve a analise (o requireUser ja barra a amostra de outro dono).
 */
export async function capaRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/capa', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const state = await eligibility(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const analysis = await prisma.capaAnalysis.findUnique({
      where: { entryId: id },
      select: analysisSelect,
    });
    // Posicao na fila: quantas pedidas antes desta ainda esperam ou estao em andamento.
    const ahead =
      analysis?.status === 'PENDING'
        ? await prisma.capaAnalysis.count({
            where: {
              status: { in: ['PENDING', 'RUNNING'] },
              createdAt: { lt: analysis.createdAt },
            },
          })
        : null;
    return reply.send({
      enabled: capaEnabled(),
      eligible: state.eligible,
      maxMb: env.CAPA_MAX_MB,
      analysis: analysis ? { ...analysis, ahead } : null,
    });
  });

  app.post('/api/entries/:id/capa', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem a análise de funções.' });
    }
    if (!capaEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A análise de funções está desligada (CAPA_URL / CAPA_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const state = await eligibility(id);
    if (!state) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (!state.eligible) {
      return reply.code(400).send({
        error: state.purged
          ? 'O arquivo desta amostra foi expurgado pela política de retenção.'
          : `Só executáveis do Windows e do Linux de até ${env.CAPA_MAX_MB} MB.`,
      });
    }
    const current = await prisma.capaAnalysis.findUnique({
      where: { entryId: id },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A análise de funções já está na fila.' });
    }
    await enqueueCapa(id);
    return reply.code(202).send({ ok: true });
  });
}
