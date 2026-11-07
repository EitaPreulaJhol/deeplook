import { z } from 'zod';

import { env } from '../env';
import { audit } from './audit';
import { backupInFlight, createBackup } from './backup';
import { log } from './log';
import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';

/**
 * Backup agendado (item 6.13). O admin escolhe na aba Backup os dias (da semana ou do mes) e o
 * horario, no fuso do navegador de quem salvou; a API calcula a proxima execucao e, de minuto em
 * minuto, gera o backup quando ela chega. O ZIP agendado leva as amostras e sai com a senha
 * BACKUP_SCHEDULE_PASSWORD do .env (a da tela nao fica guardada). Vai para onde vao os demais:
 * a pasta BACKUP_DIR, se configurada, ou o bucket.
 */

const KEY = 'backupSchedule';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** O que a tela manda. Dia do mes so ate 28: vale em todo mes, sem regra para o dia 31. */
export const ScheduleInput = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['weekly', 'monthly']),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    dayOfMonth: z.number().int().min(1).max(28).default(1),
    time: z.string().regex(TIME, 'horário no formato HH:MM'),
    timezone: z.string().min(1).max(64).refine(validTimeZone, 'fuso horário desconhecido'),
  })
  .strict()
  .refine((s) => s.mode !== 'weekly' || s.days.length > 0, {
    path: ['days'],
    message: 'escolha ao menos um dia da semana',
  });

export type ScheduleConfig = z.infer<typeof ScheduleInput>;
export type BackupSchedule = ScheduleConfig & {
  /** Proxima execucao, em UTC (ISO). */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastBackupId: string | null;
};

/** Ano, mes, dia, hora e minuto de um instante no fuso dado. */
function partsIn(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday,
  };
}

/** Quanto o fuso esta a frente do UTC num instante (ms; Sao Paulo = -3 h). */
function offsetAt(t: number, tz: string): number {
  const p = partsIn(new Date(t), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000;
}

/**
 * O instante em UTC de uma hora "de parede" num fuso. Testa o deslocamento de antes e o de
 * depois de uma eventual troca de horario de verao e fica com o que reproduz a hora pedida:
 * - na hora repetida (fim do horario de verao), a primeira das duas;
 * - na hora que nao existe (inicio dele, 02:00 que vira 03:00), a que existe logo depois, como
 *   o `Date` do navegador faz na previa da tela.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetAt(wall - 86_400_000, tz);
  const after = offsetAt(wall + 86_400_000, tz);
  const matches = [...new Set([before, after])]
    .map((offset) => wall - offset)
    .filter((t) => t + offsetAt(t, tz) === wall)
    .sort((a, b) => a - b);
  return new Date(matches[0] ?? wall - before);
}

/** Proximas `count` execucoes depois de `after` (estritamente). */
export function upcomingRuns(config: ScheduleConfig, after: Date, count = 1): Date[] {
  const [hour, minute] = config.time.split(':').map(Number);
  const start = partsIn(after, config.timezone);
  const runs: Date[] = [];
  // Ate 400 dias: cobre o mensal com folga.
  for (let offset = 0; offset < 400 && runs.length < count; offset++) {
    // Meio-dia UTC do dia local: soma dias sem cair em outro por causa do fuso.
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const matches =
      config.mode === 'weekly' ? config.days.includes(day.getUTCDay()) : d === config.dayOfMonth;
    if (!matches) continue;
    const at = zonedTimeToUtc(y, m, d, hour, minute, config.timezone);
    if (at.getTime() > after.getTime()) runs.push(at);
  }
  return runs;
}

export async function readSchedule(): Promise<BackupSchedule | null> {
  return (await readSetting(KEY)) as BackupSchedule | null;
}

/** Salva o que a tela mandou e recalcula a proxima execucao. */
export async function saveSchedule(
  config: ScheduleConfig,
  actorId: string,
  req: Parameters<typeof audit>[1],
): Promise<BackupSchedule> {
  const previous = await readSchedule();
  const schedule: BackupSchedule = {
    ...config,
    days: [...new Set(config.days)].sort(),
    nextRunAt: config.enabled ? (upcomingRuns(config, new Date())[0]?.toISOString() ?? null) : null,
    lastRunAt: previous?.lastRunAt ?? null,
    lastBackupId: previous?.lastBackupId ?? null,
  };
  await writeSetting(KEY, schedule);
  await audit(prisma, req, {
    action: 'SETTING_CHANGED',
    actorId,
    targetLabel: 'Backup agendado',
    detail: config.enabled ? describe(schedule) : 'desligado',
  });
  return schedule;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "seg, qua, sex às 02:00 (America/Sao_Paulo)" ou "todo dia 1 às 03:30 (...)". */
export function describe(s: ScheduleConfig): string {
  const when =
    s.mode === 'monthly'
      ? `todo dia ${s.dayOfMonth}`
      : s.days.length === 7
        ? 'todos os dias'
        : [...s.days]
            .sort()
            .map((d) => WEEKDAYS[d])
            .join(', ');
  return `${when} às ${s.time} (${s.timezone})`;
}

/**
 * Um passo do relogio: se a proxima execucao chegou, gera o backup e marca a seguinte. Com a API
 * fora do ar na hora marcada, o backup sai uma vez quando ela volta, e o calendario segue. Com
 * outro backup em andamento, tenta de novo no minuto seguinte.
 */
export async function runDueSchedule(now = new Date()): Promise<string | null> {
  const schedule = await readSchedule();
  if (!schedule?.enabled || !schedule.nextRunAt) return null;
  if (now.getTime() < Date.parse(schedule.nextRunAt)) return null;
  if (!env.BACKUP_SCHEDULE_PASSWORD) return null;
  const id = await createBackup({
    includeSamples: true,
    password: env.BACKUP_SCHEDULE_PASSWORD,
    createdById: null,
    scheduled: true,
    req: null,
  });
  if (!id) return null;
  await writeSetting(KEY, {
    ...schedule,
    nextRunAt: upcomingRuns(schedule, now)[0]?.toISOString() ?? null,
    lastRunAt: now.toISOString(),
    lastBackupId: id,
  });
  return id;
}

/** Relogio do agendamento: confere a cada minuto. */
export function startBackupSchedule(): void {
  const tick = () =>
    void runDueSchedule().catch((err: unknown) =>
      log.error({ err }, '[backup] falha no agendamento'),
    );
  tick();
  setInterval(tick, 60 * 1000).unref();
}

/** Para os testes: o backup que o agendamento acabou de iniciar. */
export function scheduledRun(): Promise<void> {
  return backupInFlight();
}
