import { entropy } from './entropy';

/**
 * Leitura de executavel macOS (Mach-O): cabecalho, arquiteturas (binario universal), segmentos,
 * secoes, bibliotecas, simbolos importados, assinatura de codigo e entitlements. So leitura,
 * com limites: tudo o que vem do arquivo e conferido contra o tamanho dele, e o arquivo pode
 * mentir em qualquer campo (mesma regra do elf-analysis.ts).
 */

/** Arquiteturas (fatias) de um binario universal lidas no maximo. */
const MAX_SLICES = 8;
const MAX_COMMANDS = 2048;
const MAX_SECTIONS = 64;
const MAX_LIBS = 64;
const MAX_RPATHS = 16;
const MAX_SYMBOLS = 4096;
const MAX_ENTITLEMENTS = 64;
/** Bytes somados no calculo de entropia das secoes; depois, so uma amostra de cada. */
const ENTROPY_BUDGET = 64 * 1024 * 1024;
const ENTROPY_SAMPLE = 64 * 1024;

export interface MachoSection {
  segment: string;
  name: string;
  size: number;
  entropy: number;
}

export interface MachoSignature {
  /** Tem blob de assinatura (LC_CODE_SIGNATURE). */
  present: boolean;
  /** Assinatura ad-hoc: sem certificado de desenvolvedor. */
  adhoc: boolean;
  /** Hardened runtime ligado. */
  runtime: boolean;
  /** Identificador do pacote (CodeDirectory). */
  identifier: string | null;
  /** Chaves do plist de entitlements. */
  entitlements: string[];
}

export interface MachoInfo {
  /** Binario universal (varias arquiteturas). */
  fat: boolean;
  /** Arquiteturas presentes, ex.: x86-64, ARM64. */
  architectures: string[];
  /** A arquitetura descrita abaixo (a de 64 bits mais comum, ou a primeira). */
  architecture: string;
  class: 32 | 64;
  endian: 'little' | 'big';
  type: string;
  platform: string | null;
  uuid: string | null;
  /** Ponto de entrada (LC_MAIN, ou LC_UNIXTHREAD nos antigos). */
  entry: string | null;
  sections: MachoSection[];
  /** Bibliotecas exigidas (LC_LOAD_DYLIB e parentes). */
  libraries: string[];
  rpaths: string[];
  importedSymbols: number;
  suspiciousSymbols: string[];
  signature: MachoSignature;
  /** Segmentos ao mesmo tempo gravaveis e executaveis. */
  rwxSegments: number;
  /** Conteudo criptografado (LC_ENCRYPTION_INFO, ex.: App Store ou protetor). */
  encrypted: boolean;
  packer: string | null;
  alerts: string[];
  risk: 'high' | 'medium' | 'low';
}

export interface MachoResult {
  info: MachoInfo;
  /** Nomes dos simbolos importados, para a busca; nao vao na ficha. */
  symbols: string[];
}

const CPU_TYPES: Record<number, string> = {
  7: 'x86',
  0x01000007: 'x86-64',
  12: 'ARM',
  0x0100000c: 'ARM64',
  0x0200000c: 'ARM64 (32 bits)',
  18: 'PowerPC',
  0x01000012: 'PowerPC 64',
};

const FILE_TYPES: Record<number, string> = {
  1: 'objeto realocável',
  2: 'executável',
  3: 'biblioteca de VM fixa',
  4: 'core dump',
  5: 'pré-carregado',
  6: 'biblioteca dinâmica',
  7: 'carregador dinâmico',
  8: 'bundle',
  9: 'stub de biblioteca',
  10: 'símbolos de depuração (dSYM)',
  11: 'extensão de kernel',
};

const PLATFORMS: Record<number, string> = {
  1: 'macOS',
  2: 'iOS',
  3: 'tvOS',
  4: 'watchOS',
  5: 'bridgeOS',
  6: 'Mac Catalyst',
  7: 'iOS Simulator',
  8: 'tvOS Simulator',
  9: 'watchOS Simulator',
  10: 'DriverKit',
  11: 'visionOS',
};

/** Chamadas de macOS que costumam aparecer em malware (nao provam nada sozinhas). */
const SUSPICIOUS_SYMBOLS = new Set([
  'ptrace',
  'sysctl',
  'sysctlbyname',
  'execve',
  'execv',
  'posix_spawn',
  'system',
  'popen',
  'dlopen',
  'dlsym',
  'mprotect',
  'task_for_pid',
  'mach_vm_write',
  'mach_vm_remap',
  'mach_vm_protect',
  'vm_protect',
  'NSCreateObjectFileImageFromMemory',
  'NSLinkModule',
  'CGEventTapCreate',
  'CGWindowListCreateImage',
  'CGDisplayCreateImage',
  'AXIsProcessTrusted',
  'SecKeychainFindGenericPassword',
  'SecItemCopyMatching',
]);

