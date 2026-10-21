import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

/** Tentativas permitidas por janela nas rotas sensiveis (login, troca de senha). */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Limite de tentativas por rota (`config` da rota). A chave vem da propria
 * requisicao (e-mail, sessao...) e nao do IP: atras do nginx/Cloudflare o
 * X-Forwarded-For pode ser forjado pelo cliente. Roda no preHandler para o
 * corpo ja estar disponivel.
 */
export function attemptLimit(key: (req: FastifyRequest) => string): {
  rateLimit: RateLimitOptions;
} {
  return {
    rateLimit: {
      max: MAX_ATTEMPTS,
      timeWindow: WINDOW_MS,
      hook: 'preHandler',
      keyGenerator: key,
      errorResponseBuilder: (_req, context) => {
        const minutes = Math.max(1, Math.ceil(context.ttl / 60000));
        return {
          statusCode: 429,
          error: `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes === 1 ? '' : 's'}.`,
        };
      },
    },
  };
}
