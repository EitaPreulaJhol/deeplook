import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api/client';
import type { SandboxRunSummary } from '../api/types';
import { intlLocale } from '../i18n';
import {
  latestRunSummary,
  runFacts,
  runNote,
  runSections,
  runSummaryMarkdown,
} from './sandboxSummary';

afterEach(() => vi.restoreAllMocks());

const time = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());

function summary(over: Partial<SandboxRunSummary> = {}): SandboxRunSummary {
  return {
    session: {
      id: 'sb1',
      status: 'STOPPED',
      createdAt: '2026-11-12T15:00:00.000Z',
      startedAt: '2026-11-12T15:01:00.000Z',
      stoppedAt: '2026-11-12T15:30:00.000Z',
      analyst: 'Ana Souza',
      autoRun: 'DONE',
      autoRunAt: '2026-11-12T15:02:00.000Z',
      autoRunUser: 'analista',
      autoRunSysmon: true,
    },
    sample: { name: 'fatura.exe', found: true, processes: 2 },
    sysmon: { available: true, reason: null, events: 214 },
    processes: [
      {
        time: '2026-11-12T15:02:01.000Z',
        image: 'C:\\Users\\analista\\Desktop\\fatura.exe',
        pid: 4410,
        ppid: 900,
        cmd: null,
      },
      {
        time: '2026-11-12T15:02:03.000Z',
        image: 'C:\\Windows\\System32\\cmd.exe',
        pid: 4512,
        ppid: 4410,
        cmd: 'cmd /c a|b',
      },
    ],
    dns: [
      { query: 'c2.evil.example', results: '203.0.113.7;' },
      { query: 'nada.example', results: null },
    ],
    network: [
      { destination: '203.0.113.7:443', protocol: 'tcp' },
      { destination: '198.51.100.9:53', protocol: null },
    ],
    files: ['C:\\Users\\Public\\stage2.dll'],
    registry: [
      { key: 'HKCU\\Run\\upd', action: 'SetValue', details: 'x.dll' },
      { key: 'HKCU\\Chave', action: null, details: null },
    ],
    appeared: [{ pid: 7, ppid: null, name: 'calc.exe', cmd: 'calc' }],
    screenshots: 3,
    ...over,
  };
}

describe('latestRunSummary', () => {
  it('pede o resumo da execução mais recente', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (path: string) =>
        path.endsWith('/sessions') ? { sessions: [{ id: 'sb2' }, { id: 'sb1' }] } : { ok: path },
      );
    expect(await latestRunSummary('e1')).toEqual({ ok: '/sandbox/sb2/summary' });
    expect(get).toHaveBeenCalledWith('/entries/e1/sandbox/sessions');
  });

  it('sem execução: null, sem segundo pedido', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ sessions: [] });
    expect(await latestRunSummary('e1')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('runFacts', () => {
  it('execução automática feita e o Sysmon com os eventos', () => {
    const facts = Object.fromEntries(runFacts(summary()));
    expect(facts['Aberto por']).toBe('Ana Souza');
    expect(facts['Execução automática']).toBe(
      `às ${time('2026-11-12T15:02:00.000Z')}, na sessão de analista`,
    );
    expect(facts.Sysmon).toBe('214 evento(s)');
    expect(facts['Prints da tela guardados']).toBe('3');
    expect(facts['Execução']).toContain('encerrado');
  });

  it('falhou, não pedida, Sysmon indisponível ou sem leitura', () => {
    const base = summary();
    const failed = Object.fromEntries(
      runFacts(
        summary({
          session: { ...base.session, autoRun: 'FAILED', analyst: null, startedAt: null },
          sysmon: { available: false, reason: 'não instalado', events: null },
        }),
      ),
    );
    expect(failed['Execução automática']).toBe('falhou');
    expect(failed.Sysmon).toBe('indisponível: não instalado');
    expect(failed['Aberto por']).toBe('—');
    const none = Object.fromEntries(
      runFacts(
        summary({
          session: { ...base.session, autoRun: null, autoRunAt: null, autoRunUser: null },
          sysmon: null,
        }),
      ),
    );
    expect(none['Execução automática']).toBe('não pedida');
    expect(none.Sysmon).toBe('sem leitura');
  });
});

describe('runSections', () => {
  it('com Sysmon: processos, DNS, conexões, arquivos e registro, sem a lista do agente', () => {
    const sections = runSections(summary());
    expect(sections.map((s) => s.title)).toEqual([
      'Processos da amostra e o que ela abriu',
      'Consultas DNS',
      'Conexões',
      'Arquivos criados',
      'Registro alterado',
    ]);
    expect(sections[0].items).toEqual([
      `${time('2026-11-12T15:02:01.000Z')} fatura.exe (PID 4410)`,
      `${time('2026-11-12T15:02:03.000Z')} cmd.exe (PID 4512) — cmd /c a|b`,
    ]);
    expect(sections[1].items).toEqual(['c2.evil.example → 203.0.113.7', 'nada.example']);
    expect(sections[2].items).toEqual(['tcp 203.0.113.7:443', '198.51.100.9:53']);
    expect(sections[4].items).toEqual(['SetValue HKCU\\Run\\upd = x.dll', 'HKCU\\Chave']);
  });

  it('sem Sysmon: o que o agente viu surgir; listas vazias saem', () => {
    const sections = runSections(
      summary({
        sysmon: null,
        processes: [],
        dns: [],
        network: [],
        files: [],
        registry: [],
        appeared: [
          { pid: 7, ppid: null, name: 'calc.exe', cmd: 'calc' },
          { pid: 8, ppid: 7, name: 'x.exe', cmd: null },
        ],
      }),
    );
    expect(sections).toEqual([
      {
        title: 'Processos que surgiram (lista do agente da VM)',
        items: ['calc.exe (PID 7) — calc', 'x.exe (PID 8)'],
      },
    ]);
  });

  it('processo sem imagem nem PID', () => {
    const [first] = runSections(
      summary({
        processes: [
          { time: '2026-11-12T15:02:01.000Z', image: null, pid: null, ppid: null, cmd: null },
        ],
      }),
    );
    expect(first.items[0]).toBe(`${time('2026-11-12T15:02:01.000Z')} ? (PID ?)`);
  });
});

describe('runNote e runSummaryMarkdown', () => {
  it('aviso só quando o Sysmon leu e a amostra não aparece', () => {
    expect(runNote(summary())).toBeNull();
    expect(
      runNote(summary({ sysmon: null, sample: { name: 'a.exe', found: false, processes: 0 } })),
    ).toBeNull();
    expect(runNote(summary({ sample: { name: 'a.exe', found: false, processes: 0 } }))).toContain(
      'A amostra (a.exe) não aparece no Sysmon',
    );
  });

  it('tabela com "|" escapado, o aviso e as listas em bloco de código', () => {
    const md = runSummaryMarkdown(
      summary({
        session: { ...summary().session, analyst: 'Ana | Souza' },
        sample: { name: 'a.exe', found: false, processes: 0 },
      }),
    ).join('\n');
    expect(md.startsWith('## Ambiente isolado: última execução\n\n| | |\n|---|---|')).toBe(true);
    expect(md).toContain('| Aberto por | Ana \\| Souza |');
    expect(md).toContain('A amostra (a.exe) não aparece no Sysmon');
    expect(md).toContain(
      '**Consultas DNS**\n\n```\nc2.evil.example → 203.0.113.7\nnada.example\n```',
    );
  });
});
