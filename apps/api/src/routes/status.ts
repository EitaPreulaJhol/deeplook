import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../lib/auth';
import { cachedSystemStatus } from '../lib/status';
import { sendValidationError } from '../lib/validation';

const Query = z.object({
  /** `1`: responde 503 quando a situacao geral e "error", para monitor que so olha o HTTP. */
  strict: z.enum(['0', '1']).default('0'),
});

/**
 * Status do sistema legivel por maquina (item 3.2): o mesmo objeto da tela Administracao >
 * Status, para um monitor externo (Uptime Kuma, Zabbix) ler sem raspar HTML.
 *
 * Aceita a sessao de um admin ou um token de API de escopo STATUS (so admin cria, e esse token
 * so alcanca esta rota: lib/api-tokens.ts). E diferente da readiness (`/api/health/ready`), que
 * e publica e so diz ok/nao: esta e autenticada e traz o detalhe (enderecos, versoes, latencias).
 */
export async function statusRoutes(app: FastifyInstance) {
  app.get('/api/status', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');

    const status = await cachedSystemStatus();
    // Detalhe de infraestrutura nao fica em cache de navegador ou de proxy.
    reply.header('Cache-Control', 'no-store');
    if (parsed.data.strict === '1' && status.overall === 'error') reply.code(503);
    return reply.send(status);
  });
}
