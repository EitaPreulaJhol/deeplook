import { describe, expect, it } from 'vitest';

import { KB_CATEGORIES, kbCategoryLabel, kbHref } from './kb';

describe('base de conhecimento', () => {
  it('cada categoria tem rótulo', () => {
    for (const { id, label } of KB_CATEGORIES) expect(kbCategoryLabel(id)).toBe(label);
    expect(kbCategoryLabel('SCAM')).toBe('Golpe');
  });

  it('categoria desconhecida (de uma versão mais nova) mostra o próprio código', () => {
    expect(kbCategoryLabel('OUTRA' as never)).toBe('OUTRA');
  });

  it('endereço do artigo', () => {
    expect(kbHref('abc')).toBe('/kb/abc');
  });
});
