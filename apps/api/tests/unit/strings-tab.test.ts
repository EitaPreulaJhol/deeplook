import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  categoriesOf,
  dedupe,
  heuristicScore,
  literalsOf,
  stringsWithOffsets,
} from '../../src/lib/strings-tab';

// Aba de strings unificada (plans/analise-estatica-ampliada, item 26).

test('ASCII e UTF-16 com o deslocamento', () => {
  const buf = Buffer.concat([
    Buffer.alloc(16),
    Buffer.from('http://c2.exemplo.invalid/a'),
    Buffer.alloc(4),
    Buffer.from('cmd.exe /c del x', 'utf16le'),
    Buffer.alloc(2),
  ]);
  const found = stringsWithOffsets(buf);
  assert.deepEqual(
    found.map((s) => [s.text, s.source, s.offset]),
    [
      ['http://c2.exemplo.invalid/a', 'ascii', 16],
      ['cmd.exe /c del x', 'utf16', 47],
    ],
  );
});

test('categorias e a nota sem o StringSifter', () => {
  assert.deepEqual(categoriesOf('https://c2.exemplo.invalid/gate.php'), ['url']);
  assert.deepEqual(categoriesOf('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'), [
    'registry',
  ]);
  assert.deepEqual(categoriesOf('powershell -enc AAAA'), ['command']);
  assert.ok(
    heuristicScore('https://c2.exemplo.invalid/gate.php', ['url']) >
      heuristicScore('AAAAAAAAAAAA', []),
  );
});

test('literais do código descompilado, sem repetir', () => {
  const cs =
    'var u = "http://c2.exemplo.invalid/x"; var a = "http://c2.exemplo.invalid/x"; var b = "oi";';
  assert.deepEqual(
    dedupe(literalsOf(cs, 'dotnet')).map((s) => s.text),
    ['http://c2.exemplo.invalid/x'],
  );
  assert.deepEqual(
    literalsOf("C2 = 'https://c2.exemplo.invalid/painel'", 'python').map((s) => s.text),
    ['https://c2.exemplo.invalid/painel'],
  );
});
