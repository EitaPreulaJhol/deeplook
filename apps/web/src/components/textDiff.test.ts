import { describe, expect, it } from 'vitest';

import { type DiffLine, lineDiff } from './textDiff';

/** Compacta o diff para "kind:text" por linha, mais facil de comparar. */
const compact = (lines: DiffLine[]) => lines.map((l) => `${l.kind}:${l.text}`);

describe('lineDiff', () => {
  it('nulo, indefinido e vazio nao geram linhas', () => {
    expect(lineDiff(null, null)).toEqual([]);
    expect(lineDiff(undefined, undefined)).toEqual([]);
    expect(lineDiff('', '')).toEqual([]);
  });

  it('de vazio para uma linha e so adicao; o contrario e so remocao', () => {
    expect(compact(lineDiff(undefined, 'a'))).toEqual(['add:a']);
    expect(compact(lineDiff('a', undefined))).toEqual(['del:a']);
  });

  it('textos iguais sao todos "same"', () => {
    expect(compact(lineDiff('a\nb\nc', 'a\nb\nc'))).toEqual(['same:a', 'same:b', 'same:c']);
  });

  it('marca a linha inserida entre duas iguais', () => {
    expect(compact(lineDiff('a\nc', 'a\nb\nc'))).toEqual(['same:a', 'add:b', 'same:c']);
  });

  it('marca a linha removida entre duas iguais', () => {
    expect(compact(lineDiff('a\nb\nc', 'a\nc'))).toEqual(['same:a', 'del:b', 'same:c']);
  });

  it('uma linha alterada vira remocao seguida de adicao, na ordem', () => {
    expect(compact(lineDiff('a\nb', 'a\nB'))).toEqual(['same:a', 'del:b', 'add:B']);
  });

  it('trata CRLF e LF igual (o \\r sai no split)', () => {
    expect(compact(lineDiff('a\r\nb', 'a\nb'))).toEqual(['same:a', 'same:b']);
  });

  it('sobra no fim do trecho: so remocoes ou so adicoes depois de casar', () => {
    // 'b' casa; 'x' e 'y' do antigo ficam sem par no fim do miolo (e vice-versa).
    expect(compact(lineDiff('a\nb\nx\ny\nz', 'a\nb\nz'))).toEqual([
      'same:a',
      'same:b',
      'del:x',
      'del:y',
      'same:z',
    ]);
    expect(compact(lineDiff('a\nb\nz', 'a\nb\nx\ny\nz'))).toEqual([
      'same:a',
      'same:b',
      'add:x',
      'add:y',
      'same:z',
    ]);
    // Sem inicio nem fim em comum e sem nenhuma linha igual: tudo sai e tudo entra.
    expect(compact(lineDiff('a\nb', 'c\nd\ne'))).toEqual([
      'del:a',
      'del:b',
      'add:c',
      'add:d',
      'add:e',
    ]);
  });

  it('diff gigante (acima de 4 milhoes de celulas) vira troca inteira, sem montar a tabela', () => {
    const many = (prefix: string) => Array.from({ length: 2100 }, (_, i) => `${prefix}${i}`);
    const diff = lineDiff(many('antiga-').join('\n'), many('nova-').join('\n'));
    expect(diff).toHaveLength(4200);
    expect(diff.slice(0, 2100).every((l) => l.kind === 'del')).toBe(true);
    expect(diff.slice(2100).every((l) => l.kind === 'add')).toBe(true);
  });

  it('preserva a ordem num diff com varias mudancas', () => {
    expect(compact(lineDiff('linha1\nvelha\nfim', 'linha1\nnova1\nnova2\nfim'))).toEqual([
      'same:linha1',
      'del:velha',
      'add:nova1',
      'add:nova2',
      'same:fim',
    ]);
  });
});
