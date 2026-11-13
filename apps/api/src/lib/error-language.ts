import type { FastifyInstance, FastifyRequest } from 'fastify';

import { MESSAGES_EN } from './messages-en';

/**
 * Idioma das mensagens de erro (revisao de novembro, item 2.5). A interface em ingles manda
 * `Accept-Language: en`; scripts sem o cabecalho (ou com outro idioma) continuam recebendo o
 * portugues de sempre. So `error` e `details` das respostas de erro (4xx/5xx) sao traduzidos:
 * dados gravados (alertas da analise, detalhes de eventos) ficam como foram gravados.
 */
export type Lang = 'pt-BR' | 'en';

export function requestLang(req: Pick<FastifyRequest, 'headers'>): Lang {
  const header = req.headers['accept-language'];
  const first = (Array.isArray(header) ? header[0] : (header ?? '')).split(',')[0].trim();
  return /^en\b/i.test(first) ? 'en' : 'pt-BR';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EXACT = new Map<string, string>();
const PATTERNS: { re: RegExp; slots: number[]; en: string }[] = [];
for (const [pt, en] of MESSAGES_EN) {
  if (!/\{\d+\}/.test(pt)) {
    EXACT.set(pt, en);
    continue;
  }
  const slots: number[] = [];
  const source = pt
    .split(/(\{\d+\})/)
    .map((part) => {
      const slot = /^\{(\d+)\}$/.exec(part);
      if (!slot) return escape(part);
      slots.push(Number(slot[1]));
      return '([\\s\\S]*?)';
    })
    .join('');
  PATTERNS.push({ re: new RegExp(`^${source}$`), slots, en });
}

/** A mensagem em ingles, ou a original quando nao ha par. Os trechos variaveis que forem eles
 * mesmos mensagens conhecidas (o motivo de um erro dentro de outro) tambem sao traduzidos. */
export function translateMessage(text: string, depth = 0): string {
  const exact = EXACT.get(text);
  if (exact !== undefined) return exact;
  if (depth > 2) return text;
  for (const { re, slots, en } of PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const values = new Map<number, string>();
    slots.forEach((slot, i) => values.set(slot, translateMessage(match[i + 1] ?? '', depth + 1)));
    return en.replace(/\{(\d+)\}/g, (all, n: string) => values.get(Number(n)) ?? all);
  }
  return text;
}

type ErrorBody = { error?: unknown; details?: unknown };

/** Traduz `error` e `details` (campo -> lista de mensagens) de um corpo de erro. */
export function translateErrorBody<T extends ErrorBody>(body: T): T {
  const out: ErrorBody = { ...body };
  if (typeof out.error === 'string') out.error = translateMessage(out.error);
  if (out.details && typeof out.details === 'object' && !Array.isArray(out.details)) {
    out.details = Object.fromEntries(
      Object.entries(out.details as Record<string, unknown>).map(([field, list]) => [
        field,
        Array.isArray(list)
          ? list.map((m) => (typeof m === 'string' ? translateMessage(m) : m))
          : list,
      ]),
    );
  }
  return out as T;
}

/** Gancho que traduz as respostas de erro em JSON para quem pediu ingles. */
export function registerErrorLanguage(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'string') return payload;
    if (requestLang(req) !== 'en') return payload;
    if (!String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload;
    try {
      const body = JSON.parse(payload) as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return payload;
      return JSON.stringify(translateErrorBody(body as ErrorBody));
    } catch {
      return payload;
    }
  });
}
