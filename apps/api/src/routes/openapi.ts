import type { FastifyInstance } from 'fastify';

import { requireUser } from '../lib/auth';
import { requestLang } from '../lib/error-language';
import { openApiDocument } from '../lib/openapi';
import { localizeOpenApi } from '../lib/openapi-en';

/** Especificacao OpenAPI das rotas com token (item 93): sessao ou token. */
export async function openApiRoutes(app: FastifyInstance) {
  app.get('/api/openapi.json', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    // No idioma de quem pede (plano pos-revisao, item 1.4).
    return reply.send(localizeOpenApi(openApiDocument(), requestLang(req)));
  });
}
