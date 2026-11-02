import { createHash } from 'node:crypto';

import { env } from '../env';
import type { PublicUser } from './auth';
import { isAnalyst } from './auth';
import { advisoryLock, type Db, prisma } from './prisma';

/** Janela da cota: as ultimas 24 horas (e nao o dia do calendario). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UploadQuota {
  /** null = sem limite (analistas, admins ou UPLOAD_DAILY_LIMIT=0). */
  limit: number | null;
  used: number;
  remaining: number | null;
  /** Quando a proxima vaga libera (so com a cota esgotada). */
  resetAt: Date | null;
}

/**
 * Cota de envio (item 64): usuarios comuns enviam ate UPLOAD_DAILY_LIMIT
 * amostras nas ultimas 24 horas (arquivo, link, cada arquivo de um .zip e
 * envios por token). Analistas e admins nao tem limite.
 */
export async function uploadQuota(user: PublicUser): Promise<UploadQuota> {
  const limit = env.UPLOAD_DAILY_LIMIT;
  if (!limit || isAnalyst(user)) return { limit: null, used: 0, remaining: null, resetAt: null };
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.entry.findMany({
    where: { ownerId: user.id, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const used = recent.length;
  const remaining = Math.max(0, limit - used);
  // Esgotada: a vaga volta quando o mais antigo dos ultimos `limit` envios sair da janela.
  const resetAt =
    remaining === 0 ? new Date(recent[recent.length - 1].createdAt.getTime() + WINDOW_MS) : null;
  return { limit, used, remaining, resetAt };
}

/** A cota acabou entre a conferencia inicial e a gravacao (envios simultaneos). */
export class QuotaExceeded extends Error {}

/**
 * Grava a amostra conferindo a cota na mesma transacao, com trava por pessoa: sem
 * isso, envios simultaneos leem a mesma contagem e todos passam. A conferencia na
 * entrada da rota continua, para recusar antes de receber o arquivo.
 */
export async function createWithinQuota<T>(
  ownerId: string,
  limited: boolean,
  create: (db: Db) => Promise<T>,
): Promise<T> {
  const limit = env.UPLOAD_DAILY_LIMIT;
  if (!limited || !limit) return create(prisma);
  const key = createHash('sha256').update(`quota:${ownerId}`).digest().readUIntBE(0, 6);
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, key);
    const used = await tx.entry.count({
      where: { ownerId, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    });
    if (used >= limit) throw new QuotaExceeded();
    return create(tx);
  });
}

/** "3 h 20 min" / "12 min" ate o instante (minimo de 1 min). */
function waitText(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Mensagem do 429 (cota esgotada). */
export function quotaMessage(quota: UploadQuota): string {
  return `Você já enviou ${quota.limit} amostras nas últimas 24 horas (limite para usuários comuns). A próxima libera em ${waitText(quota.resetAt ?? new Date())}.`;
}
