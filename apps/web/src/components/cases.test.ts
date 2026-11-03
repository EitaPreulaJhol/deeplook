import { describe, expect, it } from 'vitest';

import { CASE_STATUS, type CaseDetail, caseEventText, caseHref, caseTechniques } from './cases';

type Event = CaseDetail['events'][number];

/** Evento mínimo válido; cada teste sobrescreve só o que importa. */
const event = (partial: Partial<Event> & Pick<Event, 'type'>): Event => ({
  id: 'ev1',
  detail: null,
  fromValue: null,
  toValue: null,
  createdAt: '2024-01-01T00:00:00Z',
  actor: null,
  entry: null,
  ...partial,
});

const names = new Map([['u1', 'Bruno Lima']]);

describe('caseEventText', () => {
  it('criação e comentário', () => {
    expect(caseEventText(event({ type: 'CREATED' }), names)).toBe('criou o caso');
    expect(caseEventText(event({ type: 'COMMENT' }), names)).toBe('comentou');
  });

  it('inclusão e retirada citam a amostra, ou "(removida)" se ela já não existe', () => {
    const entry = { id: 'e1', title: 'fatura.ps1' };
    expect(caseEventText(event({ type: 'ENTRY_ADDED', entry }), names)).toBe(
      'incluiu a amostra fatura.ps1',
    );
    expect(caseEventText(event({ type: 'ENTRY_REMOVED', entry }), names)).toBe(
      'retirou a amostra fatura.ps1',
    );
    expect(caseEventText(event({ type: 'ENTRY_ADDED' }), names)).toBe(
      'incluiu a amostra (removida)',
    );
  });

  it('mudança de status usa os rótulos, e o valor cru se for desconhecido', () => {
    expect(
      caseEventText(event({ type: 'STATUS_CHANGED', fromValue: 'OPEN', toValue: 'CLOSED' }), names),
    ).toBe('mudou o status: Aberto → Encerrado');
    expect(
      caseEventText(
        event({ type: 'STATUS_CHANGED', fromValue: 'OPEN', toValue: 'ARQUIVADO' }),
        names,
      ),
    ).toBe('mudou o status: Aberto → ARQUIVADO');
  });

  it('atribuição: nome conhecido, analista desconhecido ou caso sem responsável', () => {
    expect(caseEventText(event({ type: 'ASSIGNED', toValue: 'u1' }), names)).toBe(
      'atribuiu a Bruno Lima',
    );
    expect(caseEventText(event({ type: 'ASSIGNED', toValue: 'u9' }), names)).toBe(
      'atribuiu a outro analista',
    );
    expect(caseEventText(event({ type: 'ASSIGNED', toValue: null }), names)).toBe(
      'deixou o caso sem responsável',
    );
  });

  it('atualização: renomear (com o novo título) ou alterar a descrição', () => {
    expect(caseEventText(event({ type: 'UPDATED', detail: 'Campanha X' }), names)).toBe(
      'renomeou para "Campanha X"',
    );
    expect(caseEventText(event({ type: 'UPDATED' }), names)).toBe('alterou a descrição');
  });
});

describe('caseHref e CASE_STATUS', () => {
  it('o endereço do caso e os três status', () => {
    expect(caseHref('abc')).toBe('/casos/abc');
    expect(Object.keys(CASE_STATUS)).toEqual(['OPEN', 'IN_PROGRESS', 'CLOSED']);
    expect(CASE_STATUS.IN_PROGRESS.label).toBe('Em andamento');
  });
});

describe('caseTechniques', () => {
  /** Caso só com o que a função lê: amostras, seus relatórios e as técnicas. */
  const caseWith = (entries: { title: string; reports: string[][] }[]) =>
    ({
      entries: entries.map(({ title, reports }) => ({
        entry: {
          title,
          reports: reports.map((attackTechniques) => ({ attackTechniques })),
        },
      })),
    }) as unknown as CaseDetail;

  it('junta as técnicas sem repetir e ordena pelo código', () => {
    const found = caseTechniques(
      caseWith([
        { title: 'A', reports: [['T1566.001', 'T1059']] },
        { title: 'B', reports: [['T1059']] },
      ]),
    );
    expect(found).toEqual([
      { id: 'T1059', entries: ['A', 'B'] },
      { id: 'T1566.001', entries: ['A'] },
    ]);
  });

  it('a mesma amostra não se repete na lista de uma técnica', () => {
    const found = caseTechniques(caseWith([{ title: 'A', reports: [['T1059'], ['T1059']] }]));
    expect(found).toEqual([{ id: 'T1059', entries: ['A'] }]);
  });

  it('sem relatórios publicados, não há técnica', () => {
    expect(caseTechniques(caseWith([{ title: 'A', reports: [] }]))).toEqual([]);
    expect(caseTechniques(caseWith([]))).toEqual([]);
  });
});
