import { describe, expect, it } from 'vitest';

import { dateOrder, datePlaceholder, formatIsoDate, parseLocaleDate } from './dateField';

const PT = 'pt-BR';
const EN = 'en-US';

describe('dateField', () => {
  it('segue a ordem do locale', () => {
    expect(dateOrder(PT)).toEqual(['day', 'month', 'year']);
    expect(dateOrder(EN)).toEqual(['month', 'day', 'year']);
  });

  it('monta o texto de exemplo com as letras do idioma', () => {
    expect(datePlaceholder(PT, { day: 'd', month: 'm', year: 'a' })).toBe('dd/mm/aaaa');
    expect(datePlaceholder(EN, { day: 'd', month: 'm', year: 'y' })).toBe('mm/dd/yyyy');
  });

  it('formata a data ISO no locale', () => {
    expect(formatIsoDate('2026-10-16', PT)).toBe('16/10/2026');
    expect(formatIsoDate('2026-10-16', EN)).toBe('10/16/2026');
    expect(formatIsoDate('16/10/2026', PT)).toBe('');
  });

  it('le o que foi digitado no locale', () => {
    expect(parseLocaleDate('16/10/2026', PT)).toBe('2026-10-16');
    expect(parseLocaleDate('6.1.2026', PT)).toBe('2026-01-06');
    expect(parseLocaleDate('10/16/2026', EN)).toBe('2026-10-16');
    expect(parseLocaleDate(' 16-10-2026 ', PT)).toBe('2026-10-16');
  });

  it('recusa o que nao e data do calendario', () => {
    expect(parseLocaleDate('31/02/2026', PT)).toBeNull();
    expect(parseLocaleDate('10/16/2026', PT)).toBeNull();
    expect(parseLocaleDate('16/10/26', PT)).toBeNull();
    expect(parseLocaleDate('16/10', PT)).toBeNull();
    expect(parseLocaleDate('', PT)).toBeNull();
    expect(parseLocaleDate('aa/bb/cccc', PT)).toBeNull();
  });
});
