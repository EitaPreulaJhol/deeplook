import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SEARCH_MAX_FUNCTIONS,
  SEARCH_MAX_LINES,
  searchCode,
  type SearchFunction,
  searchPattern,
  searchPseudo,
  SNIPPET_MAX,
} from '../../src/lib/ghidra-search';

// Busca no pseudo-C completo (plans/ghidra-pseudo-c, fase 5).

/** Monta o objeto como lib/ghidra.ts: cabecalho, codigo e linha em branco por funcao. */
function blob(fns: { name: string; c: string; library?: boolean }[]) {
  const parts: Buffer[] = [];
  const index: SearchFunction[] = [];
  let offset = 0;
  fns.forEach((f, i) => {
    const head = Buffer.from(`/* ${f.name} @ 0x${i} */\n`);
    const code = Buffer.from(f.c);
    index.push({
      entry: `0x${i}`,
      name: f.name,
      library: f.library ?? false,
      cOffset: offset + head.length,
      cLength: code.length,
    });
    parts.push(head, code, Buffer.from('\n\n'));
    offset += head.length + code.length + 2;
  });
  return { data: Buffer.concat(parts), index };
}

/** O objeto em pedacos de `size` bytes, como o fluxo do MinIO. */
async function* chunks(data: Buffer, size: number) {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

const FAR = Date.now() + 60_000;

test('o texto e literal: caracteres de regex nao sao sintaxe', () => {
  const re = searchPattern('a.b(*)[x]-{1}|/\\', true);
  assert.equal(re.test('a.b(*)[x]-{1}|/\\'), true);
  re.lastIndex = 0;
  assert.equal(re.test('aXb(*)[x]-{1}|/\\'), false);
});

test('maiusculas: sem a opcao, iguala; com ela, diferencia', () => {
  const code = 'CreateRemoteThread(h);\ncreateremotethread();';
  assert.equal(searchCode(code, searchPattern('createremotethread', false)).lineCount, 2);
  assert.equal(searchCode(code, searchPattern('createremotethread', true)).lineCount, 1);
});

test('linhas a partir de 1, sem o recuo, com as ocorrencias marcadas', () => {
  const code = 'void f(void)\n{\n    x = foo(foo);\n  return;\n}\nfoo';
  const { lineCount, lines } = searchCode(code, searchPattern('foo', true));
  assert.equal(lineCount, 2);
  assert.deepEqual(lines[0], {
    line: 3,
    text: 'x = foo(foo);',
    marks: [
      [4, 7],
      [8, 11],
    ],
  });
  assert.deepEqual(lines[1], { line: 6, text: 'foo', marks: [[0, 3]] });
});

test('linha longa vira trecho em volta da ocorrencia, com reticencias', () => {
  const code = `${'a'.repeat(500)}ALVO${'b'.repeat(500)}`;
  const [line] = searchCode(code, searchPattern('ALVO', true)).lines;
  assert.ok(line!.text.startsWith('…') && line!.text.endsWith('…'));
  assert.ok(line!.text.length <= SNIPPET_MAX + 2);
  const [[s, e]] = line!.marks as [[number, number]];
  assert.equal(line!.text.slice(s, e), 'ALVO');
});

test('o trecho nao parte um emoji', () => {
  const code = `${'😀'.repeat(200)}ALVO${'😀'.repeat(200)}`;
  const [line] = searchCode(code, searchPattern('ALVO', true)).lines;
  // Sem surrogate solto: a volta pelo UTF-8 nao troca nada por U+FFFD.
  assert.equal(Buffer.from(line!.text).toString('utf8'), line!.text);
  assert.ok(!line!.text.includes('�'));
  const [[s, e]] = line!.marks as [[number, number]];
  assert.equal(line!.text.slice(s, e), 'ALVO');
});

test('acima do teto de linhas, so conta', () => {
  const code = Array.from({ length: 25 }, () => 'x = 1;').join('\n');
  const { lineCount, lines } = searchCode(code, searchPattern('x', true));
  assert.equal(lineCount, 25);
  assert.equal(lines.length, SEARCH_MAX_LINES);
});

test('fluxo: acha nas funcoes, ignora os cabecalhos e independe do tamanho dos pedacos', async () => {
  const { data, index } = blob([
    { name: 'FUN_alvo', c: 'int FUN_alvo(void) { return 0; }' },
    { name: 'acentos', c: 'char *s = "ação ALVO çà";\n// ALVO de novo' },
    { name: 'nada', c: 'void nada(void) {}' },
  ]);
  for (const size of [1, 3, 7, 64, 1 << 20]) {
    const r = await searchPseudo(chunks(data, size), index, searchPattern('alvo', false), FAR);
    assert.equal(r.scanned, 3);
    // "FUN_alvo" aparece no cabecalho tambem: so a linha do codigo conta.
    assert.deepEqual(
      r.results.map((h) => [h.name, h.lineCount]),
      [
        ['FUN_alvo', 1],
        ['acentos', 2],
      ],
    );
    assert.equal(r.matchedLines, 3);
    const line = r.results[1]!.lines[0]!;
    assert.equal(line.text, 'char *s = "ação ALVO çà";');
    assert.equal(line.text.slice(...line.marks[0]!), 'ALVO');
    assert.equal(r.partial, false);
  }
});

test('fluxo: sem as de biblioteca (indice filtrado), pula as faixas delas', async () => {
  const { data, index } = blob([
    { name: 'lib', c: 'memcpy(alvo);', library: true },
    { name: 'minha', c: 'alvo();' },
  ]);
  const r = await searchPseudo(
    chunks(data, 5),
    index.filter((f) => !f.library),
    searchPattern('alvo', true),
    FAR,
  );
  assert.deepEqual(
    r.results.map((h) => h.name),
    ['minha'],
  );
});

test('fluxo: mais funcoes que o teto e prazo vencido', async () => {
  const many = Array.from({ length: SEARCH_MAX_FUNCTIONS + 5 }, (_, i) => ({
    name: `f${i}`,
    c: 'alvo;',
  }));
  const { data, index } = blob(many);
  const r = await searchPseudo(chunks(data, 4096), index, searchPattern('alvo', true), FAR);
  assert.equal(r.results.length, SEARCH_MAX_FUNCTIONS);
  assert.equal(r.matchedFunctions, SEARCH_MAX_FUNCTIONS + 5);
  assert.equal(r.truncated, true);
  const late = await searchPseudo(chunks(data, 4096), index, searchPattern('alvo', true), 0);
  assert.equal(late.partial, true);
  assert.equal(late.scanned, 0);
});

test('fluxo: objeto menor que o indice e erro', async () => {
  const { data, index } = blob([{ name: 'a', c: 'alvo' }]);
  await assert.rejects(
    searchPseudo(chunks(data.subarray(0, 10), 4), index, searchPattern('alvo', true), FAR),
  );
});
