// Pontuacao de risco (item 7.5): a nota e os motivos a partir dos sinais, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RISK_MALICIOUS,
  RISK_SUSPICIOUS,
  type RiskInputs,
  scoreRisk,
} from '../../src/lib/risk-score';
import type { Facts } from '../../src/lib/triage-rules';

const facts = (over: Partial<Facts> = {}): Facts => ({
  detectedType: null,
  urlDomain: null,
  sender: null,
  macro: false,
  disguised: false,
  scriptHigh: false,
  documentHigh: false,
  lnk: false,
  yara: [],
  antivirus: null,
  lookalikes: [],
  capaRules: [],
  attack: [],
  signatureInvalid: false,
  packer: null,
  peAlerts: [],
  hiddenIocs: [],
  die: [],
  officeAlerts: [],
  ...over,
});
const input = (over: Partial<Facts> = {}, rest: Partial<RiskInputs> = {}): RiskInputs => ({
  facts: facts(over),
  reputation: [],
  signedValid: false,
  scriptRisk: null,
  documentRisk: null,
  pending: [],
  ...rest,
});
const weightOf = (score: ReturnType<typeof scoreRisk>, source: string) =>
  score.reasons.filter((r) => r.source === source).reduce((sum, r) => sum + r.weight, 0);

test('sem nenhum sinal: nota 0, nível baixo e nenhuma sugestão (nunca "limpo")', () => {
  const risk = scoreRisk(input());
  assert.equal(risk.score, 0);
  assert.equal(risk.level, 'low');
  assert.equal(risk.suggestedVerdict, null);
  assert.deepEqual(risk.reasons, []);
});

test('antivírus sozinho já sugere suspeito; com YARA, malicioso', () => {
  const av = scoreRisk(input({ antivirus: 'Win.Trojan.Agent-1' }));
  assert.equal(av.score, 60);
  assert.equal(av.suggestedVerdict, 'SUSPICIOUS');
  assert.ok(av.reasons[0].text.includes('Win.Trojan.Agent-1'));
  const both = scoreRisk(input({ antivirus: 'Win.Trojan.Agent-1', yara: ['Emotet'] }));
  assert.equal(both.score, 95);
  assert.equal(both.level, 'high');
  assert.equal(both.suggestedVerdict, 'MALICIOUS');
});

test('YARA: cada conjunto a mais soma pouco, o repetido não conta e há teto', () => {
  assert.equal(weightOf(scoreRisk(input({ yara: ['A'] })), 'YARA'), 35);
  assert.equal(weightOf(scoreRisk(input({ yara: ['A', 'B'] })), 'YARA'), 40);
  assert.equal(weightOf(scoreRisk(input({ yara: ['A', 'A', 'A'] })), 'YARA'), 35);
  assert.equal(
    weightOf(scoreRisk(input({ yara: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] })), 'YARA'),
    50,
  );
});

test('reputação: vale o pior veredito, uma vez; "limpo" atenua, mas só sem nada pior', () => {
  const rep = (verdict: string, service = 'virustotal') =>
    ({ service, verdict, summary: '' }) as never;
  assert.equal(
    scoreRisk(input({}, { reputation: [rep('MALICIOUS'), rep('MALICIOUS', 'malwarebazaar')] }))
      .score,
    60,
  );
  assert.equal(
    scoreRisk(input({}, { reputation: [rep('SUSPICIOUS'), rep('CLEAN', 'urlhaus')] })).score,
    25,
  );
  const clean = scoreRisk(input({ yara: ['A'] }, { reputation: [rep('CLEAN')] }));
  assert.equal(clean.score, 25);
  assert.equal(clean.reasons.at(-1)?.weight, -10, 'o atenuante vai por último');
  assert.ok(
    scoreRisk(input({}, { reputation: [rep('MALICIOUS')] })).reasons[0].text.includes('VirusTotal'),
  );
});

test('a nota não sai de 0 a 100', () => {
  assert.equal(
    scoreRisk(input({}, { signedValid: true })).score,
    0,
    'só atenuante não fica negativa',
  );
  const all = scoreRisk(
    input(
      {
        antivirus: 'x',
        yara: ['A', 'B'],
        disguised: true,
        lookalikes: ['empresa.com'],
        signatureInvalid: true,
      },
      { scriptRisk: 'high', documentRisk: 'high' },
    ),
  );
  assert.equal(all.score, 100);
});

test('executável: alertas com teto por nível, assinatura e empacotamento', () => {
  const high = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ level: 'high', text: `alerta ${i}` }));
  assert.equal(scoreRisk(input({ peAlerts: high(1) })).score, 12);
  assert.equal(scoreRisk(input({ peAlerts: high(9) })).score, 30);
  assert.equal(
    scoreRisk(
      input({
        peAlerts: [
          { level: 'medium', text: 'm' },
          { level: 'info', text: 'i' },
        ],
      }),
    ).score,
    4,
  );
  assert.equal(scoreRisk(input({ signatureInvalid: true })).score, 20);
  assert.equal(
    scoreRisk(input({ signatureInvalid: true }, { signedValid: true })).score,
    20,
    'a que não confere vence',
  );
  assert.equal(scoreRisk(input({ packer: 'UPX' })).score, 10);
  assert.equal(
    scoreRisk(input({ die: [{ type: 'Protector', string: 'Protector: Themida' }] })).score,
    10,
  );
  assert.equal(
    scoreRisk(input({ die: [{ type: 'Compiler', string: 'Compiler: MSVC' }] })).score,
    0,
  );
  assert.equal(
    scoreRisk(input({ packer: 'UPX', die: [{ type: 'Packer', string: 'Packer: UPX' }] })).score,
    10,
    'uma vez só',
  );
});

