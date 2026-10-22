import { env } from '../env';

/** Limites de prazo (horas no status atual) mostrados nas listas e na ficha. */
export function slaConfig() {
  return { warnHours: env.SLA_WARN_HOURS, lateHours: env.SLA_LATE_HOURS };
}

/** Instante antes do qual uma amostra nao concluida passa do limite. */
export function slaCutoff(level: 'warn' | 'late', now = Date.now()): Date {
  const hours = level === 'warn' ? env.SLA_WARN_HOURS : env.SLA_LATE_HOURS;
  return new Date(now - hours * 3600 * 1000);
}