/** Injecao em outro processo: o par que quase sempre indica isso. */
const INJECTION_SYMBOLS = ['task_for_pid', 'mach_vm_write'];

/** Entitlements que afrouxam as protecoes do hardened runtime. */
const RISKY_ENTITLEMENTS = new Set([
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-executable-page-protection',
  'com.apple.security.get-task-allow',
  'com.apple.security.cs.debugger',
  'com.apple.private.tcc.allow',
  'com.apple.rootless.install',
]);

const LC_SEGMENT = 0x1;
const LC_SYMTAB = 0x2;
const LC_UNIXTHREAD = 0x5;
const LC_DYSYMTAB = 0xb;
const LC_LOAD_DYLIB = 0xc;
const LC_LAZY_LOAD_DYLIB = 0x20;
const LC_ENCRYPTION_INFO = 0x21;
const LC_UUID = 0x1b;
const LC_CODE_SIGNATURE = 0x1d;
const LC_SEGMENT_64 = 0x19;
const LC_ENCRYPTION_INFO_64 = 0x2c;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const LC_LOAD_WEAK_DYLIB = 0x80000018;
const LC_RPATH = 0x8000001c;
const LC_REEXPORT_DYLIB = 0x8000001f;
const LC_LOAD_UPWARD_DYLIB = 0x80000023;
const LC_MAIN = 0x80000028;
const DYLIB_COMMANDS = new Set([
  LC_LOAD_DYLIB,
  LC_LAZY_LOAD_DYLIB,
  LC_LOAD_WEAK_DYLIB,
  LC_REEXPORT_DYLIB,
  LC_LOAD_UPWARD_DYLIB,
]);

const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSMAGIC_ENTITLEMENTS = 0xfade7171;
const CS_ADHOC = 0x2;
const CS_RUNTIME = 0x10000;

interface Slice {
  offset: number;
  size: number;
  cpu: number;
}

const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '');

/** Lista as fatias: uma so num Mach-O comum, uma por arquitetura num universal (cabecalho big-endian). */
function listSlices(buf: Buffer): { fat: boolean; slices: Slice[] } | null {
  if (buf.length < 8) return null;
  const magic = buf.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const is64 = magic === 0xcafebabf;
    const n = buf.readUInt32BE(4);
    const entry = is64 ? 32 : 20;
    // O .class do Java tem o mesmo magic: a contagem de arquiteturas e pequena, a versao nao.
    if (n < 1 || n > 64 || buf.length < 8 + n * entry) return null;
    const slices: Slice[] = [];
    for (let i = 0; i < Math.min(n, MAX_SLICES); i++) {
      const o = 8 + i * entry;
      const cpu = buf.readUInt32BE(o);
      const offset = is64 ? Number(buf.readBigUInt64BE(o + 8)) : buf.readUInt32BE(o + 8);
      const size = is64 ? Number(buf.readBigUInt64BE(o + 16)) : buf.readUInt32BE(o + 12);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size)) continue;
      if (offset < 0 || size < 28 || offset + size > buf.length) continue;
      slices.push({ offset, size, cpu });
    }
    return slices.length ? { fat: true, slices } : null;
  }
  if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return null;
  return { fat: false, slices: [{ offset: 0, size: buf.length, cpu: -1 }] };
}

interface SliceResult {
  info: Omit<MachoInfo, 'fat' | 'architectures' | 'risk'>;
  symbols: string[];
  levels: ('high' | 'medium')[];
}

