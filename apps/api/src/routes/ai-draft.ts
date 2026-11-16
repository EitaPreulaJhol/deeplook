import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import {
  aiDraftDestination,
  aiDraftEnabled,
  aiDraftModel,
  aiDraftProvider,
  DraftError,
  draftReport,
} from '../lib/ai-draft';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';

/**
 * Rascunho do relatorio por IA (plans/novas-analises, item 7): so analistas, com limite diario por
 * pessoa e cada pedido na auditoria (o modelo e para onde os dados foram). O rascunho volta para a
 * tela; quem salva e o analista.
 */
export async function aiDraftRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const enabled = aiDraftEnabled() && isAnalyst(user);
    return reply.send({
      enabled,
      provider: enabled ? aiDraftProvider() : null,
      model: enabled ? aiDraftModel() : null,
      destination: enabled ? aiDraftDestination() : null,
      dailyLimit: env.LLM_DAILY_LIMIT,
    });
  });

  app.post('/api/entries/:id/reports/ai-draft', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem o rascunho por IA.' });
    }
    if (!aiDraftEnabled()) {
      return reply.code(503).send({ error: 'O rascunho por IA está desligado (LLM_PROVIDER).' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { title: true, ownerId: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const used = await prisma.auditEvent.count({
      where: {
        action: 'REPORT_AI_DRAFT',
        actorId: user.id,
        createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) },
      },
    });
    if (used >= env.LLM_DAILY_LIMIT) {
      return reply
        .code(429)
        .send({ error: `Limite de ${env.LLM_DAILY_LIMIT} rascunhos por IA em 24 h atingido.` });
    }
    // Conta antes de chamar: um pedido que falha tambem gastou o provedor.
    await audit(prisma, req, {
      action: 'REPORT_AI_DRAFT',
      actorId: user.id,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: `${aiDraftProvider()} · ${aiDraftModel()} · ${aiDraftDestination() ?? '?'}`,
    });
    const lang = requestLang(req);
    try {
      const result = await draftReport(id, lang === 'en' ? 'en' : 'pt-BR');
      if (!result) return reply.code(404).send({ error: 'Amostra não encontrada.' });
      return reply.send({ ...result, model: aiDraftModel(), provider: aiDraftProvider() });
    } catch (err) {
      if (err instanceof DraftError) {
        return reply.code(502).send({
          error: localizeText(`Não foi possível gerar o rascunho: ${err.message}`, lang),
        });
      }
      throw err;
    }
  });
}
