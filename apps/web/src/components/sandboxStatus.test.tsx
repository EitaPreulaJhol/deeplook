// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxStatus } from '../api/types';
import {
  isSandboxActive,
  isSandboxWorking,
  SANDBOX_STATUS_LABELS,
  useMinutesLeft,
  useSandboxCountdown,
} from './sandboxStatus';

const ALL = Object.keys(SANDBOX_STATUS_LABELS) as SandboxStatus[];
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('estados do ambiente isolado', () => {
  it('em andamento: só o que ainda vai mudar sozinho (as telas consultam de novo)', () => {
    expect(ALL.filter(isSandboxWorking)).toEqual(['REQUESTED', 'PROVISIONING', 'STOPPING']);
    expect(isSandboxWorking(undefined)).toBe(false);
  });

  it('ativo: tudo o que não terminou', () => {
    expect(ALL.filter(isSandboxActive)).toEqual([
      'REQUESTED',
      'PROVISIONING',
      'RUNNING',
      'STOPPING',
    ]);
    expect(isSandboxActive(undefined)).toBe(false);
  });
});

describe('useSandboxCountdown', () => {
  it('mostra minutos e segundos, e passa a horas acima de 60 min', () => {
    const short = renderHook(() => useSandboxCountdown(at(125)));
    expect(short.result.current).toBe('2min 05s');
    const long = renderHook(() => useSandboxCountdown(at(3600 + 15 * 60 + 9)));
    expect(long.result.current).toBe('1h 15min');
  });

  it('anda a cada segundo e termina em "expirado"', () => {
    const { result } = renderHook(() => useSandboxCountdown(at(2)));
    expect(result.current).toBe('0min 02s');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('0min 01s');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('expirado');
  });

  it('sem prazo, vazio; e o prazo estendido recomeça a contagem', () => {
    const { result, rerender } = renderHook(({ until }) => useSandboxCountdown(until), {
      initialProps: { until: null as string | null },
    });
    expect(result.current).toBe('');
    rerender({ until: at(60) });
    expect(result.current).toBe('1min 00s');
    rerender({ until: at(600) });
    expect(result.current).toBe('10min 00s');
    rerender({ until: null });
    expect(result.current).toBe('');
  });

  it('para o relógio ao sair da tela', () => {
    const { unmount } = renderHook(() => useSandboxCountdown(at(600)));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useMinutesLeft', () => {
  it('arredonda para cima e atualiza a cada 15 s', () => {
    const { result } = renderHook(() => useMinutesLeft(at(61)));
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // Vencido, o valor e zero ou negativo; quem usa so mostra a contagem acima de zero.
    expect(result.current).toBeLessThanOrEqual(0);
  });

  it('sem prazo, null, e sem relógio ligado', () => {
    const { result } = renderHook(() => useMinutesLeft(null));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
