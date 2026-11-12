import { describe, expect, it } from 'vitest';

import type { Preferences, StartPage } from '../api/types';
import { DEFAULT_PREFERENCES, startPath } from './preferences';

describe('startPath', () => {
  it('leva cada página inicial à rota dela', () => {
    const paths: Record<StartPage, string> = {
      welcome: '/inicio',
      dashboard: '/painel',
      history: '/history',
      mine: '/me',
    };
    for (const [startPage, path] of Object.entries(paths)) {
      expect(startPath({ ...DEFAULT_PREFERENCES, startPage: startPage as StartPage })).toBe(path);
    }
  });

  it('valor desconhecido (de uma versão mais nova) cai na página de boas-vindas', () => {
    const odd = { ...DEFAULT_PREFERENCES, startPage: 'outra' } as unknown as Preferences;
    expect(startPath(odd)).toBe('/inicio');
  });

  it('o padrão abre nas boas-vindas', () => {
    expect(startPath(DEFAULT_PREFERENCES)).toBe('/inicio');
  });
});
