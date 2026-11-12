// @vitest-environment jsdom
// Hooks pequenos que falam com a API: visoes da equipe, favoritos, "pegar a proxima" e a restricao
// do usuario comum. A API e simulada; o que se confere e o que cada um pede e como reage.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../api/client';
import { useOwnSamplesOnly } from '../auth/sampleAccess';
import { useFavorites } from './favorites';
import { useTeamViews } from './teamViews';
import { useTakeNext } from './useTakeNext';

vi.mock('../api/client', async (original) => {
  const real = await original<typeof import('../api/client')>();
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), put: vi.fn() },
  };
});

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/inbox']}>{children}</MemoryRouter>
  </QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('useOwnSamplesOnly', () => {
  it('enquanto não carrega vale o menu completo; depois, o que a API disser', async () => {
    get.mockResolvedValueOnce({ ownOnly: true });
    const { result } = renderHook(() => useOwnSamplesOnly(), { wrapper });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(get).toHaveBeenCalledWith('/me/sample-access');
  });

  it('API fora: continua no menu completo (quem garante a regra é a API)', async () => {
    get.mockRejectedValueOnce(new Error('fora do ar'));
    const { result } = renderHook(() => useOwnSamplesOnly(), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

describe('useTeamViews', () => {
  const view = { id: 'v1', label: 'Pendentes', url: '/history?status=PENDING', count: 3 };

  it('desligado (usuário comum), nem consulta', () => {
    const { result } = renderHook(() => useTeamViews(false), { wrapper });
    expect(result.current.views).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('lista as visões e, depois de cada ação, consulta de novo', async () => {
    get.mockResolvedValue({ views: [view] });
    const { result } = renderHook(() => useTeamViews(true), { wrapper });
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await act(() => result.current.share('Maliciosos', '/history?verdict=MALICIOUS'));
    expect(post).toHaveBeenCalledWith('/team-views', {
      label: 'Maliciosos',
      url: '/history?verdict=MALICIOUS',
    });
    await act(() => result.current.rename('v1', 'Fila'));
    expect(patch).toHaveBeenCalledWith('/team-views/v1', { label: 'Fila' });
    await act(() => result.current.remove('v1'));
    expect(del).toHaveBeenCalledWith('/team-views/v1');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
  });

  it('o erro da API sobe para a tela mostrar', async () => {
    get.mockResolvedValue({ views: [] });
    post.mockRejectedValueOnce(new Error('Já existe uma visão com esse endereço.'));
    const { result } = renderHook(() => useTeamViews(true), { wrapper });
    await expect(result.current.share('x', '/history')).rejects.toThrow('Já existe');
  });
});

describe('useFavorites', () => {
  it('lista os favoritos e salva uma visão', async () => {
    get.mockResolvedValue({ favorites: [{ id: 'f1', kind: 'VIEW', label: 'Minha', url: '/me' }] });
    const { result } = renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));
    await act(() => result.current.addView('Pendentes', '/history?status=PENDING'));
    expect(post).toHaveBeenCalledWith('/me/favorites', {
      kind: 'VIEW',
      label: 'Pendentes',
      url: '/history?status=PENDING',
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe('useTakeNext', () => {
  const useBoth = () => ({ next: useTakeNext(), location: useLocation() });

  it('pega a próxima da fila e abre a ficha', async () => {
    post.mockResolvedValueOnce({ entry: { id: 'e7', title: 'fatura.exe' } });
    const { result } = renderHook(useBoth, { wrapper });
    await act(() => result.current.next.take());
    expect(post).toHaveBeenCalledWith('/entries/next', {});
    expect(result.current.location.pathname).toBe('/entries/e7');
    expect(result.current.next.notice).toBeNull();
    expect(result.current.next.taking).toBe(false);
  });

  it('fila vazia (404) é aviso, não erro, e a pessoa fica onde está', async () => {
    post.mockRejectedValueOnce(new ApiError('Nenhuma amostra na fila.', 404, null));
    const { result } = renderHook(useBoth, { wrapper });
    await act(() => result.current.next.take());
    expect(result.current.next.notice).toEqual({ kind: 'info', text: 'Nenhuma amostra na fila.' });
    expect(result.current.location.pathname).toBe('/inbox');
  });

  it('outra falha é erro, e uma nova tentativa limpa o aviso', async () => {
    post.mockRejectedValueOnce(new ApiError('Erro interno do servidor.', 500, null));
    const { result } = renderHook(useBoth, { wrapper });
    await act(() => result.current.next.take());
    expect(result.current.next.notice?.kind).toBe('error');
    post.mockResolvedValueOnce({ entry: { id: 'e8', title: 'x' } });
    await act(() => result.current.next.take());
    expect(result.current.next.notice).toBeNull();
  });
});
