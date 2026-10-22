import type { AuditAction, Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { prisma } from './prisma';

/** Cliente do Prisma ou transacao em andamento. */
type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditInput {
  action: AuditAction;
  /** Quem fez; null = anonimo (ex.: login recusado). */
  actorId: string | null;
  targetUserId?: string | null;
  /** Rotulo do alvo no momento (e-mail, codigo da chave, nome do modelo). */
  targetLabel?: string | null;
  /** Complemento legivel ("USER → ANALYST"). NUNCA senhas. */
  detail?: string | null;
}

/**
 * Registro de auditoria administrativa (aba Auditoria). Grave na mesma
 * transacao da acao quando houver uma. O IP vem do proxy (trustProxy).
 */
export async function audit(db: Db, req: FastifyRequest | null, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      action: input.action,
      actorId: input.actorId,
      targetUserId: input.targetUserId ?? null,
      targetLabel: input.targetLabel?.slice(0, 200) ?? null,
      detail: input.detail?.slice(0, 500) ?? null,
      ip: req?.ip ?? null,
    },
  });
}
