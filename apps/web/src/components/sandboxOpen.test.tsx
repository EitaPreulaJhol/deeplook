// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import {
  durationChoices,
  formatMinutes,
  openConsoleWindow,
  readAutoRun,
  saveAutoRun,
  useOpenSandbox,
} from './sandboxOpen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('janela do console', () => {
  it('abre a janela dedicada pelo nome da amostra', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    expect(openConsoleWindow('e1')).toBe(true);
    expect(open).toHaveBeenCalledWith(
      '/sandbox/entry/e1/console',
      'deeplook-console-e1',
      'popup=yes,width=1280,height=900',
    );
  });

  it('popup bloqueado: false', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openConsoleWindow('e1')).toBe(false);
  });
});

describe('execução automática lembrada', () => {
  it('lê o que foi salvo; sem nada, desligada', () => {
    expect(readAutoRun()).toBe(false);
    saveAutoRun(true);
    expect(readAutoRun()).toBe(true);
    saveAutoRun(false);
    expect(readAutoRun()).toBe(false);
  });

  it('sem armazenamento: não quebra e não lembra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => saveAutoRun(true)).not.toThrow();
    expect(readAutoRun()).toBe(false);
  });
});

describe('duração do ambiente', () => {
  it('opções até o teto, que sempre entra por último', () => {
    expect(durationChoices(60)).toEqual([15, 30, 60]);
    expect(durationChoices(90)).toEqual([15, 30, 60, 90]);
    expect(durationChoices(10)).toEqual([10]);
    expect(durationChoices(1440).slice(-2)).toEqual([720, 1440]);
  });

  it('em minutos ou horas', () => {
    expect(formatMinutes(15)).toBe('15 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
});

describe('useOpenSandbox', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );

  it('abre a janela, pede o ambiente com a escolha e avisa do popup bloqueado', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { result } = renderHook(() => useOpenSandbox('e1'), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.open({ autoRun: true, minutes: 30, capture: false });
    });
    expect(res).toEqual({ kind: 'ok' });
    expect(post).toHaveBeenCalledWith('/entries/e1/sandbox', {
      autoRun: true,
      minutes: 30,
      capture: false,
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => {
      res = await result.current.open({ autoRun: false });
    });
    expect(res).toMatchObject({ kind: 'warning' });
    expect(result.current.busy).toBe(false);
  });

  it('sem a janela (dentro do console) e com erro da API', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('Limite de ambientes.'));
    const open = vi.spyOn(window, 'open');
    saveAutoRun(true);
    const { result } = renderHook(() => useOpenSandbox('e1'), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.open(undefined, false);
    });
    expect(open).not.toHaveBeenCalled();
    // Sem opcoes: a execucao automatica lembrada; duracao e captura ficam com a API.
    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/entries/e1/sandbox', {
      autoRun: true,
      minutes: undefined,
      capture: undefined,
    });
    expect(res).toEqual({ kind: 'error', text: 'Limite de ambientes.' });
  });
});
