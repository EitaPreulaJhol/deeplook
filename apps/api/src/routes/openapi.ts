import type { FastifyInstance } from 'fastify';

import { requireUser } from '../lib/auth';
import { openApiDocument } from '../lib/openapi';

/** Especificacao OpenAPI das rotas com token (item 93): sessao ou token. */
export async function openApiRoutes(app: FastifyInstance) {
  app.get('/api/openapi.json', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return reply.send(openApiDocument());
  });
}
