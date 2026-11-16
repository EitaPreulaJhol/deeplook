import { describe, expect, it } from 'vitest';

import { fmtDuration } from './AdminMonitorTab';
import { niceTop } from './MonitorChart';

describe('fmtDuration (Monitoramento)', () => {
  it('escolhe a unidade pelo tamanho', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(850)).toBe('850 ms');
    expect(fmtDuration(12_400)).toBe('12 s');
    expect(fmtDuration(3 * 60_000 + 5000)).toBe('3 min');
    expect(fmtDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min');
    expect(fmtDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h');
  });
});

describe('niceTop (eixo dos gráficos)', () => {
  it('arredonda para 1, 2, 5 x 10^n acima do maior valor', () => {
    expect(niceTop(0.7)).toBe(1);
    expect(niceTop(3)).toBe(5);
    expect(niceTop(4)).toBe(5);
    expect(niceTop(12)).toBe(20);
    expect(niceTop(480)).toBe(500);
    expect(niceTop(1000)).toBe(1000);
  });
});
