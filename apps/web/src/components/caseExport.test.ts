import { describe, expect, it } from 'vitest';

import type { AttackData } from '../api/types';
import { caseMarkdown } from './caseExport';
import type { CaseDetail, CaseIoc } from './cases';

const report = {
  id: 'r1',
  verdict: 'MALICIOUS',
  updatedAt: '2026-11-10T12:00:00.000Z',
  analyst: { id: 'u2', displayName: 'Bia' },
  attackTechniques: ['T1059', 'T1566'],
  summary: 'baixa um segundo estágio',
  findings: '',
  iocs: 'hxxp://exemplo[.]top/a',
  evidence: [
    { id: 'ev1', caption: 'tela do instalador', width: 800, height: 600 },
    { id: 'ev2', caption: null, width: 10, height: 20 },
  ],
};

const base = {
  id: 'c1',
  code: 'CASO-0007',
  title: 'Campanha da fatura',
  status: 'OPEN',
  description: 'três envios | mesmo remetente',
  createdAt: '2026-11-09T12:00:00.000Z',
  closedAt: null,
  assignee: { id: 'u2', displayName: 'Bia' },
  createdBy: { id: 'u1', displayName: 'Ana' },
  entries: [
    {
      entry: {
        id: 'e1',
        type: 'FILE',
        title: 'fatura|final.exe',
        status: 'COMPLETED',
        priority: 'P2',
        verdict: 'MALICIOUS',
        sha256: 'ab'.repeat(32),
        url: null,
        reports: [report],
      },
    },
    {
      entry: {
        id: 'e2',
        type: 'URL',
        title: 'link do e-mail',
        status: 'PENDING',
        priority: 'P3',
        verdict: 'UNKNOWN',
        sha256: null,
        url: 'http://exemplo.top/a',
        reports: [],
      },
    },
  ],
  events: [
    {
      id: 'x1',
      type: 'CREATED',
      detail: null,
      fromValue: null,
      toValue: null,
      createdAt: '2026-11-09T12:00:00.000Z',
      actor: { id: 'u1', displayName: 'Ana' },
      entry: null,
    },
    {
      id: 'x2',
      type: 'COMMENT',
      detail: 'primeira linha\nsegunda linha',
      fromValue: null,
      toValue: null,
      createdAt: '2026-11-09T13:00:00.000Z',
      actor: null,
      entry: null,
    },
  ],
} as unknown as CaseDetail;

const iocs = [
  {
    kind: 'DOMAIN',
    value: 'exemplo.top',
    source: 'REPORT',
    entries: [{ id: 'e1', title: 'fatura|final.exe' }],
  },
  {
    kind: 'IPV4',
    value: '203.0.113.9',
    source: 'ENTRY',
    entries: [{ id: 'e2', title: 'link do e-mail' }],
  },
] as unknown as CaseIoc[];

const attack = {
  techniques: [{ id: 'T1059', name: 'Command and Scripting Interpreter' }],
} as unknown as AttackData;
const names = new Map([['u2', 'Bia']]);

describe('caseMarkdown', () => {
  const md = caseMarkdown(base, iocs, attack, names, 'Carla');

  it('cabeçalho e dados do caso', () => {
    expect(md.startsWith('# CASO-0007 · Campanha da fatura\n')).toBe(true);
    expect(md).toContain('Exportado do DeepLook por Carla em ');
    expect(md).toContain('| Status | Aberto |');
    expect(md).toContain('| Responsável | Bia |');
    expect(md).not.toContain('| Encerrado em |');
    expect(md).toContain('três envios | mesmo remetente');
  });

  it('amostras: arquivo com o hash, link com a URL, e a barra do título escapada', () => {
    expect(md).toContain('## Amostras (2)');
    expect(md).toContain(`| fatura\\|final.exe | Arquivo |`);
    expect(md).toContain(`| ${'ab'.repeat(32)} |`);
    expect(md).toContain('| link do e-mail | Link |');
    expect(md).toContain('| http://exemplo.top/a |');
  });

  it('relatórios publicados com ATT&CK, blocos preenchidos e evidências', () => {
    expect(md).toContain('## Relatórios publicados (1)');
    expect(md).toContain('ATT&CK: T1059, T1566');
    expect(md).toContain('**Resumo**');
    expect(md).not.toContain('**Achados**');
    expect(md).toContain('- tela do instalador (800×600)');
    expect(md).toContain('- Evidência 2 (10×20)');
  });

  it('indicadores com a origem, e técnicas com o nome quando o catálogo o tem', () => {
    expect(md).toContain('## Indicadores (2)');
    expect(md).toContain('| exemplo.top | Relatório publicado | fatura\\|final.exe |');
    expect(md).toContain('| 203.0.113.9 | Própria amostra | link do e-mail |');
    expect(md).toContain('## Técnicas ATT&CK (2)');
    expect(md).toContain('| T1059 | Command and Scripting Interpreter |');
    expect(md).toContain('| T1566 | — |');
  });

  it('linha do tempo: comentário numa linha só, e "Alguém" quando o autor não existe mais', () => {
    expect(md).toContain('## Linha do tempo (2)');
    expect(md).toContain('**Ana** criou o caso');
    expect(md).toContain('**Alguém** comentou: primeira linha segunda linha');
  });

  it('caso vazio e encerrado: diz que não há nada em vez de tabela vazia', () => {
    const empty = caseMarkdown(
      {
        ...base,
        status: 'CLOSED',
        closedAt: '2026-11-11T12:00:00.000Z',
        description: '',
        entries: [],
        events: [],
      } as unknown as CaseDetail,
      [],
      undefined,
      names,
      'Carla',
    );
    expect(empty).toContain('| Status | Encerrado |');
    expect(empty).toContain('| Encerrado em | ');
    expect(empty).toContain('Nenhum indicador.');
    expect(empty).toContain('Nenhuma técnica nos relatórios publicados.');
    expect(empty).not.toContain('**Descrição**');
  });
});
