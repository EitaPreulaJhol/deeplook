// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Entry } from '../api/types';
import { block, cell, downloadText, downloadUrl, entryReportsMarkdown } from './entryExport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('cell (célula de tabela Markdown)', () => {
  it('escapa a barra, que fecharia a célula, e tira as quebras de linha', () => {
    expect(cell('a|b')).toBe('a\\|b');
    expect(cell('linha 1\r\nlinha 2\nlinha 3')).toBe('linha 1 linha 2 linha 3');
  });

  it('vazio vira travessão', () => {
    expect(cell(null)).toBe('—');
    expect(cell(undefined)).toBe('—');
  });
});

describe('block (texto livre)', () => {
  it('vai numa cerca de código, que preserva quebras e indicadores', () => {
    expect(block('Resumo', '  texto\nhxxp://x[.]top  ')).toEqual([
      '**Resumo**',
      '',
      '```',
      'texto\nhxxp://x[.]top',
      '```',
      '',
    ]);
  });

  it('sem texto, não deixa o título solto', () => {
    expect(block('Resumo', '')).toEqual([]);
    expect(block('Resumo', '   \n ')).toEqual([]);
    expect(block('Resumo', null)).toEqual([]);
  });
});

const report = (status: string, summary: string) => ({
  id: `r-${summary}`,
  status,
  verdict: 'MALICIOUS',
  summary,
  findings: 'baixa um segundo estágio',
  iocs: 'hxxp://exemplo[.]top/a',
  createdAt: '2026-11-10T12:00:00.000Z',
  analyst: { id: 'u2', displayName: 'Bia' },
});

const fileEntry = {
  id: 'e1',
  type: 'FILE',
  title: 'Fatura | urgente',
  status: 'COMPLETED',
  verdict: 'MALICIOUS',
  createdAt: '2026-11-09T12:00:00.000Z',
  owner: { id: 'u1', displayName: 'Ana' },
  originalFilename: 'fatura.exe',
  fileSize: 2048,
  sha256: 'ab'.repeat(32),
  url: null,
  tags: [
    { id: 't1', name: 'phishing' },
    { id: 't2', name: 'banco' },
  ],
  reports: [
    report('PUBLISHED', 'publicado'),
    report('DRAFT', 'rascunho'),
    report('IN_REVIEW', 'em revisão'),
  ],
} as unknown as Entry;

describe('entryReportsMarkdown', () => {
  it('traz os dados da amostra e só os relatórios publicados', () => {
    const md = entryReportsMarkdown(fileEntry, 'Carla');
    expect(md.startsWith('# Fatura | urgente\n')).toBe(true);
    expect(md).toContain('Exportado do DeepLook por Carla em ');
    expect(md).toContain('| Arquivo | fatura.exe (');
    expect(md).toContain(`| SHA-256 | ${'ab'.repeat(32)} |`);
    expect(md).toContain('| Tags | phishing, banco |');
    expect(md).toContain('## Relatórios publicados (1)');
    expect(md).toContain('publicado');
    expect(md).not.toContain('rascunho');
    expect(md).not.toContain('em revisão');
    expect(md).not.toContain('| URL |');
  });

  it('link: mostra a URL no lugar do arquivo, e sem tags não cria a linha', () => {
    const link = {
      ...fileEntry,
      type: 'URL',
      url: 'http://exemplo.top/a|b',
      tags: [],
      reports: [],
    } as unknown as Entry;
    const md = entryReportsMarkdown(link, 'Carla');
    expect(md).toContain('| Tipo | Link |');
    expect(md).toContain('| URL | http://exemplo.top/a\\|b |');
    expect(md).not.toContain('| SHA-256 |');
    expect(md).not.toContain('| Tags |');
    expect(md).toContain('## Relatórios publicados (0)');
  });
});

describe('downloads', () => {
  it('downloadUrl clica num link sem o atributo download e não deixa o link na página', () => {
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    downloadUrl('/api/entries/e1/download');
    expect(clicked).toEqual([{ href: '/api/entries/e1/download', download: '' }]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('downloadText baixa com o nome dado e libera o endereço temporário depois', () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => 'blob:teste');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(`${this.download}|${this.getAttribute('href')}`);
    });
    downloadText('caso.md', '# título');
    expect(clicked).toEqual(['caso.md|blob:teste']);
    expect(create.mock.calls[0][0].type).toBe('text/markdown;charset=utf-8');
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:teste');
    vi.unstubAllGlobals();
  });
});
