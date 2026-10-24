import type { FastifyInstance } from 'fastify';

import { ATTACK } from '../lib/attack';
import { requireUser } from '../lib/auth';

/** Lista embutida do MITRE ATT&CK (campo do relatorio e filtro das listas). */
export async function attackRoutes(app: FastifyInstance) {
  app.get('/api/attack', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    // Muda so com uma nova versao da API: o navegador pode guardar por um dia.
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(ATTACK);
  });
}