function parseSlice(buf: Buffer, slice: Slice): SliceResult | null {
  const base = slice.offset;
  const end = slice.offset + slice.size;
  if (end - base < 28) return null;
  // Os bytes do magic lidos em big-endian: FEEDFACE/F e o arquivo big-endian (PowerPC),
  // CEFAEDFE/CFFAEDFE e o little-endian (x86, ARM).
  const magic = buf.readUInt32BE(base);
  let littleEndianFile: boolean;
  let is64: boolean;
  if (magic === 0xfeedface || magic === 0xfeedfacf) {
    littleEndianFile = false;
    is64 = magic === 0xfeedfacf;
  } else if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
    littleEndianFile = true;
    is64 = magic === 0xcffaedfe;
  } else {
    return null;
  }
  const le = littleEndianFile;

  const fits = (o: number, n: number) => Number.isSafeInteger(o) && o >= base && o + n <= end;
  const u32 = (o: number) => (fits(o, 4) ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : null);
  const u64 = (o: number): number | null => {
    if (!fits(o, 8)) return null;
    const v = le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o);
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  };
  const cstr = (o: number, max: number): string => {
    if (!fits(o, 1)) return '';
    const window = buf.subarray(o, Math.min(end, o + max));
    const stop = window.indexOf(0);
    return clean(window.toString('latin1', 0, stop < 0 ? window.length : stop));
  };
  /** Nome de 16 bytes (segmento/secao), sem o lixo depois do NUL. */
  const name16 = (o: number) => (fits(o, 16) ? cstr(o, 16) : '');

  const cpu = u32(base + 4)!;
  const fileType = u32(base + 12)!;
  const ncmds = u32(base + 16)!;
  const sizeofcmds = u32(base + 20)!;
  const headerSize = is64 ? 32 : 28;

  const alerts: string[] = [];
  const levels: ('high' | 'medium')[] = [];
  const alert = (text: string, level?: 'high' | 'medium') => {
    alerts.push(text);
    if (level) levels.push(level);
  };

  if (headerSize + sizeofcmds > end - base) alert('comandos de carga fora do arquivo');
  const cmdsEnd = Math.min(end, base + headerSize + sizeofcmds);

  const segments: { name: string; initprot: number; sections: number }[] = [];
  const rawSections: {
    segment: string;
    name: string;
    size: number;
    offset: number;
    zerofill: boolean;
  }[] = [];
  const libraries: string[] = [];
  const rpaths: string[] = [];
  let uuid: string | null = null;
  let entry: string | null = null;
  let platform: string | null = null;
  let encrypted = false;
  let signatureBlob: { off: number; size: number } | null = null;
  let symtab: { symoff: number; nsyms: number; stroff: number; strsize: number } | null = null;
  let undef: { first: number; count: number } | null = null;
  let mainSegmentSeen = false;

  let p = base + headerSize;
  for (let i = 0; i < Math.min(ncmds, MAX_COMMANDS); i++) {
    if (p + 8 > cmdsEnd) break;
    const cmd = u32(p)!;
    const size = u32(p + 4)!;
    if (size < 8 || p + size > cmdsEnd) {
      alert('comando de carga corrompido');
      break;
    }
    const at = (rel: number) => p + rel;
    if (cmd === LC_SEGMENT || cmd === LC_SEGMENT_64) {
      const seg64 = cmd === LC_SEGMENT_64;
      const nsects = u32(at(seg64 ? 64 : 48)) ?? 0;
      const segName = name16(at(8));
      const initprot = u32(at(seg64 ? 60 : 44)) ?? 0;
      segments.push({ name: segName, initprot, sections: nsects });
      mainSegmentSeen = true;
      const secSize = seg64 ? 80 : 68;
      const secStart = at(seg64 ? 72 : 56);
      for (let s = 0; s < Math.min(nsects, 256); s++) {
        const o = secStart + s * secSize;
        if (o + secSize > p + size) break;
        const sectSize = seg64 ? u64(o + 40) : u32(o + 36);
        const sectOff = u32(o + (seg64 ? 48 : 40));
        const flags = u32(o + (seg64 ? 64 : 56)) ?? 0;
        if (sectSize === null || sectOff === null) continue;
        const type = flags & 0xff;
        rawSections.push({
          segment: name16(o + 16),
          name: name16(o),
          size: sectSize,
          offset: base + sectOff,
          // S_ZEROFILL (1) e S_GB_ZEROFILL (0xc): sem bytes no arquivo.
          zerofill: type === 1 || type === 0xc,
        });
      }
    } else if (DYLIB_COMMANDS.has(cmd)) {
      const nameOff = u32(at(8));
      if (nameOff !== null && nameOff < size && libraries.length < MAX_LIBS) {
        const lib = cstr(p + nameOff, Math.min(256, size - nameOff));
        if (lib) libraries.push(lib);
      }
    } else if (cmd === LC_RPATH) {
      const nameOff = u32(at(8));
      if (nameOff !== null && nameOff < size && rpaths.length < MAX_RPATHS) {
        const path = cstr(p + nameOff, Math.min(256, size - nameOff));
        if (path) rpaths.push(path);
      }
    } else if (cmd === LC_UUID && fits(at(8), 16)) {
      uuid = buf
        .toString('hex', at(8), at(8) + 16)
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
        .toUpperCase();
    } else if (cmd === LC_MAIN) {
      const off = u64(at(8));
      if (off !== null) entry = `+0x${off.toString(16)}`;
    } else if (cmd === LC_UNIXTHREAD && !entry) {
      entry = 'LC_UNIXTHREAD';
    } else if (cmd === LC_BUILD_VERSION) {
      const id = u32(at(8));
      if (id !== null) platform = PLATFORMS[id] ?? `plataforma ${id}`;
    } else if (cmd === LC_VERSION_MIN_MACOSX && !platform) {
      platform = 'macOS';
    } else if (cmd === LC_ENCRYPTION_INFO || cmd === LC_ENCRYPTION_INFO_64) {
      if ((u32(at(16)) ?? 0) !== 0) encrypted = true;
    } else if (cmd === LC_CODE_SIGNATURE) {
      const off = u32(at(8));
      const sz = u32(at(12));
      if (off !== null && sz !== null) signatureBlob = { off: base + off, size: sz };
    } else if (cmd === LC_SYMTAB) {
      const symoff = u32(at(8));
      const nsyms = u32(at(12));
      const stroff = u32(at(16));
      const strsize = u32(at(20));
      if (symoff !== null && nsyms !== null && stroff !== null && strsize !== null)
        symtab = { symoff: base + symoff, nsyms, stroff: base + stroff, strsize };
    } else if (cmd === LC_DYSYMTAB) {
      const first = u32(at(24));
      const count = u32(at(28));
      if (first !== null && count !== null) undef = { first, count };
    }
    p += size;
  }
  if (!mainSegmentSeen && ncmds > 0) alert('sem segmentos de memória');

  // Segmentos gravaveis e executaveis ao mesmo tempo (VM_PROT_WRITE 2 | VM_PROT_EXECUTE 4).
  const rwxSegments = segments.filter((s) => (s.initprot & 6) === 6).length;
  if (rwxSegments) alert('segmento gravável e executável', 'high');

  // Simbolos importados (indefinidos): pela faixa do LC_DYSYMTAB ou, sem ela, pelo tipo do nlist.
  const symbols: string[] = [];
  const suspicious = new Set<string>();
  if (symtab) {
    const nlistSize = is64 ? 16 : 12;
    const from = undef ? undef.first : 0;
    const count = Math.min(undef ? undef.count : symtab.nsyms, MAX_SYMBOLS);
    for (let i = from; i < from + count && i < symtab.nsyms; i++) {
      const o = symtab.symoff + i * nlistSize;
      if (!fits(o, nlistSize)) break;
      const strx = u32(o)!;
      const type = buf[o + 4];
      // N_TYPE = 0 (N_UNDF) e externo (N_EXT): so o que o arquivo importa.
      if (!undef && ((type & 0x0e) !== 0 || (type & 1) === 0)) continue;
      if (strx === 0 || strx >= symtab.strsize) continue;
      const name = cstr(symtab.stroff + strx, 128).replace(/^_/, '');
      if (!name) continue;
      symbols.push(name);
      if (SUSPICIOUS_SYMBOLS.has(name)) suspicious.add(name);
    }
  }
  const injecting = INJECTION_SYMBOLS.every((s) => suspicious.has(s));
  if (injecting) alert('injeção em outro processo (task_for_pid e mach_vm_write)', 'high');
  else if (suspicious.size >= 3)
    alert(`${suspicious.size} funções de risco importadas (ver lista abaixo)`, 'medium');

  // Assinatura de codigo (superblob big-endian): CodeDirectory e entitlements.
  const signature: MachoSignature = {
    present: false,
    adhoc: false,
    runtime: false,
    identifier: null,
    entitlements: [],
  };
  if (signatureBlob) {
    signature.present = true;
    const { off, size } = signatureBlob;
    const sEnd = Math.min(end, off + size);
    if (off >= base && off + 12 <= sEnd && buf.readUInt32BE(off) === CSMAGIC_EMBEDDED_SIGNATURE) {
      const count = Math.min(buf.readUInt32BE(off + 8), 32);
      for (let i = 0; i < count; i++) {
        const idx = off + 12 + i * 8;
        if (idx + 8 > sEnd) break;
        const blob = off + buf.readUInt32BE(idx + 4);
        if (blob + 8 > sEnd) continue;
        const magic = buf.readUInt32BE(blob);
        const length = buf.readUInt32BE(blob + 4);
        const blobEnd = Math.min(sEnd, blob + length);
        if (magic === CSMAGIC_CODEDIRECTORY && blob + 28 <= blobEnd) {
          const flags = buf.readUInt32BE(blob + 12);
          signature.adhoc = (flags & CS_ADHOC) !== 0;
          signature.runtime = (flags & CS_RUNTIME) !== 0;
          const identOff = buf.readUInt32BE(blob + 20);
          if (identOff < length) {
            const stop = buf
              .subarray(blob + identOff, Math.min(blobEnd, blob + identOff + 256))
              .indexOf(0);
            const sliceEnd =
              stop < 0 ? Math.min(blobEnd, blob + identOff + 256) : blob + identOff + stop;
            signature.identifier = clean(buf.toString('latin1', blob + identOff, sliceEnd)) || null;
          }
        } else if (magic === CSMAGIC_ENTITLEMENTS) {
          const xml = buf.toString('utf8', blob + 8, Math.min(blobEnd, blob + 8 + 256 * 1024));
          for (const m of xml.matchAll(/<key>([^<]{1,200})<\/key>/g)) {
            if (signature.entitlements.length >= MAX_ENTITLEMENTS) break;
            signature.entitlements.push(clean(m[1]));
          }
        }
      }
    }
  }
  if (fileType === 2 || fileType === 8 || fileType === 6) {
    if (!signature.present) alert('sem assinatura de código', 'medium');
    else if (signature.adhoc)
      alert('assinatura ad-hoc (sem certificado de desenvolvedor)', 'medium');
  }
  const risky = signature.entitlements.filter((e) => RISKY_ENTITLEMENTS.has(e));
  if (risky.length) alert(`entitlements que afrouxam a proteção: ${risky.join(', ')}`, 'medium');
  if (encrypted) alert('conteúdo criptografado (LC_ENCRYPTION_INFO)', 'medium');

  // Secoes com entropia, dentro do orcamento.
  let budget = ENTROPY_BUDGET;
  const sections: MachoSection[] = [];
  let hotText = false;
  for (const s of rawSections.slice(0, MAX_SECTIONS)) {
    let value = 0;
    if (!s.zerofill && s.offset >= base && s.offset < end) {
      const span = Math.min(s.size, end - s.offset, budget > 0 ? budget : ENTROPY_SAMPLE);
      budget -= span;
      value = entropy(buf, s.offset, s.offset + span);
    }
    if (s.segment === '__TEXT' && s.name === '__text' && value >= 7.2 && s.size >= 4096)
      hotText = true;
    sections.push({ segment: s.segment, name: s.name, size: s.size, entropy: value });
  }
  if (hotText) alert('código com entropia alta (possível empacotamento ou criptografia)', 'medium');

  const head = buf.toString('latin1', base, Math.min(end, base + 4096));
  const packer =
    head.includes('UPX!') || rawSections.some((s) => /^UPX/.test(s.segment)) ? 'UPX' : null;
  if (packer) alert(`empacotado com ${packer}`, 'high');

  return {
    info: {
      architecture: CPU_TYPES[cpu] ?? `0x${cpu.toString(16)}`,
      class: is64 ? 64 : 32,
      endian: littleEndianFile ? 'little' : 'big',
      type: FILE_TYPES[fileType] ?? `outro (${fileType})`,
      platform,
      uuid,
      entry,
      sections,
      libraries,
      rpaths,
      importedSymbols: symbols.length,
      suspiciousSymbols: [...suspicious].sort(),
      signature,
      rwxSegments,
      encrypted,
      packer,
      alerts,
    },
    symbols,
    levels,
  };
}

/** Le o Mach-O (comum ou universal) ou devolve null se nao for um. */
export function parseMacho(buf: Buffer): MachoResult | null {
  const listed = listSlices(buf);
  if (!listed) return null;
  const parsed = listed.slices
    .map((s) => parseSlice(buf, s))
    .filter((r): r is SliceResult => r !== null);
  if (!parsed.length) return null;
  // A fatia descrita: x86-64 ou ARM64 antes das demais.
  const main =
    parsed.find((r) => r.info.architecture === 'ARM64') ??
    parsed.find((r) => r.info.architecture === 'x86-64') ??
    parsed[0];
  const levels = new Set(parsed.flatMap((r) => r.levels));
  return {
    info: {
      ...main.info,
      fat: listed.fat,
      architectures: [...new Set(parsed.map((r) => r.info.architecture))],
      risk: levels.has('high') ? 'high' : levels.has('medium') ? 'medium' : 'low',
      // Alertas das outras fatias tambem contam (o malware pode esconder o ruim numa so).
      alerts: [...new Set(parsed.flatMap((r) => r.info.alerts))],
    },
    symbols: main.symbols,
  };
}
