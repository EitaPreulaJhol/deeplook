// Hash perceptual do print (revisao 3.4): a comparacao, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { phashDistance, phashIsFlat, phashSimilarity, validPhash } from '../../src/lib/phash';

const H = 'a5'.repeat(32);

test('só aceita 64 dígitos hexadecimais em minúsculas', () => {
  assert.equal(validPhash(H), H);
  for (const bad of [
    H.toUpperCase(),
    H.slice(2),
    `${H}00`,
    'zz'.repeat(32),
    '',
    null,
    undefined,
    42,
    { hash: H },
  ]) {
    assert.equal(validPhash(bad), null, String(bad));
  }
});

test('distância: bits diferentes, simétrica, e null para o que não é hash', () => {
  assert.equal(phashDistance(H, H), 0);
  assert.equal(phashDistance('00'.repeat(32), 'ff'.repeat(32)), 256);
  assert.equal(phashDistance('00'.repeat(32), `01${'00'.repeat(31)}`), 1);
  assert.equal(phashDistance('0f'.repeat(32), 'f0'.repeat(32)), 256);
  const other = `ff${H.slice(2)}`;
  assert.equal(phashDistance(H, other), phashDistance(other, H));
  assert.equal(phashDistance(H, 'curto'), null);
  assert.equal(phashDistance('', H), null);
});

test('similaridade em %', () => {
  assert.equal(phashSimilarity(0), 100);
  assert.equal(phashSimilarity(256), 0);
  assert.equal(phashSimilarity(20), 92);
  assert.equal(phashSimilarity(26), 90);
});

test('página sem estrutura (quase todos os bits iguais) não é usada', () => {
  assert.ok(phashIsFlat('00'.repeat(32)));
  assert.ok(phashIsFlat('ff'.repeat(32)));
  assert.ok(phashIsFlat(`ff${'00'.repeat(31)}`), '8 bits ligados');
  assert.ok(!phashIsFlat(`ffff${'00'.repeat(30)}`), '16 bits já contam como estrutura');
  assert.ok(!phashIsFlat(H));
});
