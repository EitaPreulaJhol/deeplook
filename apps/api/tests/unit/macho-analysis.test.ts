// Mach-O (comum e universal) montado byte a byte: cabecalho, segmentos, bibliotecas, simbolos,
// assinatura de codigo e entitlements, sem banco e sem toolchain de macOS.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMacho } from '../../src/lib/macho-analysis';
import { analyzeBuffer } from '../../src/lib/static-analysis';

const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const name16 = (s: string) => {
  const b = Buffer.alloc(16);
  b.write(s);
  return b;
};
const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const cmd = (id: number, body: Buffer) => {
  const size = 8 + body.length;
  return Buffer.concat([u32(id), u32(size), body]);
};

const segment = (
  name: string,
  initprot: number,
  sect?: { name: string; size: number; off: number },
) =>
  cmd(
    0x19,
    Buffer.concat([
      name16(name),
      u64(0x1000),
      u64(0x1000),
      u64(0),
      u64(0),
      u32(7),
      u32(initprot),
      u32(sect ? 1 : 0),
      u32(0),
      ...(sect
        ? [
            name16(sect.name),
            name16(name),
            u64(0x1000),
            u64(sect.size),
            u32(sect.off),
            u32(0),
            u32(0),
            u32(0),
            u32(0),
            u32(0),
            u32(0),
            u32(0),
          ]
        : []),
    ]),
  );
const dylib = (path: string, id = 0xc) =>
  cmd(id, pad4(Buffer.concat([u32(24), u32(0), u32(0), u32(0), Buffer.from(path + '\0')])));
const rpath = (path: string) =>
  cmd(0x8000001c, pad4(Buffer.concat([u32(12), Buffer.from(path + '\0')])));
const uuid = (hex: string) => cmd(0x1b, Buffer.from(hex, 'hex'));
const main = (off: number) => cmd(0x80000028, Buffer.concat([u64(off), u64(0)]));

interface Opts {
  cpu?: number;
  filetype?: number;
  /** Comandos prontos (sem simbolos/assinatura). */
  commands?: Buffer[];
  /** Simbolos indefinidos (importados). */
  imports?: string[];
  /** Blob da assinatura (superblob inteiro). */
  signature?: Buffer;
  /** Conteudo da secao __text. */
  text?: Buffer;
}

/** Mach-O 64 bits little-endian: cabecalho, comandos, depois __text, nlist, strtab e assinatura. */
function macho(o: Opts = {}): Buffer {
  const text = o.text ?? Buffer.alloc(8192, 0x90);
  const imports = o.imports ?? [];
  const strtab = Buffer.from('\0' + imports.map((s) => `_${s}\0`).join(''));
  const fixed = [
    ...(o.commands ?? []),
    segment('__TEXT', 5, { name: '__text', size: text.length, off: 0 }),
  ];
  // Os tamanhos dos comandos de simbolos e assinatura sao fixos, entao da para calcular os deslocamentos.
  const symCmdSize = 24 + 80 + (o.signature ? 16 : 0);
  const fixedSize = fixed.reduce((n, c) => n + c.length, 0) + symCmdSize;
  const headerSize = 32 + fixedSize;
  const textOff = headerSize;
  const symOff = textOff + text.length;
  const nlist = Buffer.concat(
    imports.map((_, i) => {
      const b = Buffer.alloc(16);
      b.writeUInt32LE(1 + imports.slice(0, i).reduce((n, s) => n + s.length + 2, 0), 0);
      b[4] = 0x01; // N_UNDF | N_EXT
      return b;
    }),
  );
  const strOff = symOff + nlist.length;
  const sigOff = strOff + strtab.length;
  // O offset da secao __text e conhecido so agora: refaz o segmento.
  fixed[fixed.length - 1] = segment('__TEXT', 5, {
    name: '__text',
    size: text.length,
    off: textOff,
  });
  const commands = [
    ...fixed,
    cmd(0x2, Buffer.concat([u32(symOff), u32(imports.length), u32(strOff), u32(strtab.length)])),
    cmd(
      0xb,
      Buffer.concat([
        u32(0),
        u32(0),
        u32(0),
        u32(0),
        u32(0),
        u32(imports.length),
        ...Array.from({ length: 12 }, () => u32(0)),
      ]),
    ),
    ...(o.signature ? [cmd(0x1d, Buffer.concat([u32(sigOff), u32(o.signature.length)]))] : []),
  ];
  const body = Buffer.concat(commands);
  const header = Buffer.concat([
    u32(0xfeedfacf),
    u32(o.cpu ?? CPU_X86_64),
    u32(3),
    u32(o.filetype ?? 2),
    u32(commands.length),
    u32(body.length),
    u32(0x200000),
    u32(0),
  ]);
  return Buffer.concat([header, body, text, nlist, strtab, o.signature ?? Buffer.alloc(0)]);
}

