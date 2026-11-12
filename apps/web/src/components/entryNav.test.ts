// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEntrySequence, saveEntrySequence } from './entryNav';

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('sequência de amostras da última lista', () => {
  it('guarda e devolve os ids na ordem', () => {
    saveEntrySequence(['a', 'b', 'c']);
    expect(loadEntrySequence()).toEqual(['a', 'b', 'c']);
  });

  it('sem nada guardado, lista vazia', () => {
    expect(loadEntrySequence()).toEqual([]);
  });

  it('conteúdo estragado ou de outro formato não quebra a ficha', () => {
    window.sessionStorage.setItem('dl-entry-sequence', '{não é json');
    expect(loadEntrySequence()).toEqual([]);
    window.sessionStorage.setItem('dl-entry-sequence', '{"a":1}');
    expect(loadEntrySequence()).toEqual([]);
    window.sessionStorage.setItem('dl-entry-sequence', '["a", 2, null, "b"]');
    expect(loadEntrySequence()).toEqual(['a', 'b']);
  });

  it('armazenamento indisponível (modo privado, cota): segue sem Anterior/Próxima', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cota');
    });
    expect(() => saveEntrySequence(['a'])).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(loadEntrySequence()).toEqual([]);
  });
});
