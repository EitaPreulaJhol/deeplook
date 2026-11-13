import type { FastifyInstance } from 'fastify';

import { isAnalyst, requireUser } from '../lib/auth';
import { requestLang } from '../lib/error-language';
import { RISK_MALICIOUS, RISK_SUSPICIOUS, riskOf } from '../lib/risk-score';

/**
 * Pontuacao de risco da amostra (item 7.5; revisao de novembro, 3.1): calculada na hora, com o
 * que as analises ja gravaram. So analistas: e uma sugestao de veredito para quem tria, e o
 * usuario comum ve o veredito de verdade, quando o analista o der.
 */
export async function riskRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/risk', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas veem a pontuação de risco.' });
    }
    const { id } = req.params as { id: string };
    const risk = await riskOf(id, requestLang(req));
    if (!risk) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    return reply.send({
      risk,
      thresholds: { malicious: RISK_MALICIOUS, suspicious: RISK_SUSPICIOUS },
    });
  });
}
