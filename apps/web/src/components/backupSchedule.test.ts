import { describe, expect, it } from 'vitest';

import {
  describeDraft,
  monthGrid,
  runsOn,
  type ScheduleDraft,
  upcomingLocal,
  validTime,
} from './backupSchedule';

const weekly = (days: number[], time = '02:00'): ScheduleDraft => ({
  enabled: true,
  mode: 'weekly',
  days,
  dayOfMonth: 1,
  time,
});

describe('calendário do backup agendado', () => {
  // Sábado, 7 de novembro de 2026, 10:00 (hora local).
  const now = new Date(2026, 10, 7, 10, 0);

  it('semanal: os próximos dias marcados, a partir do seguinte quando a hora já passou', () => {
    const runs = upcomingLocal(weekly([1, 3, 5]), now, 3);
    expect(runs.map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([
      [9, 2, 0],
      [11, 2, 0],
      [13, 2, 0],
    ]);
  });

  it('hoje entra se o horário ainda não passou', () => {
    const runs = upcomingLocal(weekly([6], '23:30'), now, 2);
    expect(runs.map((d) => d.getDate())).toEqual([7, 14]);
  });

  it('mensal: o dia escolhido, virando o mês e o ano', () => {
    const draft: ScheduleDraft = { ...weekly([]), mode: 'monthly', dayOfMonth: 5 };
    const runs = upcomingLocal(draft, now, 3);
    expect(runs.map((d) => [d.getFullYear(), d.getMonth(), d.getDate()])).toEqual([
      [2026, 11, 5],
      [2027, 0, 5],
      [2027, 1, 5],
    ]);
  });

  it('desligado, sem dias ou com horário inválido: nenhuma execução', () => {
    expect(upcomingLocal({ ...weekly([1]), enabled: false }, now, 3)).toEqual([]);
    expect(upcomingLocal(weekly([]), now, 3)).toEqual([]);
    expect(upcomingLocal(weekly([1], '25:00'), now, 3)).toEqual([]);
    expect(validTime('07:05')).toBe(true);
    expect(validTime('7:05')).toBe(false);
  });

  it('marca no calendário só os dias que rodam', () => {
    expect(runsOn(weekly([1]), new Date(2026, 10, 9))).toBe(true);
    expect(runsOn(weekly([1]), new Date(2026, 10, 10))).toBe(false);
  });

  it('grade do mês: começa no domingo e completa as semanas', () => {
    const weeks = monthGrid(2026, 10); // novembro de 2026 começa num domingo
    expect(weeks[0][0]?.getDate()).toBe(1);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    const feb = monthGrid(2027, 1); // fevereiro de 2027 começa numa segunda
    expect(feb[0][0]).toBeNull();
    expect(feb[0][1]?.getDate()).toBe(1);
  });

  it('descreve em português', () => {
    expect(describeDraft(weekly([5, 1, 3]))).toBe('seg, qua e sex às 02:00');
    expect(describeDraft(weekly([0, 1, 2, 3, 4, 5, 6]))).toBe('todos os dias às 02:00');
    expect(describeDraft({ ...weekly([]), mode: 'monthly', dayOfMonth: 5 })).toBe(
      'todo dia 5 às 02:00',
    );
  });
});
