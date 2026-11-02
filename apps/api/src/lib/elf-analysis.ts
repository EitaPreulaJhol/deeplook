import { entropy } from './entropy';

/**
 * Leitura de executavel Linux (ELF, item 168): cabecalho, segmentos, secoes, bibliotecas
 * e simbolos importados. So leitura, com limites: tudo o que vem do arquivo e conferido
 * contra o tamanho dele, e o arquivo pode mentir em qualquer campo.
 */

/** Secoes e segmentos lidos no maximo; o resto e ignorado. */
const MAX_SECTIONS_READ = 512;
const MAX_SEGMENTS = 256;
/** Secoes e bibliotecas mostradas. */
const MAX_SECTIONS = 64;
const MAX_NEEDED = 64;
/** Simbolos lidos (como os imports do PE). */
const MAX_SYMBOLS = 4096;
/** Bytes somados no calculo de entropia das secoes: secoes que se sobrepoem nao repetem o arquivo. */
const ENTROPY_BUDGET = 64 * 1024 * 1024;
/** Amostra de cada secao quando o orcamento acaba. */
const ENTROPY_SAMPLE = 64 * 1024;

export interface ElfSection {
  name: string;
  type: string;
  size: number;
  entropy: number;
}

export interface ElfInfo {
  class: 32 | 64;
  endian: 'little' | 'big';
  machine: string;
  type: string;
  entry: string;
  /** Carregador pedido (PT_INTERP), ex.: /lib64/ld-linux-x86-64.so.2. */
  interpreter: string | null;
  /** Sem tabela de simbolos completa (.symtab). */
  stripped: boolean;
  /** Sem carregador nem secao dinamica: nao depende de bibliotecas do sistema. */
  static: boolean;
  sections: ElfSection[];
  /** Bibliotecas exigidas (DT_NEEDED). */
  needed: string[];
  importedSymbols: number;
  suspiciousSymbols: string[];
  /** Segmentos carregados ao mesmo tempo gravaveis e executaveis. */
  rwxSegments: number;
  packer: string | null;
  alerts: string[];
}

export interface ElfResult {
  info: ElfInfo;
  /** Nomes dos simbolos importados, para a busca (item 171); nao vao na ficha. */
  symbols: string[];
}

const MACHINES: Record<number, string> = {
  2: 'SPARC',
  3: 'x86',
  8: 'MIPS',
  20: 'PowerPC',
  21: 'PowerPC 64',
  22: 'S/390',
  40: 'ARM',
  43: 'SPARC v9',
  62: 'x86-64',
  183: 'AArch64',
  243: 'RISC-V',
  258: 'LoongArch',
};

const SECTION_TYPES: Record<number, string> = {
  0: 'NULL',
  1: 'PROGBITS',
  2: 'SYMTAB',
  3: 'STRTAB',
  4: 'RELA',
  5: 'HASH',
  6: 'DYNAMIC',
  7: 'NOTE',
  8: 'NOBITS',
  9: 'REL',
  11: 'DYNSYM',
  14: 'INIT_ARRAY',
  15: 'FINI_ARRAY',
};

/** Chamadas que costumam aparecer em malware de Linux (nao provam nada sozinhas). */
const SUSPICIOUS_SYMBOLS = new Set([
  'ptrace',
  'execve',
  'execvp',
  'fexecve',
  'system',
  'popen',
  'daemon',
  'setsid',
  'setuid',
  'setgid',
  'prctl',
  'mprotect',
  'memfd_create',
  'dlopen',
  'dlsym',
  'inotify_add_watch',
  'connect',
  'bind',
  'listen',
  'accept',
  'getaddrinfo',
  'gethostbyname',
  'unlink',
  'kill',
]);

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const PT_INTERP = 3;
const PT_GNU_STACK = 0x6474e551;
const SHT_SYMTAB = 2;
const SHT_DYNAMIC = 6;
const SHT_DYNSYM = 11;
const SHT_NOBITS = 8;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_STRSZ = 10;

