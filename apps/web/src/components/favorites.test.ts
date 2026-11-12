import { describe, expect, it } from 'vitest';

import type { Favorite } from '../api/types';
import { currentViewUrl, favoriteHref, suggestViewName } from './favorites';

describe('favoriteHref', () => {
  it('amostra fixada abre a ficha; visão salva abre o endereço guardado', () => {
    expect(favoriteHref({ kind: 'ENTRY', entryId: 'e1' } as Favorite)).toBe('/entries/e1');
    expect(favoriteHref({ kind: 'VIEW', url: '/history?status=PENDING' } as Favorite)).toBe(
      '/history?status=PENDING',
    );
  });

  it('visão sem endereço cai na raiz', () => {
    expect(favoriteHref({ kind: 'VIEW', url: null } as Favorite)).toBe('/');
  });
});

describe('suggestViewName', () => {
  it('junta os filtros ativos e ignora os vazios', () => {
    expect(
      suggestViewName('Histórico Global', ['Pendentes', false, null, undefined, 'Malicioso']),
    ).toBe('Pendentes · Malicioso');
  });

  it('sem filtro, usa o nome da lista', () => {
    expect(suggestViewName('Histórico Global', [false, '', null])).toBe('Histórico Global');
  });

  it('cabe no limite de 60 caracteres da API', () => {
    const name = suggestViewName('x', ['a'.repeat(40), 'b'.repeat(40)]);
    expect(name).toHaveLength(60);
    expect(name.endsWith('…')).toBe(true);
    expect(suggestViewName('x', ['a'.repeat(60)])).toBe('a'.repeat(60));
  });
});

describe('currentViewUrl', () => {
  it('tira a página: a visão salva abre sempre na primeira', () => {
    expect(currentViewUrl('/history', '?status=PENDING&offset=100&q=nf')).toBe(
      '/history?status=PENDING&q=nf',
    );
  });

  it('sem filtros, só o caminho', () => {
    expect(currentViewUrl('/history', '')).toBe('/history');
    expect(currentViewUrl('/history', '?offset=50')).toBe('/history');
  });
});
