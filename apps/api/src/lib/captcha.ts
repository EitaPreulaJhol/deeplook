import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import svgCaptcha from 'svg-captcha';

import { env } from '../env';

/**
 * CAPTCHA de imagem gerado aqui, sem servico externo. O desafio e um token
 * assinado (HMAC com chave derivada do SESSION_SECRET) que carrega so o hash da
 * resposta e a validade: nada da resposta fica no cliente e nada no banco. O uso
 * unico vem de um registro em memoria dos tokens ja gastos (vale ate expirar).
 *
 * E uma barreira contra automacao simples, nao contra OCR/IA dedicados: por isso
 * so aparece depois de varias falhas, e o limite por e-mail + IP continua valendo.
 */

const TTL_MS = 2 * 60 * 1000;
/** Sem 0/O, 1/I/l: a pessoa nao deve errar por letra ambigua. */
const CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789';

const key = () => createHmac('sha256', env.SESSION_SECRET).update('deeplook:captcha:v1').digest();

const normalize = (answer: string) => answer.trim().toLowerCase();

const sign = (exp: number, nonce: string, answer: string) =>
  createHmac('sha256', key())
    .update(`${exp}.${nonce}.${normalize(answer)}`)
    .digest('base64url');

/** Tokens ja usados ate a validade (limite de memoria: o uso e raro e o TTL curto). */
const spent = new Map<string, number>();
const SPENT_MAX = 10_000;

function sweep(now: number) {
  for (const [nonce, until] of spent) if (until <= now) spent.delete(nonce);
}

export type Captcha = {
  /** Vai e volta do cliente junto com a resposta. */
  token: string;
  /** Imagem SVG (mostrar via <img>, nunca inline). */
  svg: string;
  /** Resposta: so o servidor (e os testes) conhecem. */
  text: string;
};

export function createCaptcha(now = Date.now()): Captcha {
  const { data, text } = svgCaptcha.create({
    size: 5,
    noise: 3,
    color: true,
    background: '#f3f4f6',
    width: 160,
    height: 56,
    fontSize: 48,
    charPreset: CHARSET,
  });
  const exp = now + TTL_MS;
  const nonce = randomBytes(12).toString('base64url');
  return { token: `${exp}.${nonce}.${sign(exp, nonce, text)}`, svg: data, text };
}

/** Confere a resposta e gasta o token (certo ou errado: nao se tenta de novo). */
export function checkCaptcha(token: unknown, answer: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string' || typeof answer !== 'string' || answer.length > 20) return false;
  const [expRaw, nonce, mac, extra] = token.split('.');
  const exp = Number(expRaw);
  if (extra !== undefined || !nonce || !mac || !Number.isFinite(exp) || exp < now) return false;
  if (exp > now + TTL_MS) return false;
  sweep(now);
  if (spent.has(nonce) || spent.size >= SPENT_MAX) return false;
  // Gasta antes de comparar: um token so permite um palpite.
  spent.set(nonce, exp);
  const expected = Buffer.from(sign(exp, nonce, answer));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