test('capa: conta os grupos de risco, não as regras, e ignora o que todo executável faz', () => {
  const rule = (namespace: string) => ({ name: namespace, namespace });
  const risky = scoreRisk(
    input({
      capaRules: [
        rule('communication/http/client'),
        rule('communication/dns'),
        rule('persistence/registry/run'),
        rule('load-code/pe'),
        rule('host-interaction/file-system/read'),
      ],
    }),
  );
  assert.equal(risky.score, 12, 'dois grupos: communication e persistence');
  assert.ok(
    risky.reasons[0].text.includes('communication') &&
      risky.reasons[0].text.includes('persistence'),
  );
  assert.equal(scoreRisk(input({ capaRules: [rule('load-code/pe')] })).score, 0);
  assert.equal(scoreRisk(input({ hiddenIocs: ['evil.top'] })).score, 10);
});

test('documento e script: o risco alto vale mais que a macro, e não somam duas vezes', () => {
  assert.equal(scoreRisk(input({ macro: true })).score, 15);
  assert.equal(scoreRisk(input({ macro: true }, { documentRisk: 'high' })).score, 35);
  assert.equal(scoreRisk(input({}, { documentRisk: 'medium' })).score, 10);
  assert.equal(scoreRisk(input({}, { scriptRisk: 'high' })).score, 35);
  assert.equal(scoreRisk(input({}, { scriptRisk: 'medium' })).score, 15);
  assert.equal(scoreRisk(input({}, { scriptRisk: 'low' })).score, 0);
  assert.equal(scoreRisk(input({ lnk: true })).score, 25);
  assert.equal(scoreRisk(input({ disguised: true })).score, 30);
  assert.equal(scoreRisk(input({ lookalikes: ['empresa.com', 'empresa.com'] })).score, 35);
});

test('limiares, ordem dos motivos e análises pendentes', () => {
  assert.equal(
    scoreRisk(input({ yara: ['A'] })).suggestedVerdict,
    'SUSPICIOUS',
    `35 = ${RISK_SUSPICIOUS}`,
  );
  assert.equal(scoreRisk(input({ disguised: true })).suggestedVerdict, null, '30 fica abaixo');
  assert.equal(
    scoreRisk(input({ yara: ['A'] }, { scriptRisk: 'high' })).suggestedVerdict,
    'MALICIOUS',
    `70 = ${RISK_MALICIOUS}`,
  );
  const ordered = scoreRisk(
    input({ packer: 'UPX', antivirus: 'x', lnk: true }, { signedValid: true }),
  );
  assert.deepEqual(
    ordered.reasons.map((r) => r.weight),
    [60, 25, 10, -15],
  );
  assert.deepEqual(scoreRisk(input({}, { pending: ['antivírus'] })).pending, ['antivírus']);
});

test('oletools: alertas altos somam com teto, os demais não', () => {
  const high = (text: string) => ({ level: 'high', text });
  const one = scoreRisk(
    input({
      officeAlerts: [
        high('Macro suspeita pelo MacroRaptor: executa ao abrir.'),
        { level: 'medium', text: 'x' },
      ],
    }),
  );
  assert.equal(one.score, 15);
  assert.equal(one.reasons[0].text, 'Macro suspeita pelo MacroRaptor', 'só o começo do alerta');
  assert.equal(scoreRisk(input({ officeAlerts: [high('a'), high('b'), high('c')] })).score, 30);
});

test('a soma dos pesos mostrados é a nota (até os tetos de 0 e 100)', () => {
  const risk = scoreRisk(
    input(
      { yara: ['A'], packer: 'UPX', peAlerts: [{ level: 'high', text: 'x' }] },
      { signedValid: true },
    ),
  );
  assert.equal(
    risk.score,
    risk.reasons.reduce((sum, r) => sum + r.weight, 0),
  );
});

test('em inglês (plano pós-revisão, item 1.4): mesma nota, motivos e listas no idioma do pedido', () => {
  const signals = input(
    {
      antivirus: 'Win.Trojan.Agent-1',
      yara: ['A', 'B', 'C', 'D', 'E'],
      macro: true,
      signatureInvalid: true,
    },
    { reputation: [{ service: 'virustotal', verdict: 'MALICIOUS', summary: '' }] },
  );
  const pt = scoreRisk(signals);
  const en = scoreRisk(signals, 'en');
  assert.equal(en.score, pt.score);
  assert.deepEqual(
    en.reasons.map((r) => r.weight),
    pt.reasons.map((r) => r.weight),
  );
  const text = (risk: typeof en, source: string) =>
    risk.reasons.find((r) => r.source === source)?.text;
  assert.equal(text(en, 'Antivirus'), 'ClamAV detected Win.Trojan.Agent-1');
  assert.equal(text(en, 'YARA'), '5 rule set(s) matched: A, B, C and 2 more');
  assert.equal(text(pt, 'YARA'), '5 conjunto(s) de regras casaram: A, B, C e mais 2');
  assert.equal(text(en, 'Document'), 'contains VBA macros');
  assert.equal(text(en, 'Signature'), 'digital signature that does not match');
  assert.ok(text(en, 'External reputation')?.startsWith('malicious on '));
});
