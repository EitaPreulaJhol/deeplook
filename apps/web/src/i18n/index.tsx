import { useSyncExternalStore } from 'react';

import { en } from './en';
import { type MessageKey, ptBR } from './pt-BR';

/**
 * Idioma da interface (revisao de novembro, item 2.5). Sem biblioteca: dois dicionarios, uma
 * funcao t() e um assinante. O idioma vem da preferencia da conta (logado) ou do que a pessoa
 * escolheu nesta maquina (tela de login); sem escolha, portugues. O navegador em ingles NAO muda o
 * idioma sozinho: a interface inteira ainda e majoritariamente em portugues, e misturar por padrao
 * seria pior do que escolher.
 *
 * Ao trocar, a raiz (App) se redesenha inteira (useLocale), entao funcoes fora de componente que
 * chamam t(), como verdictLabel(), tambem passam a responder no idioma novo.
 */
export type Locale = 'pt-BR' | 'en';
export type { MessageKey };

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'en', label: 'English' },
];

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { 'pt-BR': ptBR, en };
const STORAGE_KEY = 'dl-locale';

export const isLocale = (value: unknown): value is Locale => value === 'pt-BR' || value === 'en';

function stored(): Locale {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

let current: Locale = typeof window === 'undefined' ? 'pt-BR' : stored();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Troca o idioma (e lembra nesta maquina, para a tela de login). */
export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === current) return;
  current = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* sem armazenamento: vale ate recarregar */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

/** Texto da chave no idioma atual, com `{nome}` trocado pelos valores dados. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[current][key] ?? ptBR[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => String(vars[name] ?? all)) : text;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** O idioma atual; o componente se redesenha quando ele muda. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'pt-BR' as Locale);
}

/** Locale para Intl/toLocaleString ("en" vira "en-US", para datas no formato americano). */
export const intlLocale = (locale: Locale = current) => (locale === 'en' ? 'en-US' : 'pt-BR');
