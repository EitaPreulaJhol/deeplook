/**
 * Politica de senha (item 51), igual a da API (src/lib/password-policy.ts):
 * minimo de 8 caracteres, com ao menos um numero e um caractere especial (o que
 * nao e letra, inclusive acentuada, numero nem espaco).
 */
export const PASSWORD_HELP =
  'Mínimo de 8 caracteres, com ao menos um número e um caractere especial.';

const SPECIAL = /[^\p{L}\p{N}\s]/u;

/** Primeiro problema da senha, ou null se ela segue a regra. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'mínimo de 8 caracteres';
  if (!/\d/.test(password)) return 'inclua ao menos um número';
  if (!SPECIAL.test(password)) return 'inclua ao menos um caractere especial';
  return null;
}

/** Dias inteiros que faltam ate a validade (0 = menos de 24 h); null sem validade. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 86400000));
}
