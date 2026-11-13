import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

import { MESSAGES_EN } from '../../src/lib/messages-en';
import { localizeStatus, type StatusCheck } from '../../src/lib/status';
import { STATUS_EN } from '../../src/lib/status-en';
import { scanTexts } from './source-texts';

/**
 * Status do sistema em ingles (plano pos-revisao, item 1.4). Le o lib/status.ts e o
 * lib/backup-schedule.ts (a descricao do agendamento aparece no status) e reprova texto visivel
 * sem par em STATUS_EN: o que tem cara de portugues, o valor de `name`, `summary`, `label` e
 * `value`, e os das tabelas `*_ERRORS` (motivos de falha de conexao). E o contrario: par que o
 * codigo nao usa mais.
 */

const ROOT = join(__dirname, '..', '..');

/** Iguais nos dois idiomas (nomes proprios, siglas e valores tecnicos). */
const SAME = new Set([
  'API',
  'Node.js',
  'Bucket',
  'Template',
  'Backup',
  'Detect It Easy',
  'VMID {0}',
  '{0} UTC',
  'oletools {0}',
  'Ghidra {0}',
  ' (StartTLS)',
  'HTTP {0}',
]);

/** Textos do arquivo que aparecem fora do status (ex.: na Auditoria), e nao vao para STATUS_EN. */
const NOT_STATUS = new Set([
  'Backup agendado',
  'seg',
  'ter',
  'qua',
  'qui',
  'sex',
  'sáb',
  'dom',
  // Mensagem do log de alertas (plano pos-revisao, 5.2): so em portugues; o codigo e estavel.
  '{0} voltou ao normal',
]);

function visibleContext(node: ts.Node): boolean {
  for (let up = node.parent; up && !ts.isSourceFile(up); up = up.parent) {
    if (ts.isPropertyAssignment(up)) {
      if (/^(name|summary|label|value)$/.test(up.name.getText())) return true;
      const table = up.parent.parent;
      if (ts.isVariableDeclaration(table) && /_ERRORS$/.test(table.name.getText())) return true;
      return false;
    }
    if (ts.isCallExpression(up) || ts.isStatement(up)) return false;
  }
  return false;
}

const found = [
  ...scanTexts(
    join(ROOT, 'src/lib/status.ts'),
    (node, item) => item.portuguese || visibleContext(node),
    { nested: true },
  ).map((f) => ({ ...f, file: 'status.ts' })),
  // A descricao do agendamento (describe) entra no status; o resto do arquivo e outra coisa.
  // Ali, todo texto conta (ate os de duas letras, como "às"), menos as comparacoes ('monthly').
  ...scanTexts(
    join(ROOT, 'src/lib/backup-schedule.ts'),
    (node) => {
      if (ts.isBinaryExpression(node.parent)) return false;
      for (let up = node.parent; up; up = up.parent) {
        if (ts.isFunctionDeclaration(up)) return up.name?.text === 'describe';
      }
      return false;
    },
    { minLetters: 2 },
  ).map((f) => ({ ...f, file: 'backup-schedule.ts' })),
];
const known = new Set([...STATUS_EN, ...MESSAGES_EN].map(([pt]) => pt));

test('todo texto visível do status tem tradução em status-en.ts', () => {
  const missing = found.filter(
    (f) => !known.has(f.text) && !SAME.has(f.text) && !NOT_STATUS.has(f.text),
  );
  assert.deepEqual(
    missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`),
    [],
    'Texto do status sem par em src/lib/status-en.ts (ou, se for igual em inglês, em SAME).',
  );
});

test('status-en.ts não tem pares que o código não usa mais', () => {
  const used = new Set(found.map((f) => f.text));
  const unused = STATUS_EN.map(([pt]) => pt).filter((pt) => !used.has(pt));
  assert.deepEqual(unused, []);
});

test('status-en.ts: chaves únicas e o inglês só com trechos que o português tem', () => {
  const keys = STATUS_EN.map(([pt]) => pt);
  assert.equal(new Set(keys).size, keys.length);
  for (const [pt, en] of STATUS_EN) {
    const slots = new Set(pt.match(/\{\d+\}/g) ?? []);
    for (const slot of en.match(/\{\d+\}/g) ?? []) assert.ok(slots.has(slot), `${pt} -> ${en}`);
  }
});

test('o status em inglês: textos exatos, com trechos variáveis e um dentro do outro', () => {
  const check: StatusCheck = {
    id: 'backup',
    name: 'Backup',
    level: 'warn',
    summary: '3 amostras atrasadas',
    details: [
      { label: 'Agendamento', value: 'todo dia 1 às 03:30 (UTC); próximo: 2026-12-01 03:30 UTC' },
      { label: 'Varreduras em 24 h', value: '10 · 2 infectada(s) · 0 falha(s)' },
      { label: 'Capturas em 24 h', value: '4 · 1 falha(s)' },
      { label: 'Endereço', value: 'Proxmox inacessível: conexão recusada' },
    ],
  };
  const status = { overall: 'warn', checks: [check] };
  assert.equal(localizeStatus(status, 'pt-BR'), status, 'em português, o mesmo objeto');
  const [en] = localizeStatus(status, 'en').checks;
  assert.equal(en.name, 'Backup');
  assert.equal(en.summary, '3 overdue samples');
  assert.deepEqual(en.details, [
    { label: 'Schedule', value: 'day 1 of every month at 03:30 (UTC); next: 2026-12-01 03:30 UTC' },
    { label: 'Scans in 24 h', value: '10 · 2 infected · 0 failure(s)' },
    { label: 'Captures in 24 h', value: '4 · 1 failure(s)' },
    { label: 'Address', value: 'Proxmox unreachable: connection refused' },
  ]);
});
