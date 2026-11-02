import { z } from 'zod';

import { isMutable } from './notification-types';

/** Preferencias de uso do usuario (coluna JSON `User.preferences`). */
export const PreferencesSchema = z.object({
  /** Tela aberta apos o login e na raiz "/". */
  startPage: z.enum(['welcome', 'dashboard', 'history', 'mine']),
  /** Registros por pagina nas listas de amostras. */
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  /** Reabre as abas de documento da sessao anterior ao entrar. */
  restoreTabs: z.boolean(),
  /** Painel de detalhe abaixo das listas (clique seleciona, duplo clique abre). */
  detailPane: z.boolean(),
  /** Pastas recolhidas no Navegador (item 141). */
  closedFolders: z.array(z.string().min(1).max(40)).max(30),
  /**
   * Avisos silenciados (item 164). Tipo desconhecido ou travado sai sem erro: um valor
   * de outra versao nao derruba a lista inteira, e o que pede acao nunca fica de fora.
   */
  mutedNotifications: z
    .array(z.string().max(40))
    .max(40)
    .transform((types) => [...new Set(types)].filter(isMutable)),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  startPage: 'welcome',
  pageSize: 50,
  restoreTabs: true,
  detailPane: false,
  closedFolders: [],
  mutedNotifications: [],
};

/** Atualizacao parcial; chaves desconhecidas sao recusadas. */
export const PreferencesPatchSchema = PreferencesSchema.partial().strict();

/**
 * Completa o JSON salvo com os valores padrao. Cada chave e validada
 * isoladamente: um valor invalido (ex.: de uma versao antiga) cai no padrao
 * sem descartar as demais preferencias.
 */
export function resolvePreferences(raw: unknown): Preferences {
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
    const parsed = PreferencesSchema.shape[key].safeParse(stored[key]);
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data;
  }
  return result;
}
