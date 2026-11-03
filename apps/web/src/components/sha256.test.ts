import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

/** SHA-256 de referencia pela Web Crypto (a mesma API do navegador), para cruzar. */
async function webSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('bate com os vetores conhecidos do FIPS 180-4', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('sai sempre com 64 digitos hexadecimais', () => {
    expect(sha256Hex('qualquer coisa')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bate com a Web Crypto nos tamanhos de borda do padding e em multiplos blocos', async () => {
    // 55/56 e 63/64 cercam a fronteira onde o tamanho (9 bytes) muda de bloco.
    const lengths = [1, 54, 55, 56, 63, 64, 65, 119, 120, 127, 128, 200];
    for (const n of lengths) {
      const text = 'a'.repeat(n);
      expect(sha256Hex(text)).toBe(await webSha256(text));
    }
  });

  it('bate com a Web Crypto em texto Unicode (multibyte em UTF-8)', async () => {
    const text = 'héllo wörld — 日本語 — αβγ';
    expect(sha256Hex(text)).toBe(await webSha256(text));
  });
});
