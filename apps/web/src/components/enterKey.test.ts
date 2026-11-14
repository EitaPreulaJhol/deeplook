import { describe, expect, it } from 'vitest';

import { isSubmitEnter } from './enterKey';

const key = (k: string, keyCode: number, isComposing = false) => ({
  key: k,
  keyCode,
  nativeEvent: { isComposing },
});

describe('isSubmitEnter', () => {
  it('aceita o Enter comum', () => {
    expect(isSubmitEnter(key('Enter', 13))).toBe(true);
  });

  it('ignora o Enter que confirma uma composicao de IME', () => {
    expect(isSubmitEnter(key('Enter', 229, true))).toBe(false);
    // Safari: o compositionend chega antes e o isComposing ja vem falso, mas o keyCode e 229.
    expect(isSubmitEnter(key('Enter', 229, false))).toBe(false);
  });

  it('ignora as outras teclas', () => {
    expect(isSubmitEnter(key('a', 65))).toBe(false);
    expect(isSubmitEnter(key('Process', 229, true))).toBe(false);
  });
});
