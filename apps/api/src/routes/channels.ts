import type { FastifyInstance } from 'fastify';

import { isAnalyst, requireUser } from '../lib/auth';
import { channelsForViewer, channelsOf } from '../lib/exfil-store';

/**
 * Canais de exfiltracao da amostra (plans/analise-estatica-ampliada, item 3), juntando a analise
 * estatica e os servicos. Quem ve a amostra ve os canais; a credencial (token, senha, segredo do
 * webhook) so os analistas veem inteira.
 */
export async function channelRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/channels', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const channels = await channelsOf(id);
    if (!channels) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const analyst = isAnalyst(user);
    return reply.send({ channels: channelsForViewer(channels, analyst), masked: !analyst });
  });
}
