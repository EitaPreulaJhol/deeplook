import { DATA_EN } from './data-en';
import { createTranslator, type Lang } from './error-language';
import { MESSAGES_EN } from './messages-en';

/**
 * Os textos das analises no idioma de quem pede (plano pos-revisao, item 1.4, parte 2). Ficam
 * gravados em portugues; a API traduz na saida, com o dicionario de data-en.ts (e o de
 * messages-en.ts, porque o motivo de uma falha as vezes e uma mensagem de erro conhecida).
 * Sem `en`, tudo sai como foi gravado.
 */
const toEnglish = createTranslator([...DATA_EN, ...MESSAGES_EN]);

export function localizeText<T extends string | null | undefined>(text: T, lang: Lang): T {
  return (lang === 'en' && typeof text === 'string' ? toEnglish(text) : text) as T;
}

/**
 * Chaves cujo valor e texto para gente (alerta, motivo, rotulo), com a chave de cima em que valem
 * (null = em qualquer lugar). O contexto importa: `text` em `script.layers` e o conteudo
 * decodificado da amostra, e `name` em `imports` e o nome de uma funcao.
 */
const TEXT_KEYS = new Map<string, string | null>([
  ['text', 'alerts'],
  ['why', 'findings'],
  ['name', 'findings'],
  ['method', 'layers'],
  ['type', 'elf'],
  ['note', null],
  ['error', null],
  ['label', null],
  ['machine', null],
  ['subsystem', null],
  ['skipped', null],
]);
/** Listas de textos para gente. */
const LIST_KEYS = new Set(['alerts', 'suspicious', 'flags']);

function walk(value: unknown, key: string | null, parent: string | null): unknown {
  if (typeof value === 'string') {
    const where = key === null ? undefined : TEXT_KEYS.get(key);
    const human =
      (where !== undefined && (where === null || where === parent)) ||
      (key === null && parent !== null && LIST_KEYS.has(parent));
    return human ? toEnglish(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, null, key));
  if (value && typeof value === 'object') {
    // Um objeto dentro de uma lista (um achado em `findings`) responde pela chave da lista.
    const context = key ?? parent;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k, context)]),
    );
  }
  return value;
}

/**
 * A analise estatica (Entry.staticInfo) com os alertas, motivos e rotulos no idioma do pedido. So
 * as chaves de texto para gente passam pelo dicionario: listas de strings, imports e secoes nao.
 */
export function localizeStaticInfo<T>(info: T, lang: Lang): T {
  if (lang !== 'en' || !info || typeof info !== 'object') return info;
  return walk(info, null, null) as T;
}

/** Alertas no formato { level, text } (oletools, documento). */
export function localizeAlerts<T extends { text: string }>(
  alerts: T[] | null | undefined,
  lang: Lang,
): T[] | null | undefined {
  if (lang !== 'en' || !alerts) return alerts;
  return alerts.map((a) => ({ ...a, text: toEnglish(a.text) }));
}
