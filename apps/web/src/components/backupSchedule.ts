/**
 * Calendario do backup agendado (item 6.13), no horario local do navegador: e o fuso que a tela
 * manda ao salvar, e a API calcula a proxima execucao de verdade com ele. Aqui so a previa, para
 * o admin ver no calendario quando o backup vai sair antes de salvar.
 */
import { localized } from '../i18n';
import { t } from '../i18n/admin';

export interface ScheduleDraft {
  enabled: boolean;
  mode: 'weekly' | 'monthly';
  /** 0 = domingo ... 6 = sabado. */
  days: number[];
  /** 1 a 28: vale em todo mes. */
  dayOfMonth: number;
  /** HH:MM */
  time: string;
}

export const WEEKDAY_LABELS = localized(() => [
  t('wdSun'),
  t('wdMon'),
  t('wdTue'),
  t('wdWed'),
  t('wdThu'),
  t('wdFri'),
  t('wdSat'),
]);
const WEEKDAY_SHORT = localized(() => [
  t('wdsSun'),
  t('wdsMon'),
  t('wdsTue'),
  t('wdsWed'),
  t('wdsThu'),
  t('wdsFri'),
  t('wdsSat'),
]);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const validTime = (time: string) => TIME.test(time);

/** O agendamento roda neste dia (data local)? */
export function runsOn(draft: ScheduleDraft, date: Date): boolean {
  if (!draft.enabled) return false;
  return draft.mode === 'weekly'
    ? draft.days.includes(date.getDay())
    : date.getDate() === draft.dayOfMonth;
}

/** As proximas `count` execucoes depois de `after`, na hora local. */
export function upcomingLocal(draft: ScheduleDraft, after: Date, count: number): Date[] {
  if (!draft.enabled || !validTime(draft.time)) return [];
  if (draft.mode === 'weekly' && draft.days.length === 0) return [];
  const [hour, minute] = draft.time.split(':').map(Number);
  const runs: Date[] = [];
  for (let offset = 0; offset < 400 && runs.length < count; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset);
    if (!runsOn(draft, day)) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    if (at.getTime() > after.getTime()) runs.push(at);
  }
  return runs;
}

/** Semanas de um mes (domingo a sabado), com `null` fora dele. */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "seg, qua e sex às 02:00", "todos os dias às 02:00" ou "todo dia 5 às 03:30". */
export function describeDraft(draft: ScheduleDraft): string {
  if (draft.mode === 'monthly') {
    return t('schedMonthly', { day: draft.dayOfMonth, time: draft.time });
  }
  if (draft.days.length === 7) return t('schedDaily', { time: draft.time });
  const names = [...draft.days].sort().map((d) => WEEKDAY_SHORT[d]);
  const list =
    names.length > 1
      ? t('listAnd', { list: names.slice(0, -1).join(', '), last: names[names.length - 1] })
      : names[0];
  return t('schedAt', { days: list ?? t('noDay'), time: draft.time });
}
