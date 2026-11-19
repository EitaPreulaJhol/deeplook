import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Magika, magikaMismatch, scriptLanguageOf } from '../../src/lib/magika';

// Magika (plans/analise-estatica-ampliada, item 22).

const ps: Magika = {
  label: 'powershell',
  description: 'Powershell source',
  group: 'code',
  mime: 'application/x-powershell',
  extensions: ['ps1'],
  isText: true,
  score: 0.98,
};

test('o "fatura.pdf" que é PowerShell diverge da extensão; o .ps1 não', () => {
  assert.deepEqual(magikaMismatch(ps, null, 'fatura.pdf'), {
    basis: 'extension',
    expected: ['pdf'],
  });
  assert.equal(magikaMismatch(ps, null, 'script.ps1'), null);
  assert.equal(magikaMismatch(ps, null, 'sem-extensao'), null);
  assert.equal(magikaMismatch(ps, null, 'notas.txt'), null);
});

test('diverge do tipo detectado só com confiança alta e rótulo que diz algo', () => {
  assert.deepEqual(magikaMismatch(ps, { extensions: ['pdf'] }, 'x.pdf'), {
    basis: 'type',
    expected: ['pdf'],
  });
  assert.equal(magikaMismatch({ ...ps, score: 0.6 }, { extensions: ['pdf'] }, 'x.pdf'), null);
  assert.equal(
    magikaMismatch({ ...ps, label: 'txt', extensions: ['txt'] }, { extensions: ['pdf'] }, 'x'),
    null,
  );
});

test('a linguagem do script sai do rótulo, com confiança', () => {
  assert.equal(scriptLanguageOf(ps), 'powershell');
  assert.equal(scriptLanguageOf({ ...ps, label: 'vba' }), 'vbscript');
  assert.equal(scriptLanguageOf({ ...ps, score: 0.5 }), null);
  assert.equal(scriptLanguageOf({ ...ps, label: 'markdown' }), null);
});
