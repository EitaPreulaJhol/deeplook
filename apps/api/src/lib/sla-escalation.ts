import { env } from '../env';
import type { Priority, Role } from '../generated/prisma/client';
import { recordEvent } from './events';
import { notify } from './notifications';
import type { Db } from './prisma';
import { prisma } from './prisma';
import { PRIORITIES, slaLimits, slaWhere } from './sla';

/** Amostras tratadas por consulta (a rodada repete ate acabar). */
const BATCH = 200;
const HOUR_MS = 60 * 60 * 1000;
/** Intervalo entre as rodadas. */
const ROUND_MS = 5 * 60 * 1000;
/**
 * Prazo cruzado ha mais tempo que isso (primeira subida com a fila cheia, API
 * parada por dias) so e marcado, sem avisar: evita uma enxurrada de avisos.
 */
export const SLA_GRACE_MS = 24 * HOUR_MS;

/** Um nivel acima (P4 -> P3 ... P2 -> P1); o P1 fica. */
function raise(priority: Priority): Priority {
  return PRIORITIES[Math.max(0, PRIORITIES.indexOf(priority) - 1)];
}

/** Ids dos usuarios ativos com o papel (destinatarios sem responsavel / admins). */
async function usersWithRole(db: Db, role: Role): Promise<string[]> {
  const users = await db.user.findMany({
    where: { role, status: 'ACTIVE' },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

type Due = {
  id: string;
  priority: Priority;
  statusChangedAt: Date;
  assigneeId: string | null;
  slaStage: 'WARN' | 'LATE' | null;
};

/**
 * Escalonamento por prazo (item 73). Cada amostra nao concluida avisa no maximo
 * uma vez por nivel enquanto estiver no mesmo status (`slaStage`; o trigger de
 * status zera o campo):
 * - **alerta**: o responsavel (sem responsavel, os analistas);
 * - **atraso**: o responsavel (ou os analistas) e os admins; com
 *   SLA_ESCALATE_PRIORITY a prioridade sobe um nivel.
 * Tudo vai para o historico da amostra, com autor "Sistema".
 */
export async function escalateSla(now = new Date()): Promise<{ warned: number; late: number }> {
  const limits = slaLimits();
  const result = { warned: 0, late: 0 };

  // Atraso primeiro: quem pulou direto para atrasada nao recebe o alerta tambem.
  for (const level of ['LATE', 'WARN'] as const) {
    const seen = new Set<string>();
    for (;;) {
      const due: Due[] = await prisma.entry.findMany({
        where: {
          AND: [
            slaWhere(level === 'LATE' ? 'late' : 'warn', now.getTime()),
            level === 'LATE'
              ? { OR: [{ slaStage: null }, { slaStage: 'WARN' }] }
              : { slaStage: null },
            { id: { notIn: [...seen] } },
          ],
        },
        select: {
          id: true,
          priority: true,
          statusChangedAt: true,
          assigneeId: true,
          slaStage: true,
        },
        orderBy: { statusChangedAt: 'asc' },
        take: BATCH,
      });
      if (!due.length) break;
      for (const entry of due) {
        seen.add(entry.id);
        const hours =
          level === 'LATE' ? limits[entry.priority].lateHours : limits[entry.priority].warnHours;
        const crossedAt = entry.statusChangedAt.getTime() + hours * HOUR_MS;
        const fresh = now.getTime() - crossedAt <= SLA_GRACE_MS;
        const bump =
          level === 'LATE' &&
          fresh &&
          env.SLA_ESCALATE_PRIORITY === 'true' &&
          entry.priority !== 'P1';
        const sent = await prisma.$transaction(async (tx) => {
          // So marca se ninguem mexeu no meio (status, prazo ou outra rodada).
          const { count } = await tx.entry.updateMany({
            where: {
              id: entry.id,
              slaStage: entry.slaStage,
              statusChangedAt: entry.statusChangedAt,
              priority: entry.priority,
            },
            data: { slaStage: level, ...(bump ? { priority: raise(entry.priority) } : {}) },
          });
          if (!count || !fresh) return false;
          await recordEvent(tx, {
            entryId: entry.id,
            actorId: null,
            type: level === 'LATE' ? 'SLA_LATE' : 'SLA_WARN',
            fromValue: entry.priority,
            detail: String(hours),
          });
          if (bump) {
            await recordEvent(tx, {
              entryId: entry.id,
              actorId: null,
              type: 'PRIORITY_CHANGED',
              fromValue: entry.priority,
              toValue: raise(entry.priority),
              detail: 'escalonamento',
            });
          }
          const owners = entry.assigneeId ? [entry.assigneeId] : await usersWithRole(tx, 'ANALYST');
          const admins = level === 'LATE' ? await usersWithRole(tx, 'ADMIN') : [];
          await notify(
            tx,
            [...owners, ...admins].map((userId) => ({
              userId,
              type: level === 'LATE' ? ('SLA_LATE' as const) : ('SLA_WARN' as const),
              entryId: entry.id,
              actorId: null,
              detail: String(hours),
            })),
          );
          return true;
        });
        if (sent) result[level === 'LATE' ? 'late' : 'warned'] += 1;
      }
    }
  }
  return result;
}

/** Liga o escalonamento: uma rodada ao subir e depois a cada 5 minutos. */
export function startSlaEscalation(log: {
  info: (msg: string) => void;
  error: (obj: object, msg: string) => void;
}): void {
  let running = false;
  const round = async () => {
    if (running) return;
    running = true;
    try {
      const { warned, late } = await escalateSla();
      if (warned || late) {
        log.info(`[prazo] avisos enviados: ${warned} em alerta, ${late} atrasada(s).`);
      }
    } catch (err) {
      log.error({ err }, '[prazo] falha no escalonamento');
    } finally {
      running = false;
    }
  };
  void round();
  setInterval(() => void round(), ROUND_MS).unref();
}
