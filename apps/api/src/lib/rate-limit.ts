import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';

import { SESSION_COOKIE } from './auth';

/** Tentativas permitidas por janela nas rotas sensiveis (login, troca de senha). */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Falhas por chave numa janela: alem do limite por rota. Barra quem testa uma senha
 * em muitas contas (por IP) ou uma conta de muitos IPs (por e-mail).
 */
/** Chaves guardadas a partir das quais cada falha nova varre as vencidas. */
const SWEEP_ABOVE = 5_000;

export class FailureWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  exceeded(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  note(key: string, now = Date.now()): void {
    this.hits.set(key, [...this.recent(key, now), now]);
    // Uma chave so saia do mapa ao ser consultada de novo: e-mails aleatorios (cada um
    // tentado uma vez) ficavam para sempre. Acima do teto, varre as janelas vencidas.
    if (this.hits.size > SWEEP_ABOVE) this.sweep(now);
  }

  /** Remove as chaves sem falha dentro da janela. */
  sweep(now = Date.now()): void {
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }

  /** Chaves guardadas (para os testes). */
  get size(): number {
    return this.hits.size;
  }
}

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
