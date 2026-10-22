import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

import { SESSION_COOKIE } from './auth';

/** Tentativas permitidas por janela nas rotas sensiveis (login, troca de senha). */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

/** Chave por sessao (cookie) para os limites de escrita do proprio usuario. */
export function sessionKey(prefix: string) {
  return (req: FastifyRequest) =>
    `${prefix}:${(req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE] ?? req.ip}`;
}

/**
 * O plugin chama `onExceeded` a cada requisicao recusada; aqui so a primeira
 * de cada chave na janela passa adiante (ex.: um registro de bloqueio).
 */
function oncePerWindow(fn: (req: FastifyRequest) => void, windowMs: number) {
  const seen = new Map<string, number>();
  return (req: FastifyRequest, key: string) => {
    const now = Date.now();
    for (const [k, until] of seen) if (until <= now) seen.delete(k);
    if (seen.has(key)) return;
    seen.set(key, now + windowMs);
    fn(req);
  };
}

/**
 * Limite de tentativas por rota (`config` da rota). A chave vem da propria
 * requisicao (e-mail, sessao...) e nao do IP: atras do nginx/Cloudflare o
 * X-Forwarded-For pode ser forjado pelo cliente. Roda no preHandler para o
 * corpo ja estar disponivel.
 */
export function attemptLimit(
  key: (req: FastifyRequest) => string,
  {
    max = MAX_ATTEMPTS,
    windowMs = WINDOW_MS,
    onExceeded,
  }: { max?: number; windowMs?: number; onExceeded?: (req: FastifyRequest) => void } = {},
): {
  rateLimit: RateLimitOptions;
} {
  return {
    rateLimit: {
      max,
      timeWindow: windowMs,
      hook: 'preHandler',
      keyGenerator: key,
      ...(onExceeded ? { onExceeded: oncePerWindow(onExceeded, windowMs) } : {}),
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
