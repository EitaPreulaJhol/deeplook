// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { verdictLabel } from '../components/tags';
import { en } from './en';
import { getLocale, intlLocale, setLocale, t, useLocale } from './index';
import { ptBR } from './pt-BR';

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

  it('os dois dicionários têm as mesmas chaves, sem texto vazio', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort());
    for (const [key, text] of Object.entries(en)) expect(text.trim(), key).not.toBe('');
    // Os mesmos {valores} nos dois idiomas.
    for (const key of Object.keys(ptBR) as (keyof typeof ptBR)[]) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(vars(en[key]), key).toBe(vars(ptBR[key]));
    }
  });
});
