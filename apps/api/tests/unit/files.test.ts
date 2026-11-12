// Tipo real do arquivo pela assinatura e o hash de semelhanca (TLSH), sem banco.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { detectType } from '../../src/lib/file-type';
import { tlsh, TLSH_MIN_LENGTH, tlshDistance, tlshSimilarity } from '../../src/lib/tlsh';

const withHead = (head: number[] | string, size = 64) => {
  const buf = Buffer.alloc(size);
  Buffer.from(head as string, typeof head === 'string' ? 'latin1' : undefined).copy(buf);
  return buf;
};

test('tipo pela assinatura: executáveis são marcados como executáveis', () => {
  assert.equal(detectType(withHead('MZ'))?.id, 'pe');
  assert.equal(detectType(withHead([0x7f, 0x45, 0x4c, 0x46]))?.id, 'elf');
  assert.equal(detectType(withHead([0xcf, 0xfa, 0xed, 0xfe]))?.id, 'macho');
  for (const head of ['MZ', '\x7fELF']) assert.equal(detectType(withHead(head))?.executable, true);
  assert.equal(detectType(withHead('%PDF-1.7'))?.id, 'pdf');
  assert.equal(detectType(withHead('%PDF-1.7'))?.executable, false);
});

test('tipo pela assinatura: o ZIP se distingue pelos nomes internos', () => {
  const zip = (inner: string) => withHead(`PK\x03\x04${'\0'.repeat(26)}${inner}`, 256);
  assert.equal(detectType(zip('word/document.xml'))?.id, 'docx');
  assert.equal(detectType(zip('xl/workbook.xml'))?.id, 'xlsx');
  assert.equal(detectType(zip('ppt/slides/slide1.xml'))?.id, 'pptx');
  assert.equal(detectType(zip('META-INF/MANIFEST.MF'))?.id, 'jar');
  assert.equal(detectType(zip('AndroidManifest.xml'))?.id, 'apk');
  assert.equal(detectType(zip('qualquer.txt'))?.id, 'zip');
  assert.equal(detectType(zip('META-INF/MANIFEST.MF'))?.executable, true);
});

test('tipo pela assinatura: OLE antigo, e o que não tem assinatura', () => {
  assert.equal(detectType(withHead([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))?.id, 'ole');
  assert.equal(detectType(Buffer.alloc(0)), null);
  assert.equal(detectType(Buffer.from('M')), null, 'menor que a assinatura');
});

test('TLSH: curto demais ou sem variação não tem digest', () => {
  assert.equal(tlsh(randomBytes(TLSH_MIN_LENGTH - 1)), null);
  assert.equal(tlsh(Buffer.alloc(4096, 0x41)), null, 'um byte só repetido');
});

test('TLSH: formato, determinismo e distância zero para o mesmo conteúdo', () => {
  const data = randomBytes(8192);
  const digest = tlsh(data);
  assert.match(digest ?? '', /^[0-9A-F]{70}$/, '35 bytes em hexadecimal, sem o prefixo T1');
  assert.equal(tlsh(data), digest);
  assert.equal(tlshDistance(digest!, digest!), 0);
  assert.equal(tlshSimilarity(0), 100);
  assert.equal(tlshSimilarity(250), 0, 'nunca negativa');
});

test('TLSH: conteúdo quase igual fica perto, conteúdo diferente fica longe', () => {
  const base = Buffer.from(
    Array.from({ length: 16384 }, (_, i) => (i * 31 + (i >> 3) * 7 + (i % 97)) & 0xff),
  );
  const near = Buffer.from(base);
  for (let i = 5000; i < 5040; i++) near[i] ^= 0x5a;
  const far = randomBytes(16384);
  const d0 = tlsh(base)!;
  const nearDistance = tlshDistance(d0, tlsh(near)!)!;
  const farDistance = tlshDistance(d0, tlsh(far)!)!;
  assert.ok(nearDistance < 40, `quase igual: ${nearDistance}`);
  assert.ok(farDistance > 100, `diferente: ${farDistance}`);
  assert.ok(nearDistance < farDistance);
});

test('TLSH: digest inválido não tem distância', () => {
  const digest = tlsh(randomBytes(4096))!;
  assert.equal(tlshDistance(digest, 'T1ABC'), null);
  assert.equal(tlshDistance('lixo', digest), null);
  assert.equal(tlshDistance(`T1${digest}`, digest), 0, 'aceita o prefixo T1 de outras ferramentas');
  assert.equal(tlshDistance(digest, digest.slice(2)), null, 'digest cortado');
});
