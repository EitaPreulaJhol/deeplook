import { z } from 'zod';

/** Preferencias de uso do usuario (coluna JSON `User.preferences`). */
export const PreferencesSchema = z.object({
  /** Tela aberta apos o login e na raiz "/". */
  startPage: z.enum(['welcome', 'history', 'mine']),
  /** Registros por pagina nas listas de amostras. */
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  /** Reabre as abas de documento da sessao anterior ao entrar. */
  restoreTabs: z.boolean(),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  startPage: 'welcome',
  pageSize: 50,
  restoreTabs: true,
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