const be32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
/** Superblob: CodeDirectory (flags, identificador) e, se pedido, entitlements. */
function signature(flags: number, identifier: string, entitlements?: string[]): Buffer {
  const ident = Buffer.from(identifier + '\0');
  const dir = Buffer.concat([
    be32(0xfade0c02),
    be32(44 + ident.length),
    be32(0x20400),
    be32(flags),
    be32(44 + ident.length),
    be32(44),
    Buffer.alloc(20),
    ident,
  ]);
  const xml = entitlements
    ? Buffer.from(
        `<?xml version="1.0"?><plist><dict>${entitlements.map((e) => `<key>${e}</key><true/>`).join('')}</dict></plist>`,
      )
    : null;
  const ents = xml ? Buffer.concat([be32(0xfade7171), be32(8 + xml.length), xml]) : null;
  const blobs = [dir, ...(ents ? [ents] : [])];
  const indexSize = 12 + blobs.length * 8;
  let off = indexSize;
  const index = blobs.map((b, i) => {
    const e = Buffer.concat([be32(i === 0 ? 0 : 5), be32(off)]);
    off += b.length;
    return e;
  });
  return Buffer.concat([be32(0xfade0cc0), be32(off), be32(blobs.length), ...index, ...blobs]);
}

function fat(slices: { cpu: number; data: Buffer }[]): Buffer {
  const head = Buffer.concat([be32(0xcafebabe), be32(slices.length)]);
  let off = 8 + slices.length * 20;
  const archs: Buffer[] = [];
  const bodies: Buffer[] = [];
  for (const s of slices) {
    archs.push(Buffer.concat([be32(s.cpu), be32(0), be32(off), be32(s.data.length), be32(12)]));
    bodies.push(s.data);
    off += s.data.length;
  }
  return Buffer.concat([head, ...archs, ...bodies]);
}

test('Mach-O x86-64 sem assinatura: cabecalho, bibliotecas, UUID, entrada e simbolos', () => {
  const buf = macho({
    commands: [
      dylib('/usr/lib/libSystem.B.dylib'),
      dylib('/System/Library/Frameworks/Security.framework/Security', 0x80000018),
      rpath('@executable_path/../Frameworks'),
      uuid('00112233445566778899aabbccddeeff'),
      main(0x1234),
    ],
    imports: ['printf', 'ptrace', 'task_for_pid', 'mach_vm_write'],
  });
  const r = parseMacho(buf);
  assert.ok(r);
  const { info } = r;
  assert.equal(info.fat, false);
  assert.equal(info.architecture, 'x86-64');
  assert.deepEqual(info.architectures, ['x86-64']);
  assert.equal(info.class, 64);
  assert.equal(info.endian, 'little');
  assert.equal(info.type, 'executável');
  assert.deepEqual(info.libraries, [
    '/usr/lib/libSystem.B.dylib',
    '/System/Library/Frameworks/Security.framework/Security',
  ]);
  assert.deepEqual(info.rpaths, ['@executable_path/../Frameworks']);
  assert.equal(info.uuid, '00112233-4455-6677-8899-AABBCCDDEEFF');
  assert.equal(info.entry, '+0x1234');
  assert.equal(info.importedSymbols, 4);
  assert.deepEqual(r.symbols, ['printf', 'ptrace', 'task_for_pid', 'mach_vm_write']);
  assert.deepEqual(info.suspiciousSymbols, ['mach_vm_write', 'ptrace', 'task_for_pid']);
  assert.equal(info.sections[0].name, '__text');
  assert.equal(info.sections[0].segment, '__TEXT');
  assert.equal(info.signature.present, false);
  assert.ok(info.alerts.includes('sem assinatura de código'));
  assert.ok(info.alerts.includes('injeção em outro processo (task_for_pid e mach_vm_write)'));
  assert.equal(info.risk, 'high');
});

