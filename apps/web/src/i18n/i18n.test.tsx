// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { verdictLabel } from '../components/tags';
import {
  COMMON,
  define,
  fmtDate,
  fmtDateTime,
  fmtNumber,
  getLocale,
  intlLocale,
  localized,
  type Pairs,
  setLocale,
  t,
  useLocale,
} from './index';

afterEach(() => {
  cleanup();
  setLocale('pt-BR');
  window.localStorage.clear();
});

describe('idioma da interface', () => {
  it('começa em português, mesmo com o navegador em inglês', () => {
    expect(navigator.language.startsWith('en')).toBe(true);
    expect(getLocale()).toBe('pt-BR');
    expect(t('nav.home')).toBe('Página Inicial');
  });

  it('troca, lembra nesta máquina e marca o <html lang>', () => {
    setLocale('en');
    expect(t('nav.home')).toBe('Home');
    expect(window.localStorage.getItem('dl-locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(intlLocale()).toBe('en-US');
  });

  it('troca os valores {nome} do texto', () => {
    expect(t('nav.removeFavoriteConfirm', { name: 'Pendentes' })).toBe(
      'Remover "Pendentes" dos Favoritos?',
    );
    setLocale('en');
    expect(t('nav.removeFavoriteConfirm', { name: 'Pending' })).toBe(
      'Remove "Pending" from Favorites?',
    );
    expect(t('nav.removeFavoriteConfirm')).toContain('{name}');
  });

  it('valor desconhecido não muda nada', () => {
    setLocale('fr' as never);
    expect(getLocale()).toBe('pt-BR');
  });

  it('rótulos fora de componente seguem o idioma', () => {
    expect(verdictLabel('MALICIOUS')).toBe('Malicioso');
    setLocale('en');
    expect(verdictLabel('MALICIOUS')).toBe('Malicious');
  });

  it('o componente que assina se redesenha ao trocar', () => {
    function Probe() {
      useLocale();
      return <span>{t('user.logout')}</span>;
    }
    const { container } = render(<Probe />);
    expect(container.textContent).toBe('Sair');
    act(() => setLocale('en'));
    expect(container.textContent).toBe('Sign out');
  });

  it('t() da área: as chaves dela e as comuns', () => {
    const local = define({ title: ['Casos', 'Cases'] } as const);
    expect(local('title')).toBe('Casos');
    expect(local('cancel')).toBe('Cancelar');
    expect(local('nada' as never)).toBe('nada');
    setLocale('en');
    expect(local('title')).toBe('Cases');
    expect(local('cancel')).toBe('Cancel');
  });

  it('localized(): tabela no topo do módulo acompanha o idioma', () => {
    const local = define({ a: ['Um', 'One'], b: ['Dois', 'Two'] } as const);
    let builds = 0;
    const table: Record<string, string> = localized(() => {
      builds += 1;
      return { a: local('a'), b: local('b') };
    });
    const list = localized(() => [local('a'), local('b')]);
    expect(table.a).toBe('Um');
    expect('b' in table).toBe(true);
    expect(Object.entries(table)).toEqual([
      ['a', 'Um'],
      ['b', 'Dois'],
    ]);
    expect(list.map((x) => x.toUpperCase())).toEqual(['UM', 'DOIS']);
    const before = builds;
    void table.a;
    expect(builds).toBe(before);
    setLocale('en');
    expect(table.a).toBe('One');
    expect(Object.values(table)).toEqual(['One', 'Two']);
    expect(list.length).toBe(2);
    expect([...list]).toEqual(['One', 'Two']);
    expect(Object.keys(list)).toEqual(['0', '1']);
    expect(JSON.stringify(table)).toBe('{"a":"One","b":"Two"}');
  });

  it('datas e números no idioma atual', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtNumber(1234567)).toBe('1.234.567');
    expect(fmtDate('2026-11-13T12:00:00Z')).toBe('13/11/2026');
    setLocale('en');
    expect(fmtNumber(1234567)).toBe('1,234,567');
    expect(fmtDate('2026-11-13T12:00:00Z')).toBe('11/13/2026');
    expect(fmtDateTime('2026-11-13T12:00:00Z')).toContain('2026');
  });

  // Todos os dicionarios de area: os dois idiomas preenchidos e com os mesmos {valores}.
  const modules = import.meta.glob<{ messages?: Pairs }>('./*.ts', { eager: true });
  const areas: [string, Pairs][] = [
    ['core', COMMON],
    ...Object.entries(modules).flatMap(([file, mod]) =>
      mod.messages ? [[file, mod.messages] as [string, Pairs]] : [],
    ),
  ];
  it.each(areas)('dicionário %s: os dois idiomas, mesmos {valores}', (_file, pairs) => {
    const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [key, [pt, en]] of Object.entries(pairs)) {
      expect(pt.trim(), key).not.toBe('');
      expect(en.trim(), key).not.toBe('');
      expect(vars(en), key).toBe(vars(pt));
      // Espaco no comeco ou no fim (texto colado a outro) tem de existir nos dois.
      expect(en.match(/^\s*/)![0] + '|' + en.match(/\s*$/)![0], key).toBe(
        pt.match(/^\s*/)![0] + '|' + pt.match(/\s*$/)![0],
      );
    }
  });
});
