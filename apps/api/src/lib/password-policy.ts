import { z } from 'zod';

import { env } from '../env';

/**
 * Politica de senha (item 51): formato minimo e validade (PASSWORD_MAX_AGE_DAYS,
 * 0 = sem validade). Admins nao expiram. Vale para quem escolhe uma senha
 * (cadastro, Alterar senha, Definir nova senha); senhas antigas fora da regra
 * continuam valendo ate a proxima troca.
 */

/** Caractere especial: o que nao e letra (inclusive acentuada), numero nem espaco. */
const SPECIAL = /[^\p{L}\p{N}\s]/u;

export const passwordField = z
  .string()
  .min(8)
  .max(200)
  .regex(/\d/, 'inclua ao menos um número')
  .regex(SPECIAL, 'inclua ao menos um caractere especial');

export type PasswordChangeReason = 'reset' | 'expired' | null;

interface Account {
  role: string;
  passwordChangedAt: Date;
  mustChangePassword: boolean;
}

/** Quando a senha vence (null para admins ou sem validade configurada). */
export function passwordExpiresAt(u: Account): Date | null {
  if (u.role === 'ADMIN' || !env.PASSWORD_MAX_AGE_DAYS) return null;
  return new Date(u.passwordChangedAt.getTime() + env.PASSWORD_MAX_AGE_DAYS * 86400000);
}

/**
 * Situacao da senha: precisa trocar (redefinida pelo admin ou vencida), o motivo
 * e a data de validade.
 */
export function passwordState(u: Account, now = Date.now()) {
  const expiresAt = passwordExpiresAt(u);
  const expired = Boolean(expiresAt && expiresAt.getTime() <= now);
  const reason: PasswordChangeReason = u.mustChangePassword ? 'reset' : expired ? 'expired' : null;
  return {
    mustChangePassword: reason !== null,
    passwordChangeReason: reason,
    passwordExpiresAt: expiresAt,
  };
}
