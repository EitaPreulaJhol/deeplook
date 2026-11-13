import { useSyncExternalStore } from 'react';

/**
 * Idioma da interface (revisao de novembro, item 2.5). Sem biblioteca: o idioma atual, um
 * assinante e dicionarios por area, com o portugues e o ingles lado a lado na mesma linha:
 *
 *   // i18n/cases.ts
 *   export const messages = { title: ['Casos', 'Cases'], count: ['{n} caso(s)', '{n} case(s)'] } ...;
 *   export const t = define(messages);
 *
 * Cada tela importa o t() da sua area (o TypeScript so aceita as chaves dela e as de COMMON), e o
 * dicionario vai junto do pedaco do pacote que carrega a tela. `{nome}` e trocado pelo valor dado.
 *
 * O idioma vem da preferencia da conta (logado) ou do que a pessoa escolheu nesta maquina (tela
 * de login); sem escolha, portugues. O navegador em ingles NAO muda o idioma sozinho.
 *
 * Ao trocar, a raiz (App) se redesenha inteira (useLocale). Por isso t() so pode ser chamado na
 * hora de desenhar: nunca no topo do modulo (o texto congelaria no idioma da carga) e, dentro de
 * useMemo/useCallback, com o idioma nas dependencias. O scripts/check-i18n.mjs reprova os dois.
 */
export type Locale = 'pt-BR' | 'en';
export type Pairs = Readonly<Record<string, readonly [pt: string, en: string]>>;

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'en', label: 'English' },
];

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

/** Data e hora no idioma atual ('—' sem data). */
export const fmtDateTime = (iso?: string | null, options?: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleString(intlLocale(), options) : '—';

/** So a data, no idioma atual ('—' sem data). */
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(intlLocale()) : '—';

/** Numero no idioma atual (separador de milhar). */
export const fmtNumber = (n: number, options?: Intl.NumberFormatOptions) =>
  n.toLocaleString(intlLocale(), options);

/** Textos que se repetem em todas as telas. */
export const COMMON = {
  save: ['Salvar', 'Save'],
  saving: ['Salvando...', 'Saving...'],
  cancel: ['Cancelar', 'Cancel'],
  close: ['Fechar', 'Close'],
  remove: ['Remover', 'Remove'],
  delete: ['Excluir', 'Delete'],
  edit: ['Editar', 'Edit'],
  add: ['Adicionar', 'Add'],
  create: ['Criar', 'Create'],
  back: ['Voltar', 'Back'],
  yes: ['Sim', 'Yes'],
  no: ['Não', 'No'],
  none: ['Nenhum', 'None'],
  loading: ['Carregando...', 'Loading...'],
  refresh: ['Atualizar', 'Refresh'],
  search: ['Buscar', 'Search'],
  filter: ['Filtrar', 'Filter'],
  clear: ['Limpar', 'Clear'],
  confirm: ['Confirmar', 'Confirm'],
  copy: ['Copiar', 'Copy'],
  download: ['Baixar', 'Download'],
  export: ['Exportar', 'Export'],
  import: ['Importar', 'Import'],
  open: ['Abrir', 'Open'],
  name: ['Nome', 'Name'],
  description: ['Descrição', 'Description'],
  status: ['Status', 'Status'],
  date: ['Data', 'Date'],
  user: ['Usuário', 'User'],
  actions: ['Ações', 'Actions'],
  enabled: ['Ativo', 'Enabled'],
  disabled: ['Desativado', 'Disabled'],
  unknownError: ['Erro inesperado.', 'Unexpected error.'],
  previous: ['Anterior', 'Previous'],
  next: ['Próxima', 'Next'],
} as const satisfies Pairs;

export type CommonKey = keyof typeof COMMON;
/** Valores do texto; null/undefined somem (como no JSX), nome ausente fica como {nome}. */
export type Vars = Record<string, string | number | null | undefined>;

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in vars ? String(vars[name] ?? '') : all,
  );
}

/** O t() de uma area: as chaves dela e as de COMMON, no idioma atual. */
export function define<P extends Pairs>(pairs: P) {
  return (key: (keyof P & string) | CommonKey, vars?: Vars): string => {
    const pair: readonly [string, string] | undefined =
      (pairs as Pairs)[key] ?? (COMMON as Pairs)[key];
    if (!pair) return key;
    return interpolate(pair[current === 'en' ? 1 : 0], vars);
  };
}
