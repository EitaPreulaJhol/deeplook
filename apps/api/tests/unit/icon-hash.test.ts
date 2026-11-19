import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { iconDistance, iconHash } from '../../src/lib/icon-hash';
import { tlsh } from '../../src/lib/tlsh';

// Hash do icone principal (plans/analise-estatica-ampliada, item 2): a mesma imagem em formatos
// diferentes (DIB de 32 bits, DIB de 8 bits com paleta, PNG RGBA e PNG com paleta) da o mesmo
// dHash; outra imagem fica longe.

const W = 32;
const H = 32;
/** Imagem de teste: degrade horizontal com uma faixa escura, cor por pixel (cinza, 0-255). */
const shade = (x: number, y: number) => (y > 10 && y < 20 ? 30 : Math.round((x * 255) / (W - 1)));

function dib32(pixel = shade): Buffer {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(W, 4);
  head.writeInt32LE(H * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((H - 1 - y) * W + x) * 4;
      const v = pixel(x, y);
      px.writeUInt32LE(((255 << 24) | (v << 16) | (v << 8) | v) >>> 0, o);
    }
  }
  return Buffer.concat([head, px, Buffer.alloc(4 * H)]);
}

function dib8(): Buffer {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(W, 4);
  head.writeInt32LE(H * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(8, 14);
  const palette = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) palette.writeUInt32LE((i << 16) | (i << 8) | i, i * 4);
  const px = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[(H - 1 - y) * W + x] = shade(x, y);
  return Buffer.concat([head, palette, px, Buffer.alloc(4 * H)]);
}

function png(color: 6 | 3): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = color;
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    // Filtros variados (Sub e Up) para exercitar a reconstrucao.
    const filter = y % 2 ? 1 : 2;
    const raw = Buffer.alloc(color === 6 ? W * 4 : W);
    for (let x = 0; x < W; x++) {
      const v = shade(x, y);
      if (color === 6) raw.writeUInt32BE(((v << 24) | (v << 16) | (v << 8) | 255) >>> 0, x * 4);
      else raw[x] = v;
    }
    const bpp = color === 6 ? 4 : 1;
    const prev = y ? Buffer.alloc(raw.length) : null;
    if (prev) {
      for (let x = 0; x < W; x++) {
        const v = shade(x, y - 1);
        if (color === 6) prev.writeUInt32BE(((v << 24) | (v << 16) | (v << 8) | 255) >>> 0, x * 4);
        else prev[x] = v;
      }
    }
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const pred = filter === 1 ? (i >= bpp ? raw[i - bpp] : 0) : prev ? prev[i] : 0;
      out[i] = (raw[i] - pred) & 0xff;
    }
    rows.push(Buffer.from([filter]), out);
  }
  const palette = Buffer.alloc(256 * 3);
  for (let i = 0; i < 256; i++) palette.fill(i, i * 3, i * 3 + 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(color === 3 ? [chunk('PLTE', palette)] : []),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a mesma imagem em DIB de 32 e 8 bits e em PNG RGBA e com paleta da o mesmo hash', () => {
  const hashes = [dib32(), dib8(), png(6), png(3)].map((b) => iconHash(b));
  for (const h of hashes) assert.ok(h && h.width === W && h.height === H, JSON.stringify(h));
  assert.equal(new Set(hashes.map((h) => h!.hash)).size, 1, JSON.stringify(hashes));
  assert.match(hashes[0]!.hash, /^[0-9a-f]{16}$/);
});

test('outra imagem fica longe; distancia de hashes e de valores invalidos', () => {
  const a = iconHash(dib32())!.hash;
  const b = iconHash(dib32((x, y) => ((x + y) % 7) * 36))!.hash;
  assert.ok(iconDistance(a, b)! > 10, `${a} ${b}`);
  assert.equal(iconDistance(a, a), 0);
  assert.equal(iconDistance(a, 'zz'), null);
});

test('formato nao suportado ou corrompido devolve null, sem lancar', () => {
  assert.equal(iconHash(Buffer.alloc(10)), null);
  assert.equal(iconHash(dib32().subarray(0, 100)), null);
  const broken = png(6);
  broken.fill(0, 40, 60);
  assert.equal(iconHash(broken), null);
});

test('telfhash usa o TLSH a partir de 50 bytes (forcehash)', () => {
  const text = Buffer.from(
    'accept,bind,connect,fork,getpid,kill,listen,recv,send,setsid,socket,waitpid',
  );
  assert.equal(tlsh(text), null);
  assert.match(tlsh(text, 50) ?? '', /^[0-9A-F]{70}$/);
});