/** Le o ELF ou devolve null se nao for um (ou se o cabecalho nao fizer sentido). */
export function parseElf(buf: Buffer): ElfResult | null {
  if (buf.length < 52 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
  const cls = buf[4];
  const data = buf[5];
  if ((cls !== 1 && cls !== 2) || (data !== 1 && data !== 2)) return null;
  const is64 = cls === 2;
  const le = data === 1;
  if (is64 && buf.length < 64) return null;

  const fits = (o: number, n: number) => Number.isSafeInteger(o) && o >= 0 && o + n <= buf.length;
  const u16 = (o: number) => (fits(o, 2) ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : null);
  const u32 = (o: number) => (fits(o, 4) ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : null);
  /** Endereco ou tamanho: 4 ou 8 bytes; acima de 2^53 nao e um numero usavel (null). */
  const addr = (o: number): number | null => {
    if (!is64) return u32(o);
    if (!fits(o, 8)) return null;
    const v = le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o);
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  };
  /** Texto terminado em NUL, procurado so dentro de `max` bytes. */
  const cstr = (o: number, max = 256): string | null => {
    if (!fits(o, 1)) return null;
    const window = buf.subarray(o, Math.min(buf.length, o + max));
    const end = window.indexOf(0);
    return window.toString('latin1', 0, end < 0 ? window.length : end);
  };

  const alerts: string[] = [];
  const eType = u16(16)!;
  const eMachine = u16(18)!;
  const entry = addr(24);
  const phoff = addr(is64 ? 32 : 28);
  const shoff = addr(is64 ? 40 : 32);
  const phentsize = u16(is64 ? 54 : 42) ?? 0;
  let phnum = u16(is64 ? 56 : 44) ?? 0;
  const shentsize = u16(is64 ? 58 : 46) ?? 0;
  let shnum = u16(is64 ? 60 : 48) ?? 0;
  let shstrndx = u16(is64 ? 62 : 50) ?? 0;

  // Secoes: tabela pode faltar, estar fora do arquivo ou usar a numeracao estendida.
  const shSize = is64 ? 64 : 40;
  const sectionAt = (i: number) => (shoff ? shoff + i * shentsize : -1);
  const readSection = (i: number) => {
    const o = sectionAt(i);
    if (shentsize < shSize || !fits(o, shSize)) return null;
    return {
      name: u32(o)!,
      type: u32(o + 4)!,
      offset: addr(o + (is64 ? 24 : 16)),
      size: addr(o + (is64 ? 32 : 20)),
      link: u32(o + (is64 ? 40 : 24))!,
      info: u32(o + (is64 ? 44 : 28))!,
      entsize: addr(o + (is64 ? 56 : 36)),
    };
  };
  if (shoff && (shnum === 0 || shstrndx === 0xffff || phnum === 0xffff)) {
    const first = readSection(0);
    if (first) {
      if (shnum === 0) shnum = first.size ?? 0;
      if (shstrndx === 0xffff) shstrndx = first.link;
      if (phnum === 0xffff) phnum = first.info;
    }
  }
  const sections: NonNullable<ReturnType<typeof readSection>>[] = [];
  if (shoff && shnum) {
    if (shentsize < shSize || !fits(shoff, shSize)) alerts.push('tabela de seções fora do arquivo');
    for (let i = 0; i < Math.min(shnum, MAX_SECTIONS_READ); i++) {
      const s = readSection(i);
      if (!s) break;
      sections.push(s);
    }
    if (shnum > MAX_SECTIONS_READ)
      alerts.push(`${shnum} seções declaradas (lidas ${MAX_SECTIONS_READ})`);
  } else {
    alerts.push('sem tabela de seções (comum em malware e em binário empacotado)');
  }
  const names = sections[shstrndx];
  const sectionName = (nameOff: number) =>
    names && names.offset !== null && names.size !== null && nameOff < names.size
      ? (cstr(names.offset + nameOff, 64) ?? '').replace(/[^\x20-\x7e]/g, '')
      : '';

  // Segmentos (sempre presentes num executavel; a analise segue sem as secoes).
  const phSize = is64 ? 56 : 32;
  const segments: { type: number; flags: number; offset: number; vaddr: number; filesz: number }[] =
    [];
  if (phoff && phnum && phentsize >= phSize) {
    for (let i = 0; i < Math.min(phnum, MAX_SEGMENTS); i++) {
      const o = phoff + i * phentsize;
      if (!fits(o, phSize)) break;
      const type = u32(o)!;
      const flags = u32(o + (is64 ? 4 : 24))!;
      const offset = addr(o + (is64 ? 8 : 4));
      const vaddr = addr(o + (is64 ? 16 : 8));
      const filesz = addr(o + (is64 ? 32 : 16));
      if (offset === null || vaddr === null || filesz === null) continue;
      segments.push({ type, flags, offset, vaddr, filesz });
    }
  }
  const vaddrToOffset = (va: number) => {
    const seg = segments.find(
      (s) => s.type === PT_LOAD && va >= s.vaddr && va < s.vaddr + s.filesz,
    );
    return seg ? va - seg.vaddr + seg.offset : -1;
  };

  const interpSeg = segments.find((s) => s.type === PT_INTERP);
  const interpreter = interpSeg ? cstr(interpSeg.offset, Math.min(interpSeg.filesz, 256)) : null;
  const dynamicSeg = segments.find((s) => s.type === PT_DYNAMIC);
  const rwxSegments = segments.filter((s) => s.type === PT_LOAD && (s.flags & 3) === 3).length;
  if (rwxSegments) alerts.push('segmento gravável e executável');
  if (segments.some((s) => s.type === PT_GNU_STACK && s.flags & 1)) alerts.push('pilha executável');

  // Bibliotecas (DT_NEEDED): pela secao .dynamic ou, sem secoes, pelo segmento.
  const needed: string[] = [];
  const dynSection = sections.find((s) => s.type === SHT_DYNAMIC);
  const dynOffset = dynSection?.offset ?? dynamicSeg?.offset ?? null;
  const dynSize = dynSection?.size ?? dynamicSeg?.filesz ?? 0;
  if (dynOffset !== null) {
    const step = is64 ? 16 : 8;
    const entries: { tag: number; val: number }[] = [];
    for (let o = dynOffset; o + step <= dynOffset + Math.min(dynSize, 64 * 1024); o += step) {
      const tag = addr(o);
      const val = addr(o + step / 2);
      if (tag === null || val === null || tag === 0) break;
      entries.push({ tag, val });
    }
    const linked = dynSection ? sections[dynSection.link] : undefined;
    const strtabVa = entries.find((e) => e.tag === DT_STRTAB)?.val;
    const strOff = linked?.offset ?? (strtabVa !== undefined ? vaddrToOffset(strtabVa) : -1);
    const strSize = linked?.size ?? entries.find((e) => e.tag === DT_STRSZ)?.val ?? 0;
    for (const e of entries) {
      if (e.tag !== DT_NEEDED || needed.length >= MAX_NEEDED) continue;
      if (strOff === null || strOff < 0 || e.val >= strSize) continue;
      const lib = cstr(strOff + e.val, 128);
      if (lib) needed.push(lib.replace(/[^\x20-\x7e]/g, ''));
    }
  }

  // Simbolos importados (indefinidos na .dynsym).
  const symbols: string[] = [];
  const suspicious = new Set<string>();
  const dynsym = sections.find((s) => s.type === SHT_DYNSYM);
  if (dynsym && dynsym.offset !== null && dynsym.size !== null) {
    const symSize = is64 ? 24 : 16;
    const strs = sections[dynsym.link];
    const count = Math.min(Math.floor(dynsym.size / symSize), MAX_SYMBOLS);
    for (let i = 1; i < count; i++) {
      const o = dynsym.offset + i * symSize;
      if (!fits(o, symSize)) break;
      const nameOff = u32(o)!;
      const shndx = u16(o + (is64 ? 6 : 14))!;
      if (shndx !== 0 || !nameOff || !strs || strs.offset === null || strs.size === null) continue;
      if (nameOff >= strs.size) continue;
      const name = (cstr(strs.offset + nameOff, 128) ?? '').replace(/@.*$/, '');
      if (!name) continue;
      symbols.push(name);
      if (SUSPICIOUS_SYMBOLS.has(name)) suspicious.add(name);
    }
  }

  // Secoes com entropia, dentro do orcamento.
  let budget = ENTROPY_BUDGET;
  const shown: ElfSection[] = [];
  for (const s of sections.slice(1, MAX_SECTIONS + 1)) {
    let value = 0;
    if (s.type !== SHT_NOBITS && s.offset !== null && s.size !== null && s.offset < buf.length) {
      const span = Math.min(s.size, buf.length - s.offset, budget > 0 ? budget : ENTROPY_SAMPLE);
      budget -= span;
      value = entropy(buf, s.offset, s.offset + span);
    }
    shown.push({
      name: sectionName(s.name),
      type: SECTION_TYPES[s.type] ?? `0x${s.type.toString(16)}`,
      size: s.size ?? 0,
      entropy: value,
    });
  }

  const head = buf.toString('latin1', 0, Math.min(buf.length, 4096));
  const packer = head.includes('UPX!') || shown.some((s) => /^UPX\d$/.test(s.name)) ? 'UPX' : null;
  if (packer) alerts.push(`empacotado com ${packer}`);

  const hasInterp = Boolean(interpSeg);
  const type =
    eType === 1
      ? 'objeto realocável'
      : eType === 2
        ? 'executável'
        : eType === 3
          ? hasInterp
            ? 'executável (PIE)'
            : 'biblioteca compartilhada'
          : eType === 4
            ? 'core dump'
            : `outro (${eType})`;
  return {
    info: {
      class: is64 ? 64 : 32,
      endian: le ? 'little' : 'big',
      machine: MACHINES[eMachine] ?? `0x${eMachine.toString(16)}`,
      type,
      entry: entry !== null ? `0x${entry.toString(16)}` : '?',
      interpreter: interpreter ? interpreter.replace(/[^\x20-\x7e]/g, '') : null,
      stripped: !sections.some((s) => s.type === SHT_SYMTAB),
      static: !hasInterp && !dynamicSeg && !dynSection,
      sections: shown,
      needed,
      importedSymbols: symbols.length,
      suspiciousSymbols: [...suspicious].sort(),
      rwxSegments,
      packer,
      alerts,
    },
    symbols,
  };
}
