import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CRC32, decodeWith, MD5_T, SBOX, scanCrypto } from '../../src/lib/crypto-scan';
import { localizeStaticInfo } from '../../src/lib/data-language';

// Criptografia e codificacao (plans/analise-estatica-ampliada, item 7).

test('as tabelas geradas batem com as publicadas (FIPS 197, RFC 1321, zlib)', () => {
  assert.equal(SBOX.subarray(0, 16).toString('hex'), '637c777bf26b6fc53001672bfed7ab76');
  assert.equal(SBOX[0xff], 0x16);
  assert.equal(CRC32[0], 0x77073096);
  assert.deepEqual(MD5_T, [0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee]);
});

test('acha as constantes com a posição e não confunde SHA-1 com MD5 nem RC5 com TEA', () => {
  const sha1 = Buffer.alloc(20);
  [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0].forEach((v, i) =>
    sha1.writeUInt32LE(v, i * 4),
  );
  const rc5 = Buffer.alloc(8);
  rc5.writeUInt32LE(0xb7e15163, 0);
  rc5.writeUInt32LE(0x9e3779b9, 4);
  const buf = Buffer.concat([
    Buffer.alloc(100),
    SBOX,
    Buffer.alloc(7),
    Buffer.from('expand 32-byte k'),
    sha1,
    Buffer.alloc(3),
    rc5,
  ]);
  const found = scanCrypto(buf).constants.map((c) => `${c.algorithm}:${c.what}@${c.offset}`);
  assert.deepEqual(found, [
    'AES:S-box@100',
    'ChaCha/Salsa20:constante "expand 32-byte k"@363',
    'SHA-1:valores iniciais@379',
    'RC5/RC6:constantes P32 e Q32@402',
  ]);
});

test('chave RSA do CryptoAPI vira alerta médio', () => {
  const blob = Buffer.concat([Buffer.alloc(16), Buffer.from('0602000000a4000052534131', 'hex')]);
  const r = scanCrypto(blob);
  assert.equal(r.constants[0].algorithm, 'RSA');
  assert.equal(r.alerts[0].level, 'medium');
  assert.match(r.alerts[0].text, /posição 0x10/);
});

test('alfabeto Base64 próprio decodifica as strings do arquivo', () => {
  const std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Alfabeto embaralhado (rotacionado em 7) e uma URL codificada com ele.
  const custom = std.slice(7) + std.slice(0, 7);
  const encode = (text: string) =>
    [...Buffer.from(text).toString('base64').replace(/=+$/, '')]
      .map((c) => custom[std.indexOf(c)])
      .join('');
  const secret = encode('http://c2.evil.test/painel/gate.php');
  const buf = Buffer.concat([
    Buffer.from('\0'),
    Buffer.from(custom),
    Buffer.from('\0\0'),
    Buffer.from(secret),
    Buffer.from('\0'),
    Buffer.from(std),
    Buffer.from('\0'),
  ]);
  const r = scanCrypto(buf);
  assert.equal(r.alphabets.length, 1, 'o padrão não conta como próprio');
  assert.equal(r.alphabets[0].alphabet, custom);
  assert.equal(r.alphabets[0].offset, 1);
  assert.deepEqual(r.alphabets[0].decoded, [
    { source: secret, text: 'http://c2.evil.test/painel/gate.php' },
  ]);
  assert.equal(r.alerts[0].level, 'high');
  assert.equal(decodeWith(custom, secret)?.toString(), 'http://c2.evil.test/painel/gate.php');
  // Em ingles, o alerta e o rotulo saem traduzidos.
  const en = localizeStaticInfo({ crypto: r }, 'en');
  assert.match(en.crypto.alerts[0].text, /^Custom Base64 alphabet, which decodes 1 string/);
});

test('arquivo comum não acusa nada', () => {
  const r = scanCrypto(Buffer.from('MZ' + 'texto comum '.repeat(500)));
  assert.deepEqual(r, { constants: [], alphabets: [], alerts: [] });
});
