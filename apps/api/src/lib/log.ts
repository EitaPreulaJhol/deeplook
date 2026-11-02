import type { FastifyBaseLogger } from 'fastify';

/**
 * Logger dos trabalhos de fundo (item 1.3 do plano de melhorias).
 *
 * As rotas registram pelo Pino do Fastify (`req.log`), com o serializer que
 * tira a query string dos caminhos. Mas o que roda fora de uma requisicao —
 * reaper do sandbox, retencao, backup, bucket, varredura de dominios
 * parecidos — escrevia com `console.*`: texto solto, fora do JSON, que um
 * agregador de logs nao correlaciona com o resto.
 *
 * Estas funcoes escrevem no logger da API, registrado uma vez no boot. Fora
 * dela (o `npm run seed`, um script, um teste de integracao) nao ha logger, e
 * entao a mensagem cai no console, para nao se perder.
 *
 * A assinatura e a do Pino: `log.warn('texto')` ou `log.warn({ err }, 'texto')`.
 */

let current: FastifyBaseLogger | null = null;

/** Chamado no boot da API, assim que o Fastify existe. */
export function setLogger(logger: FastifyBaseLogger): void {
  current = logger;
}

/** Volta ao console (usado pelos testes, para nao vazar logger entre arquivos). */
export function resetLogger(): void {
  current = null;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, first: string | object, second?: string): void {
  if (current) {
    if (typeof first === 'string') current[level](first);
    else current[level](first, second ?? '');
    return;
  }
  // Sem logger: console, com o objeto depois do texto para ficar legivel.
  const text = typeof first === 'string' ? first : (second ?? '');
  const extra = typeof first === 'string' ? undefined : first;
  const write = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
  if (extra === undefined) write(text);
  else write(text, extra);
}

export const log = {
  info: (first: string | object, second?: string) => emit('info', first, second),
  warn: (first: string | object, second?: string) => emit('warn', first, second),
  error: (first: string | object, second?: string) => emit('error', first, second),
};

/** Motivo curto de um erro, para a mensagem de log. */
export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
