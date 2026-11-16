// Busca no visualizador hexadecimal (plans/ajustes-usabilidade, item 7): padroes de texto e de
// bytes, e a varredura em blocos (o que cruza a divisa, maiusculas, UTF-16, o teto de posicoes).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHexBytes, searchPatterns, searchStream } from '../../src/routes/hex';

/** O buffer em blocos de `size` bytes, como chegaria do MinIO. */
async function* chunks(buf: Buffer, size: number) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

const search = (buf: Buffer, q: string, kind: 'text' | 'bytes', size = 7, maxHits?: number) =>
  searchStream(chunks(buf, size), searchPatterns(q, kind)!, {
    caseless: kind === 'text',
    maxHits,
  });

test('bytes em hexadecimal: com espaços, 0x, \\x ou junto; inválido é null', () => {
  for (const text of ['4D 5A 90 00', '4d5a9000', '0x4d 0x5a 0x90 0x00', '\\x4d\\x5a\\x90\\x00']) {
    assert.deepEqual(parseHexBytes(text), Buffer.from([0x4d, 0x5a, 0x90, 0x00]), text);
  }
  for (const text of ['4D5', 'zz', '', 'MZ']) assert.equal(parseHexBytes(text), null, text);
  assert.equal(searchPatterns('00'.repeat(257), 'bytes'), null);
  assert.equal(searchPatterns('a'.repeat(129), 'text'), null);
});

test('texto: sem diferenciar maiúsculas, em UTF-8 e UTF-16LE, cruzando a divisa dos blocos', async () => {
  const buf = Buffer.concat([
    Buffer.from('xxHTTP://evil'),
    Buffer.from('..'),
    Buffer.from('http://', 'utf16le'),
    Buffer.from('yy'),
  ]);
  const { hits, truncated, scanned } = await search(buf, 'Http://', 'text', 5);
  assert.deepEqual(hits, [
    { offset: 2, length: 7, encoding: 'utf8' },
    { offset: 15, length: 14, encoding: 'utf16' },
  ]);
  assert.equal(truncated, false);
  assert.equal(scanned, buf.length);
});

test('bytes: exatos (sem mexer em maiúsculas), um bloco de 1 byte não perde nada', async () => {
  const buf = Buffer.from([0x00, 0x4d, 0x5a, 0x90, 0x6d, 0x7a, 0x90, 0x4d, 0x5a, 0x90]);
  const { hits } = await search(buf, '4D5A90', 'bytes', 1);
  assert.deepEqual(
    hits.map((h) => h.offset),
    [1, 7],
  );
});

test('um caractere: uma posição por lugar (o UTF-16 não repete o UTF-8)', async () => {
  const { hits } = await search(Buffer.from('a\0b\0a'), 'a', 'text');
  assert.deepEqual(
    hits.map((h) => [h.offset, h.encoding]),
    [
      [0, 'utf8'],
      [4, 'utf8'],
    ],
  );
});

test('teto: para de ler e avisa que há mais', async () => {
  const buf = Buffer.from('ab'.repeat(1000));
  const { hits, truncated, scanned } = await search(buf, 'ab', 'text', 16, 5);
  assert.equal(hits.length, 5);
  assert.equal(truncated, true);
  assert.ok(scanned < buf.length, `leu ${scanned} de ${buf.length}`);
  assert.deepEqual(
    hits.map((h) => h.offset),
    [0, 2, 4, 6, 8],
  );
});
