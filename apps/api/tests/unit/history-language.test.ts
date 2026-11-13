import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

import { AUDIT_LABELS } from '../../src/lib/audit-labels';
import { DATA_EN } from '../../src/lib/data-en';
import { HISTORY_EN } from '../../src/lib/history-en';
import {
  localizeAudit,
  localizeEntryEvents,
  localizeNotifications,
  translateDetail,
} from '../../src/lib/history-language';
import { MESSAGES_EN } from '../../src/lib/messages-en';
import { scanTexts, sourceFiles } from './source-texts';

/**
 * Historico, notificacoes e auditoria em ingles (plano pos-revisao, item 1.4, parte 3). Le o codigo
 * da API e reprova texto fixo sem par em HISTORY_EN (ou em DATA_EN/MESSAGES_EN, que o tradutor do
 * historico tambem usa): o `detail` e o `targetLabel` de eventos, notificacoes e auditoria, o motivo
 * de login recusado (`loginFailed`), os motivos do AD e o "por onde" da conferencia de integridade.
 */

const ROOT = join(__dirname, '..', '..');

/** Iguais nos dois idiomas, ou valores tecnicos que so aparecem dentro de outro texto. */
const SAME = new Set([
  'SHA-256 {0}',
  '{0} (commit {1})',
  '{0} · {1} h',
  'STATUS',
  'FEED',
  'expired',
]);

/**
 * Montados com variaveis, sem um texto inteiro no codigo: a vigilancia de indicadores
 * (ioc-watch.ts) junta o tipo, o valor e o lugar.
 */
const COMPOSED = new Set(['{0} num relatório publicado', '{0} numa amostra nova', 'Domínio {0}']);

/** Fixos, mas genericos demais para o dicionario: casariam com o que as pessoas escrevem. */
const UNTRANSLATED = new Set(['de {0}']);

/** O no esta dentro de `outer`? */
const inside = (node: ts.Node, outer: ts.Node | undefined) =>
  outer !== undefined && node.pos >= outer.pos && node.end <= outer.end;

function accepted(node: ts.Node, file: string): boolean {
  // Comparacao (=== 'missing') e argumento de metodo (.includes('{login}')) nao sao texto exibido.
  const parent = node.parent;
  const comparisons = [
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
  ];
  if (ts.isBinaryExpression(parent) && comparisons.includes(parent.operatorToken.kind)) {
    return false;
  }
  if (ts.isCallExpression(parent) && parent.expression.getText() !== 'loginFailed') return false;
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent) {
    if (ts.isPropertyAssignment(up)) {
      const name = up.name.getText();
      if (name === 'detail' || name === 'targetLabel') return true;
      if (
        (name === 'reason' && /ldap\.ts$/.test(file)) ||
        (name === 'refused' && /auth\.ts$/.test(file))
      ) {
        return true;
      }
      // O "por onde" da integridade (VIA): o valor de uma tabela no topo do arquivo.
      const table = up.parent.parent;
      return ts.isVariableDeclaration(table) && table.name.getText() === 'VIA';
    }
    // `const detail = ...` (integridade, atualizacao do YARA).
    if (ts.isVariableDeclaration(up)) return up.name.getText() === 'detail';
    // loginFailed(req, email, userId, motivo): o motivo vai para a auditoria.
    if (ts.isCallExpression(up) && up.expression.getText() === 'loginFailed') {
      return inside(node, up.arguments[3]);
    }
    // Problemas de configuracao do AD: viram o motivo de um login recusado.
    if (ts.isFunctionDeclaration(up)) {
      return /ldap\.ts$/.test(file) && up.name?.text === 'ldapConfigProblem';
    }
    if (
      ts.isStatement(up) &&
      !ts.isReturnStatement(up) &&
      !ts.isIfStatement(up) &&
      !ts.isBlock(up)
    ) {
      return false;
    }
  }
  return false;
}