test('assinatura ad-hoc, hardened runtime e entitlements', () => {
  const buf = macho({
    signature: signature(0x2 | 0x10000, 'com.exemplo.app', [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.network.client',
    ]),
  });
  const info = parseMacho(buf)!.info;
  assert.equal(info.signature.present, true);
  assert.equal(info.signature.adhoc, true);
  assert.equal(info.signature.runtime, true);
  assert.equal(info.signature.identifier, 'com.exemplo.app');
  assert.deepEqual(info.signature.entitlements, [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.network.client',
  ]);
  assert.ok(info.alerts.includes('assinatura ad-hoc (sem certificado de desenvolvedor)'));
  assert.ok(info.alerts.some((a) => a.startsWith('entitlements que afrouxam a proteção: ')));
  assert.equal(info.risk, 'medium');
});

test('assinado por desenvolvedor, sem entitlements de risco: risco baixo', () => {
  const info = parseMacho(macho({ signature: signature(0x10000, 'com.exemplo.ok') }))!.info;
  assert.equal(info.signature.adhoc, false);
  assert.deepEqual(info.alerts, []);
  assert.equal(info.risk, 'low');
});

test('segmento gravavel e executavel ao mesmo tempo e risco alto', () => {
  const info = parseMacho(
    macho({ commands: [segment('__EVIL', 7)], signature: signature(0x10000, 'x') }),
  )!.info;
  assert.equal(info.rwxSegments, 1);
  assert.ok(info.alerts.includes('segmento gravável e executável'));
  assert.equal(info.risk, 'high');
});

test('codigo com entropia alta vira alerta', () => {
  const noise = Buffer.alloc(16384);
  let x = 123456789;
  for (let i = 0; i < noise.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    noise[i] = x >>> 24;
  }
  const info = parseMacho(macho({ text: noise, signature: signature(0x10000, 'x') }))!.info;
  assert.ok(info.sections[0].entropy > 7.2);
  assert.ok(
    info.alerts.includes('código com entropia alta (possível empacotamento ou criptografia)'),
  );
});

test('binario universal: todas as arquiteturas, descreve a ARM64', () => {
  const sig = signature(0x10000, 'x');
  const buf = fat([
    { cpu: CPU_X86_64, data: macho({ cpu: CPU_X86_64, signature: sig }) },
    { cpu: CPU_ARM64, data: macho({ cpu: CPU_ARM64, signature: sig }) },
  ]);
  const info = parseMacho(buf)!.info;
  assert.equal(info.fat, true);
  assert.deepEqual(info.architectures, ['x86-64', 'ARM64']);
  assert.equal(info.architecture, 'ARM64');
});

test('o alerta de qualquer fatia conta no binario universal', () => {
  const buf = fat([
    { cpu: CPU_ARM64, data: macho({ cpu: CPU_ARM64, signature: signature(0x10000, 'x') }) },
    { cpu: CPU_X86_64, data: macho({ cpu: CPU_X86_64, commands: [segment('__EVIL', 7)] }) },
  ]);
  const info = parseMacho(buf)!.info;
  assert.equal(info.risk, 'high');
  assert.ok(info.alerts.includes('segmento gravável e executável'));
});

test('entra na analise estatica: tipo macho e campo macho preenchido', () => {
  const st = analyzeBuffer(macho({ signature: signature(0x10000, 'x') }), 'agente');
  assert.equal(st.detectedType?.id, 'macho');
  assert.equal(st.macho?.architecture, 'x86-64');
  const cls = Buffer.alloc(64);
  Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]).copy(cls);
  assert.equal(analyzeBuffer(cls, 'A.class').macho ?? null, null);
});

test('arquivo corrompido ou mentiroso nunca lanca', () => {
  assert.equal(parseMacho(Buffer.from('MZ\x90\x00')), null);
  assert.equal(parseMacho(Buffer.alloc(4)), null);
  const good = macho({ signature: signature(0x10000, 'x'), imports: ['a', 'b'] });
  // Trunca em varios pontos e corrompe campos do cabecalho: so pode devolver null ou uma ficha.
  for (const cut of [8, 20, 31, 32, 40, 100, 200, 400, good.length - 5]) {
    assert.doesNotThrow(() => parseMacho(good.subarray(0, cut)));
  }
  for (const [offset, value] of [
    [16, 0xffffffff],
    [20, 0xffffffff],
    [32 + 4, 0xffffffff],
    [32 + 4, 0],
    [32 + 4, 3],
  ] as const) {
    const bad = Buffer.from(good);
    bad.writeUInt32LE(value, offset);
    assert.doesNotThrow(() => parseMacho(bad));
  }
  let seed = 7;
  for (let n = 0; n < 200; n++) {
    const bad = Buffer.from(good);
    for (let k = 0; k < 8; k++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bad[32 + (seed % (bad.length - 32))] = seed >>> 24;
    }
    assert.doesNotThrow(() => parseMacho(bad));
  }
});
