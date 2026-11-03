// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import { useMarkRead, useNotificationCount, useNotifications } from './notifications';

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

let client: QueryClient;

/** Cliente novo por teste, sem nova tentativa: um erro aparece na hora e nao em 3 rodadas. */
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('useNotificationCount', () => {
  it('começa em 0 e passa a mostrar as não lidas que a API devolve', async () => {
    get.mockResolvedValueOnce({ unread: 4 });
    const { result } = renderHook(() => useNotificationCount(), { wrapper });
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(4));
    expect(get).toHaveBeenCalledWith('/me/notifications/count');
  });

  it('desligado (sem sessão), nem consulta a API', async () => {
    const { result } = renderHook(() => useNotificationCount(false), { wrapper });
    await act(async () => {});
    expect(result.current).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useNotifications', () => {
  it('pede o limite, e só as não lidas quando for o caso', async () => {
    get.mockResolvedValue({ items: [], unread: 0 });
    renderHook(() => useNotifications(10), { wrapper });
    renderHook(() => useNotifications(5, true), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledWith('/me/notifications?limit=10');
    expect(get).toHaveBeenCalledWith('/me/notifications?limit=5&unread=1');
  });

  it('desligado, não consulta', async () => {
    renderHook(() => useNotifications(10, false, false), { wrapper });
    await act(async () => {});
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useMarkRead', () => {
  it('sem ids marca todas; com ids, só essas', async () => {
    post.mockResolvedValue({ unread: 0 });
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    await act(() => result.current());
    await act(() => result.current(['a', 'b']));
    expect(post.mock.calls).toEqual([
      ['/me/notifications/read', {}],
      ['/me/notifications/read', { ids: ['a', 'b'] }],
    ]);
  });

  it('atualiza o contador com a resposta e refaz as listas', async () => {
    post.mockResolvedValue({ unread: 2 });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    await act(() => result.current(['a']));
    expect(client.getQueryData(['notifications', 'count'])).toEqual({ unread: 2 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'list'] });
  });

  it('se a API falha, o erro sobe e o contador não muda', async () => {
    client.setQueryData(['notifications', 'count'], { unread: 7 });
    post.mockRejectedValueOnce(new Error('fora do ar'));
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    await expect(act(() => result.current())).rejects.toThrow('fora do ar');
    expect(client.getQueryData(['notifications', 'count'])).toEqual({ unread: 7 });
  });
});