const found = sourceFiles(join(ROOT, 'src')).flatMap((path) => {
  const file = relative(ROOT, path).split('\\').join('/');
  return scanTexts(path, (node) => accepted(node, file), { nested: true, minLetters: 2 }).map(
    (f) => ({ ...f, file }),
  );
});
const known = new Set([...HISTORY_EN, ...DATA_EN, ...MESSAGES_EN].map(([pt]) => pt));

test('todo detalhe fixo do histórico, das notificações e da auditoria tem tradução', () => {
  const covered = (text: string) => known.has(text) || SAME.has(text) || UNTRANSLATED.has(text);
  // Montado com " · ": vale se cada trecho tiver par (o tradutor traduz trecho a trecho).
  const missing = found.filter(
    (f) => !covered(f.text) && !(f.text.includes(' · ') && f.text.split(' · ').every(covered)),
  );
  assert.deepEqual(
    missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`),
    [],
    'Detalhe sem par em src/lib/history-en.ts (ou, se for igual em inglês, em SAME).',
  );
});

test('history-en.ts não tem pares que o código não usa mais', () => {
  const used = new Set(found.flatMap((f) => [f.text, ...f.text.split(' · ')]));
  assert.deepEqual(
    HISTORY_EN.map(([pt]) => pt).filter((pt) => !used.has(pt) && !COMPOSED.has(pt)),
    [],
  );
});

test('history-en.ts: chaves únicas e o inglês só com trechos que o português tem', () => {
  const keys = HISTORY_EN.map(([pt]) => pt);
  assert.equal(new Set(keys).size, keys.length);
  for (const [pt, en] of HISTORY_EN) {
    const slots = new Set(pt.match(/\{\d+\}/g) ?? []);
    for (const slot of en.match(/\{\d+\}/g) ?? []) assert.ok(slots.has(slot), `${pt} -> ${en}`);
  }
});

test('nomes das ações da auditoria: os mesmos do web, nos dois idiomas', () => {
  const web = readFileSync(join(ROOT, '..', 'web', 'src', 'i18n', 'admin.ts'), 'utf8');
  const pairs = new Map(
    [
      ...web.matchAll(
        /'act\.([A-Z_0-9]+)': \[\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)',?\s*\]/g,
      ),
    ].map((m) => [m[1], [m[2].replace(/\\'/g, "'"), m[3].replace(/\\'/g, "'")]]),
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(AUDIT_LABELS).map(([k, v]) => [k, [...v]])),
    Object.fromEntries(pairs),
  );
});

test('detalhe em inglês: inteiro, trecho a trecho e o texto das pessoas intacto', () => {
  assert.equal(
    translateDetail('agendado · com os arquivos das amostras · com senha'),
    'scheduled · with the sample files · with a password',
  );
  assert.equal(
    translateDetail('na verificação periódica: o objeto não está no armazenamento'),
    'in the periodic check: the object is not in storage',
  );
  assert.equal(
    translateDetail('Domínio evil.top num relatório publicado'),
    'Domain evil.top in a published report',
  );
  assert.equal(translateDetail('texto qualquer · outro'), 'texto qualquer · outro');

  const events = [
    { type: 'FILE_PURGED' as const, detail: 'retenção de 90 dias após a conclusão' },
    { type: 'COMMENT' as const, detail: 'principal' },
  ];
  assert.equal(localizeEntryEvents(events, 'pt-BR'), events);
  assert.deepEqual(
    localizeEntryEvents(events, 'en').map((e) => e.detail),
    ['retention of 90 days after completion', 'principal'],
  );
  const notes = [
    { type: 'IOC_SEEN' as const, detail: 'Domínio evil.top numa amostra nova' },
    { type: 'MENTION' as const, detail: 'sem senha' },
  ];
  assert.deepEqual(
    localizeNotifications(notes, 'en').map((n) => n.detail),
    ['Domain evil.top in a new sample', 'sem senha'],
  );
  assert.deepEqual(
    localizeAudit([{ detail: 'senha incorreta', targetLabel: 'Backup agendado' }], 'en'),
    [{ detail: 'wrong password', targetLabel: 'Scheduled backup' }],
  );
});
