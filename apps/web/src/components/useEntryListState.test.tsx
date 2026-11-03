// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEntryListState } from './useEntryListState';

/** O que o roteador de memória mostra agora, e como navegar "por fora" do hook. */
let search = '';
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  search = useLocation().search;
  navigate = useNavigate();
  return null;
}

const mount = (initial = '') =>
  renderHook(() => useEntryListState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/history${initial}`]}>
        <Probe />
        {children}
      </MemoryRouter>
    ),
  });

/** Parâmetros atuais da URL como objeto, para comparar sem depender da ordem. */
const params = () => Object.fromEntries(new URLSearchParams(search));

beforeEach(() => {
  search = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useEntryListState: lendo a URL', () => {
  it('sem parâmetros: nada filtrado, ordenação padrão, primeira página', () => {
    const { result } = mount();
    expect(result.current.q).toBe('');
    expect(Object.values(result.current.filters).every((value) => value === '')).toBe(true);
    expect(result.current.sort).toEqual({ key: 'createdAt', dir: 'desc' });
    expect(result.current.offset).toBe(0);
  });

  it('lê busca, filtros, ordenação e página', () => {
    const { result } = mount('?q=trojan&status=PENDING&attack=T1059&sort=title&dir=asc&offset=40');
    expect(result.current.q).toBe('trojan');
    expect(result.current.draftQ).toBe('trojan');
    expect(result.current.filters.status).toBe('PENDING');
    expect(result.current.filters.attack).toBe('T1059');
    expect(result.current.sort).toEqual({ key: 'title', dir: 'asc' });
    expect(result.current.offset).toBe(40);
  });

  it('coluna de ordenação desconhecida cai no padrão; direção que não é asc vira desc', () => {
    expect(mount('?sort=hack&dir=asc').result.current.sort).toEqual({
      key: 'createdAt',
      dir: 'desc',
    });
    expect(mount('?sort=title&dir=qualquer').result.current.sort).toEqual({
      key: 'title',
      dir: 'desc',
    });
  });

  it('página negativa ou que não é número vira 0', () => {
    expect(mount('?offset=-5').result.current.offset).toBe(0);
    expect(mount('?offset=abc').result.current.offset).toBe(0);
  });
});

describe('useEntryListState: escrevendo na URL', () => {
  it('setFilter grava o parâmetro e volta à primeira página; valor vazio remove', () => {
    const { result } = mount('?offset=20');
    act(() => result.current.setFilter('status', 'PENDING'));
    expect(params()).toEqual({ status: 'PENDING' });
    act(() => result.current.setFilter('status', ''));
    expect(params()).toEqual({});
  });

  it('setSort: a ordenação padrão some da URL e qualquer outra aparece', () => {
    const { result } = mount();
    act(() => result.current.setSort({ key: 'title', dir: 'asc' }));
    expect(params()).toEqual({ sort: 'title', dir: 'asc' });
    act(() => result.current.setSort({ key: 'createdAt', dir: 'desc' }));
    expect(params()).toEqual({});
  });

  it('setOffset mantém os filtros e não volta à primeira página; zero remove o parâmetro', () => {
    const { result } = mount('?status=PENDING');
    act(() => result.current.setOffset(20));
    expect(params()).toEqual({ status: 'PENDING', offset: '20' });
    act(() => result.current.setOffset(0));
    expect(params()).toEqual({ status: 'PENDING' });
  });

  it('clear limpa a busca e todos os filtros (a ordenação fica)', () => {
    const { result } = mount('?q=a&status=X&verdict=Y&attack=T1&sort=title&dir=asc&offset=5');
    act(() => result.current.clear());
    expect(params()).toEqual({ sort: 'title', dir: 'asc' });
    expect(result.current.draftQ).toBe('');
  });
});

describe('useEntryListState: campo de busca', () => {
  it('só vai para a URL depois da pausa de 300 ms', () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => result.current.setDraftQ('malware'));
    expect(params().q).toBeUndefined();
    act(() => vi.advanceTimersByTime(299));
    expect(params().q).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(params().q).toBe('malware');
  });

  it('cada tecla reinicia a pausa: só o último texto é gravado', () => {
    vi.useFakeTimers();
    const { result } = mount();
    act(() => result.current.setDraftQ('mal'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraftQ('malware'));
    act(() => vi.advanceTimersByTime(200));
    expect(params().q).toBeUndefined();
    act(() => vi.advanceTimersByTime(100));
    expect(params().q).toBe('malware');
  });

  it('texto só de espaços remove a busca', () => {
    vi.useFakeTimers();
    const { result } = mount('?q=antes');
    act(() => result.current.setDraftQ('   '));
    act(() => vi.advanceTimersByTime(300));
    expect(params().q).toBeUndefined();
  });

  it('a busca mudou por fora (voltar/avançar, link): o campo acompanha', () => {
    const { result } = mount('?q=antes');
    act(() => navigate('/history?q=externo'));
    expect(result.current.q).toBe('externo');
    expect(result.current.draftQ).toBe('externo');
  });
});
