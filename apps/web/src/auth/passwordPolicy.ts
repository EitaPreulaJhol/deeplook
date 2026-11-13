/**
 * Politica de senha (item 51), igual a da API (src/lib/password-policy.ts):
 * minimo de 8 caracteres, com ao menos um numero e um caractere especial (o que
 * nao e letra, inclusive acentuada, numero nem espaco), e no maximo 72 bytes (o
 * bcrypt ignora o resto).
 */
import { t } from '../i18n/shell';
export const PASSWORD_HELP = () => t('pwdHelp');

const SPECIAL = /[^\p{L}\p{N}\s]/u;

/** Primeiro problema da senha, ou null se ela segue a regra. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return t('pwdMin8');
  if (new TextEncoder().encode(password).length > 72) {
    return t('pwdMax72');
  }
  if (!/\d/.test(password)) return t('pwdNeedDigit');
  if (!SPECIAL.test(password)) return t('pwdNeedSpecial');
  return null;
}

/** Dias inteiros que faltam ate a validade (0 = menos de 24 h); null sem validade. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 86400000));
}
