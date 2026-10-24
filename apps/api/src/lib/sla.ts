import { env } from '../env';
import type { Priority, Prisma } from '../generated/prisma/client';

export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];

type Limits = { warnHours: number; lateHours: number };

/** "2/4" -> { warnHours: 2, lateHours: 4 } (formato validado no env.ts). */
function parse(value: string): Limits {
  const [warn, late] = value.split('/').map(Number);
  return { warnHours: warn, lateHours: late };
}

/**
 * Limites de prazo (horas no status atual) por prioridade (item 53). O P3 e o
 * prazo de antes (SLA_WARN_HOURS / SLA_LATE_HOURS); os outros vem de SLA_Pn_HOURS.
 */
export function slaLimits(): Record<Priority, Limits> {
  return {
    P1: parse(env.SLA_P1_HOURS),
    P2: parse(env.SLA_P2_HOURS),
    P3: { warnHours: env.SLA_WARN_HOURS, lateHours: env.SLA_LATE_HOURS },
    P4: parse(env.SLA_P4_HOURS),
  };
}

/** Limites mostrados nas listas e na ficha: o do P3 (padrao) e os de cada prioridade. */
export function slaConfig() {
  const byPriority = slaLimits();
  return { ...byPriority.P3, byPriority };
}

/**
 * Nao concluidas que passaram do alerta (`warn`) ou do atraso (`late`) da
 * propria prioridade.
 */
export function slaWhere(level: 'warn' | 'late', now = Date.now()): Prisma.EntryWhereInput {
  const limits = slaLimits();
  return {
    status: { not: 'COMPLETED' },
    OR: PRIORITIES.map((priority) => {
      const hours = level === 'warn' ? limits[priority].warnHours : limits[priority].lateHours;
      return { priority, statusChangedAt: { lt: new Date(now - hours * 3600 * 1000) } };
    }),
  };
}
