import type { EntryEventType, NotificationType } from '../generated/prisma/client';
import { DATA_EN } from './data-en';
import { createTranslator, type Lang } from './error-language';
import { HISTORY_EN } from './history-en';
import { MESSAGES_EN } from './messages-en';

/**
 * Historico da amostra, notificacoes e auditoria no idioma de quem pede (plano pos-revisao, item
 * 1.4, parte 3). O detalhe fica gravado em portugues; a API traduz na saida. So o que e texto do
 * sistema passa pelo dicionario: comentario, resolucao e o que as pessoas escreveram saem como
 * foram gravados.
 */
const whole = createTranslator([...HISTORY_EN, ...DATA_EN, ...MESSAGES_EN]);

/** A frase inteira; sem par, trecho a trecho quando ela foi montada com " · ". */
export function translateDetail(text: string): string {
  const full = whole(text);
  if (full !== text || !text.includes(' · ')) return full;
  return text
    .split(' · ')
    .map((part) => whole(part))
    .join(' · ');
}

const localize = <T extends string | null>(text: T, lang: Lang): T =>
  (lang === 'en' && text !== null ? translateDetail(text) : text) as T;

/** Eventos da amostra cujo `detail` e texto de alguem (comentario, revisao, resolucao, codigo). */
const PEOPLE_EVENTS = new Set<EntryEventType>([
  'COMMENT',
  'REPORT_SUBMITTED',
  'REPORT_APPROVED',
  'REPORT_RETURNED',
  'RESOLUTION_SET',
  'CASE_ADDED',
  'CASE_REMOVED',
  'MARKED_DUPLICATE',
  'UNMARKED_DUPLICATE',
]);

export function localizeEntryEvents<T extends { type: EntryEventType; detail: string | null }>(
  events: T[],
  lang: Lang,
): T[] {
  if (lang !== 'en') return events;
  return events.map((e) =>
    PEOPLE_EVENTS.has(e.type) ? e : { ...e, detail: localize(e.detail, lang) },
  );
}

/** Notificacoes cujo `detail` e texto do sistema (as outras levam trecho de comentario ou veredito). */
const SYSTEM_NOTIFICATIONS = new Set<NotificationType>(['YARA_PACK_UPDATE', 'IOC_SEEN']);

export function localizeNotifications<T extends { type: NotificationType; detail: string | null }>(
  items: T[],
  lang: Lang,
): T[] {
  if (lang !== 'en') return items;
  return items.map((n) =>
    SYSTEM_NOTIFICATIONS.has(n.type) ? { ...n, detail: localize(n.detail, lang) } : n,
  );
}

/** Eventos da auditoria: o detalhe e o alvo fixo (configuracao, backup agendado) sao do sistema. */
export function localizeAudit<T extends { detail: string | null; targetLabel: string | null }>(
  items: T[],
  lang: Lang,
): T[] {
  if (lang !== 'en') return items;
  return items.map((e) => ({
    ...e,
    detail: localize(e.detail, lang),
    targetLabel: localize(e.targetLabel, lang),
  }));
}
