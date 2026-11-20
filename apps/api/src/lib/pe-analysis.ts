import { createHash } from 'node:crypto';

import { entropy } from './entropy';
import { ascii, detectType } from './file-type';
import { iconHash } from './icon-hash';
import { analyzeAuthenticode, authentihash, type SignatureInfo } from './pe-authenticode';
import { analyzeDebug, type PeDebug, richTool } from './pe-debug';
import { analyzeDotnet, type DotnetInfo } from './pe-dotnet';
// Ordinais conhecidos do ws2_32, wsock32 e oleaut32, copiados do `ordlookup` do pefile (MIT):
// o imphash do pefile (e do VirusTotal) troca o ordinal pelo nome, e o nosso tem de bater.
import ORDINALS from './pe-ordinals.json';
import { mainIconImage } from './pe-resource-file';
import { analyzeResources, type PeResource } from './pe-resources';

/**
 * Executavel do Windows (PE): cabecalhos, secoes, imports, imphash, Rich header, exports, TLS,
 * overlay, checksum, recursos, assinatura e .NET (item 7.1). Le so bytes, com checagem de
 * limites em cada acesso: o arquivo pode ter sido montado para travar ou derrubar o parser.
 */

/**
 * Versao da analise de PE gravada em `pe.rev`: o pe-backfill reanalisa em segundo plano o que foi
 * analisado numa versao anterior (1: item 7.1; 2: diretorio de debug e ferramentas do Rich header,
 * plans/analise-estatica-ampliada, item 1; 3: recursos .NET, item 30; 4: authentihash, exphash e
 * hash do icone, item 2; 5: Nuitka, py2exe e cx_Freeze, item 15).
 */
export const PE_REVISION = 5;

const MAX_DLLS = 64;
const MAX_FUNCTIONS = 4096;
/** Nomes de funcao guardados por DLL (o total continua contado). */
const MAX_NAMES_PER_DLL = 300;
const MAX_EXPORTS_LISTED = 300;
/** Entradas lidas da tabela de exports (nomes e enderecos): o resto so e contado ate aqui. */
const MAX_EXPORT_SCAN = 65_536;
const MAX_TLS_CALLBACKS = 64;
/** Bytes somados na entropia das secoes do PE (item 168), e a amostra depois disso. */
const ENTROPY_BUDGET = 64 * 1024 * 1024;
const ENTROPY_SAMPLE = 64 * 1024;
/** Checksum do cabecalho so e recalculado ate este tamanho (o upload vai ate 200 MB). */
const CHECKSUM_MAX_BYTES = 512 * 1024 * 1024;

export interface PeSection {
  name: string;
  virtualSize: number;
  rawSize: number;
  entropy: number;
  /** Permissoes da secao: R, W e X (item 7.1). */
  flags?: string;
}

export interface PeImport {
  dll: string;
  functions: number;
  /** Funcoes na ordem do arquivo; ordinal sem nome conhecido vira `ordN` (item 7.1). */
  names?: string[];
}

export interface PeAlert {
  level: 'high' | 'medium' | 'info';
  text: string;
}

export interface RichEntry {
  /** Produto (ferramenta do Visual Studio que gerou os objetos). */
  product: number;
  build: number;
  count: number;
  /** Ferramenta ([C], [C++], [LNK], [ASM], [RES]...) e versao do Visual Studio (richprint). */
  tool?: string | null;
  version?: string | null;
}

export interface RichInfo {
  /** MD5 dos bytes decodificados, como o `get_rich_header_hash` do pefile. */
  hash: string;
  /** A chave confere com o cabecalho DOS e as entradas (falso: editado ou copiado). */
  checksumValid: boolean;
  entries: RichEntry[];
  /** Versao do linker (a entrada [LNK]): o Visual Studio que montou o executavel. */
  linker?: string | null;
}

export interface PeExports {
  /** Nome que a DLL declara para si. */
  dll: string | null;
  total: number;
  symbols: { ordinal: number; name: string | null; forwarder: string | null }[];
  truncated: boolean;
}

export interface PeOverlay {
  offset: number;
  size: number;
  entropy: number;
  /** Tipo do conteudo anexado, pela assinatura (ex.: ZIP, PE). */
  type: string | null;
}

export interface PeInfo {
  machine: string;
  is64: boolean;
  isDll: boolean;
  subsystem: string;
  /** Data de compilacao declarada no cabecalho (pode ser forjada). */
  compiledAt: string | null;
  sections: PeSection[];
  imports: PeImport[];
  suspiciousImports: string[];
  packer: string | null;
  // Campos do item 7.1: opcionais porque as amostras analisadas antes nao os tem.
  /** Hash das importacoes (o mesmo do pefile e do VirusTotal); null sem imports ou incompleto. */
  imphash?: string | null;
  rich?: RichInfo | null;
  exports?: PeExports | null;
  entryPoint?: { rva: number; section: string | null } | null;
  tlsCallbacks?: number;
  overlay?: PeOverlay | null;
  /** Checksum do cabecalho e o recalculado (0 declarado: o linker nao preencheu). */
  checksum?: { declared: number; computed: number | null };
  resources?: PeResource[];
  resourcesTruncated?: boolean;
  /** StringFileInfo do recurso de versao (empresa, produto, nome original...). */
  version?: Record<string, string> | null;
  /** Manifesto embutido: nivel de execucao pedido. */
  manifest?: { executionLevel: string | null; uiAccess: boolean } | null;
  signature?: SignatureInfo | null;
  dotnet?: DotnetInfo | null;
  /** Diretorio de debug: PDB, tipos de entrada e pistas (plans/analise-estatica-ampliada, item 1). */
  debug?: PeDebug | null;
  /** TimeDateStamp de cada lugar que o grava (segundos; null quando nao ha ou e zero). */
  timestamps?: {
    header: number | null;
    debug: number | null;
    exports: number | null;
    resources: number | null;
  };
  alerts?: PeAlert[];
  /**
   * Hashes que ligam amostras (plans/analise-estatica-ampliada, item 2): o authentihash (SHA-256 do
   * Authenticode, igual com ou sem assinatura), o exphash (MD5 das exportacoes, como o do pefile) e
   * o dHash de 64 bits do icone principal.
   */
  authentihash?: string;
  exphash?: string | null;
  icon?: { hash: string; width: number; height: number } | null;
  /** Versao da analise (PE_REVISION); ausente nas analises anteriores ao item 1. */
  rev?: number;
}

/** Secao como esta no arquivo, para converter RVA em posicao. */
export interface RawSection {
  name: string;
  va: number;
  virtualSize: number;
  rawPtr: number;
  rawSize: number;
  characteristics: number;
}

/** Leitura do PE ja localizado, compartilhada com recursos, assinatura e .NET. */
export interface PeImage {
  buf: Buffer;
  is64: boolean;
  sections: RawSection[];
  /** Posicao no arquivo de um RVA, ou -1 se ele nao esta nos bytes do arquivo. */
  rvaToOffset(rva: number): number;
  /** Diretorio de dados (0 = exports, 1 = imports, 2 = recursos, 4 = assinatura...). */
  dir(index: number): { rva: number; size: number } | null;
  /** Posicao do diretorio de dados no arquivo (a assinatura o exclui do hash). */
  dirEntryOffset(index: number): number;
  checksumOffset: number;
  u16(offset: number): number | null;
  u32(offset: number): number | null;
  cstr(offset: number, max?: number): string | null;
}

const MACHINES: Record<number, string> = {
  0x14c: 'x86 (32 bits)',
  0x8664: 'x64 (64 bits)',
  0x1c0: 'ARM',
  0x1c4: 'ARM Thumb-2',
  0xaa64: 'ARM64',
};
const SUBSYSTEMS: Record<number, string> = {
  1: 'Nativo (driver)',
  2: 'Janelas (GUI)',
  3: 'Console',
  9: 'Windows CE',
  10: 'EFI',
};
const SUSPICIOUS_IMPORTS = [
  'VirtualAllocEx',
  'WriteProcessMemory',
  'CreateRemoteThread',
  'NtUnmapViewOfSection',
  'SetWindowsHookExA',
  'SetWindowsHookExW',
  'GetAsyncKeyState',
  'URLDownloadToFileA',
  'URLDownloadToFileW',
  'WinExec',
  'ShellExecuteA',
  'ShellExecuteW',
  'InternetOpenA',
  'InternetOpenW',
  'InternetReadFile',
  'CryptEncrypt',
  'IsDebuggerPresent',
  'CheckRemoteDebuggerPresent',
  'RegSetValueExA',
  'RegSetValueExW',
  'AdjustTokenPrivileges',
  'OpenProcess',
  'QueueUserAPC',
];
const PACKER_SECTIONS: [RegExp, string][] = [
  [/^UPX\d?$/i, 'UPX'],
  [/^\.aspack$/i, 'ASPack'],
  [/^\.petite$/i, 'Petite'],
  [/^\.themida$/i, 'Themida'],
  [/^\.vmp\d$/i, 'VMProtect'],
  [/^\.mpress\d$/i, 'MPRESS'],
];
/**
 * Codigo de entrada do descompactador do UPX (null = qualquer byte), conferido nos binarios que o
 * upx 4.2 gera para x86 e x64 (tests/fixtures/pe). Pega o UPX com as secoes renomeadas e a marca
 * `UPX!` apagada, o disfarce mais comum.
 */
const PACKER_ENTRY: { name: string; bytes: (number | null)[] }[] = [
  {
    name: 'UPX',
    bytes: [0x60, 0xbe, null, null, null, null, 0x8d, 0xbe, null, null, null, null, 0x57],
  },
  {
    name: 'UPX',
    bytes: [0x53, 0x56, 0x57, 0x55, 0x48, 0x8d, 0x35, null, null, null, null, 0x48, 0x8d, 0xbe],
  },
];
/** Bytes do entry point onde se procura o codigo do empacotador (a DLL tem um preambulo). */
const PACKER_ENTRY_WINDOW = 64;

/** Data fixa que o Delphi grava no cabecalho (19/06/1992), sem relacao com a compilacao. */
const DELPHI_TIMESTAMP = 0x2a425e19;
/** Diferenca aceita entre as datas do linker (um build lento passa de minutos). */
const STAMP_TOLERANCE_S = 24 * 3600;

const SCN_EXECUTE = 0x20000000;
const SCN_READ = 0x40000000;
const SCN_WRITE = 0x80000000;

const ORDINAL_NAMES = ORDINALS as Record<string, Record<string, string>>;

/** Nome que o pefile da a uma importacao por ordinal (tabela conhecida ou `ordN`). */
function ordinalName(dll: string, ordinal: number): string {
  return ORDINAL_NAMES[dll.toLowerCase()]?.[String(ordinal)] ?? `ord${ordinal}`;
}

/** imphash: `dll.funcao` em minusculas, na ordem do arquivo, como o `get_imphash` do pefile. */
/**
 * Executavel feito de um programa Python (plans/analise-estatica-ampliada, item 15) por ferramenta
 * que o desempacotador nao abre: o analista sabe onde esta o codigo (ou que nao ha bytecode).
 */
export const PYTHON_PACKERS = {
  nuitka: 'Compilado com Nuitka: o Python vira C, não há bytecode para descompilar.',
  py2exe:
    'Empacotado com py2exe: o bytecode fica no recurso PYTHONSCRIPT (baixe-o pela lista de recursos).',
  cxfreeze: 'Empacotado com cx_Freeze: os módulos ficam no library.zip, ao lado do executável.',
} as const;

export function pythonPacker(buf: Buffer): keyof typeof PYTHON_PACKERS | null {
  const has = (s: string) => buf.includes(s, 0, 'latin1');
  if (has('NUITKA_ONEFILE_PARENT') || has('__nuitka_') || has('Nuitka')) return 'nuitka';
  if (has('PYTHONSCRIPT') && (has('PY2EXE_VERBOSE') || has('py2exe'))) return 'py2exe';
  if (has('cx_Freeze') || (has('__startup__') && has('cx_'))) return 'cxfreeze';
  return null;
}

export function imphash(imports: { dll: string; names: string[] }[]): string | null {
  const parts: string[] = [];
  for (const { dll, names } of imports) {
    let lib = dll.toLowerCase();
    const dot = lib.lastIndexOf('.');
    if (dot >= 0 && ['ocx', 'sys', 'dll'].includes(lib.slice(dot + 1))) lib = lib.slice(0, dot);
    for (const fn of names) parts.push(`${lib}.${fn.toLowerCase()}`);
  }
  return parts.length ? createHash('md5').update(parts.join(',')).digest('hex') : null;
}

/** Funcoes importadas abaixo disto: tabela generica demais para ligar amostras pelo imphash. */
const IMPHASH_MIN_FUNCTIONS = 10;

/**
 * Hashes do PE que ligam amostras (colunas `imphash` e `richHash` da Entry). O imphash so vale
 * com tabela propria: todo .NET importa so `mscoree.dll!_CorExeMain`, e o empacotador deixa uma
 * funcao por DLL, entao essas tabelas ligariam amostras sem relacao nenhuma.
 */
export function relationHashes(pe: PeInfo | null | undefined): {
  imphash: string | null;
  richHash: string | null;
} {
  if (!pe) return { imphash: null, richHash: null };
  const functions = pe.imports.reduce((sum, i) => sum + i.functions, 0);
  return {
    imphash: pe.imphash && !pe.dotnet && functions >= IMPHASH_MIN_FUNCTIONS ? pe.imphash : null,
    richHash: pe.rich?.hash ?? null,
  };
}

const rol = (v: number, n: number) => {
  const s = n & 31;
  return s ? ((v << s) | (v >>> (32 - s))) >>> 0 : v >>> 0;
};

/** Rich header (so binarios do Visual Studio o tem), no mesmo recorte do pefile. */
export function parseRich(buf: Buffer, peOffset: number): RichInfo | null {
  // Como o pefile: "Rich" procurado de 0x80 ate o cabecalho opcional, e a chave tirada do
  // primeiro dword alinhado (a partir de 0x80) que diz "Rich".
  const limit = Math.min(peOffset + 24, buf.length);
  if (limit <= 0x80) return null;
  const at = buf.subarray(0, limit).indexOf('Rich', 0x80, 'latin1');
  if (at < 0 || at + 8 > buf.length) return null;
  const dataEnd = 0x80 + Math.floor((at + 8 - 0x80) / 4) * 4;
  let marker = -1;
  for (let o = 0x80; o + 4 <= dataEnd; o += 4) {
    if (buf.readUInt32LE(o) === 0x68636952) {
      marker = o;
      break;
    }
  }
  if (marker < 0 || marker + 8 > dataEnd) return null;
  const key = buf.readUInt32LE(marker + 4);
  const keyBytes = buf.subarray(marker + 4, marker + 8);
  const raw = buf.subarray(0x80, at);
  const clear = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) clear[i] = raw[i] ^ keyBytes[i % 4];
  const entries: RichEntry[] = [];
  const pairs: [number, number][] = [];
  for (let o = 0x80 + 16; o + 8 <= marker && entries.length < 512; o += 8) {
    const compId = (buf.readUInt32LE(o) ^ key) >>> 0;
    const count = (buf.readUInt32LE(o + 4) ^ key) >>> 0;
    pairs.push([compId, count]);
    const product = compId >>> 16;
    const build = compId & 0xffff;
    entries.push({ product, build, count, ...richTool(product, build) });
  }
  // Chave do linker da Microsoft: soma rotacionada do cabecalho DOS (sem o e_lfanew) e dos pares.
  let check = 0x80;
  for (let i = 0; i < 0x80; i++) {
    if (i >= 0x3c && i < 0x40) continue;
    check = (check + rol(buf[i], i)) >>> 0;
  }
  for (const [compId, count] of pairs) check = (check + rol(compId, count)) >>> 0;
  const dans = marker >= 0x80 + 16 && (buf.readUInt32LE(0x80) ^ key) >>> 0 === 0x536e6144;
  return {
    hash: createHash('md5').update(clear).digest('hex'),
    checksumValid: dans && check === key,
    entries,
    linker: entries.find((e) => e.tool === 'LNK')?.version ?? null,
  };
}

/** Checksum do cabecalho opcional, igual ao `generate_checksum` do pefile (e ao do Windows). */
export function peChecksum(buf: Buffer, checksumOffset: number): number | null {
  if (buf.length > CHECKSUM_MAX_BYTES) return null;
  const skip = Math.floor(checksumOffset / 4);
  const whole = Math.floor(buf.length / 4);
  // Uint32Array (little-endian, como o x86) e bem mais rapido que readUInt32LE em 50 M de dwords;
  // so copia se o Buffer nao estiver alinhado.
  const aligned = buf.byteOffset % 4 === 0 ? buf : Buffer.from(buf);
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, whole);
  // O "vai-um" do pefile a cada soma ((sum & 0xffffffff) + (sum >> 32)) e a soma modulo 2^32 - 1,
  // que so da 0 se todos os dwords forem 0 (depois do primeiro positivo, nunca volta a 0). Somar
  // em blocos de 2^20 dwords cabe exato num double e evita o desvio a cada dword.
  const M = 0xffffffff;
  let acc = 0;
  let nonzero = false;
  for (let start = 0; start < whole; start += 1 << 20) {
    const end = Math.min(whole, start + (1 << 20));
    let c = 0;
    for (let i = start; i < end; i++) c += words[i];
    if (skip >= start && skip < end) c -= words[skip];
    if (c > 0) nonzero = true;
    acc = (acc + c) % M;
  }
  const rest = buf.length % 4;
  if (rest && whole !== skip) {
    let last = 0;
    for (let i = 0; i < rest; i++) last |= buf[whole * 4 + i] << (8 * i);
    if (last) nonzero = true;
    acc = (acc + (last >>> 0)) % M;
  }
  let sum = !nonzero ? 0 : acc === 0 ? M : acc;
  sum = (sum & 0xffff) + Math.floor(sum / 0x10000);
  sum = sum + Math.floor(sum / 0x10000);
  return (sum & 0xffff) + buf.length;
}

const sectionFlags = (c: number) =>
  `${c & SCN_READ ? 'R' : '-'}${c & SCN_WRITE ? 'W' : '-'}${c & SCN_EXECUTE ? 'X' : '-'}`;

function matchesAt(buf: Buffer, offset: number, bytes: (number | null)[]): boolean {
  if (offset < 0 || offset + bytes.length > buf.length) return false;
  return bytes.every((b, i) => b === null || buf[offset + i] === b);
}

/** Cabecalho COFF e opcional ja lidos por openPe. */
interface PeHeader {
  peOff: number;
  machine: number;
  timestamp: number | null;
  characteristics: number;
  opt: number;
  optSize: number;
  entryRva: number;
  subsystem: number | null;
  dirCount: number;
}

/**
 * So os cabecalhos e a tabela de secoes, sem nada caro (entropia, checksum): o que a analise e as
 * rotas que extraem um pedaco do PE (recursos, item 30) precisam para converter RVA em posicao.
 */
export function openPe(buf: Buffer): { image: PeImage; header: PeHeader } | null {
  const u16 = (o: number) => (o >= 0 && o + 2 <= buf.length ? buf.readUInt16LE(o) : null);
  const u32 = (o: number) => (o >= 0 && o + 4 <= buf.length ? buf.readUInt32LE(o) : null);
  // NUL procurado so dentro de `max` bytes (item 168): antes, o resto do arquivo inteiro.
  const cstr = (o: number, max = 256) => {
    if (o < 0 || o >= buf.length) return null;
    const window = buf.subarray(o, Math.min(buf.length, o + max));
    const end = window.indexOf(0);
    return window.toString('latin1', 0, end < 0 ? window.length : end);
  };

  const peOff = u32(0x3c);
  if (peOff === null || !ascii(buf, 'PE\0\0', peOff)) return null;
  const coff = peOff + 4;
  const machine = u16(coff);
  const nSections = u16(coff + 2);
  const timestamp = u32(coff + 4);
  const optSize = u16(coff + 16);
  const characteristics = u16(coff + 18);
  if (machine === null || nSections === null || optSize === null || characteristics === null)
    return null;
  const opt = coff + 20;
  const magic = u16(opt);
  const is64 = magic === 0x20b;
  if (magic !== 0x10b && magic !== 0x20b) return null;
  const dirsAt = opt + (is64 ? 112 : 96);
  const dirCount = Math.min(u32(opt + (is64 ? 108 : 92)) ?? 0, 16);
  const sizeOfHeaders = u32(opt + 60) ?? 0;

  const sections: RawSection[] = [];
  const secTable = opt + optSize;
  for (let i = 0; i < Math.min(nSections, 96); i++) {
    const s = secTable + i * 40;
    const name = (cstr(s, 8) ?? '').replace(/[^\x20-\x7e]/g, '');
    const virtualSize = u32(s + 8);
    const va = u32(s + 12);
    const rawSize = u32(s + 16);
    const rawPtr = u32(s + 20);
    const chars = u32(s + 36);
    if (
      virtualSize === null ||
      va === null ||
      rawSize === null ||
      rawPtr === null ||
      chars === null
    )
      break;
    sections.push({ name, virtualSize, rawSize, va, rawPtr, characteristics: chars });
  }
  const sectionOf = (rva: number) =>
    sections.find((s) => rva >= s.va && rva < s.va + Math.max(s.virtualSize, s.rawSize));
  const rvaToOffset = (rva: number) => {
    const sec = sectionOf(rva);
    if (!sec) return rva < sizeOfHeaders && rva < buf.length ? rva : -1;
    // Parte so virtual (zerada na memoria) nao esta no arquivo.
    if (rva - sec.va >= sec.rawSize) return -1;
    const off = rva - sec.va + sec.rawPtr;
    return off < buf.length ? off : -1;
  };
  const dir = (index: number) => {
    if (index >= dirCount) return null;
    const rva = u32(dirsAt + index * 8);
    const size = u32(dirsAt + index * 8 + 4);
    return rva && size ? { rva, size } : null;
  };
  return {
    image: {
      buf,
      is64,
      sections,
      rvaToOffset,
      dir,
      dirEntryOffset: (index) => dirsAt + index * 8,
      checksumOffset: opt + 64,
      u16,
      u32,
      cstr,
    },
    header: {
      peOff,
      machine,
      timestamp,
      characteristics,
      opt,
      optSize,
      entryRva: u32(opt + 16) ?? 0,
      subsystem: u16(opt + 68),
      dirCount,
    },
  };
}

/** Le o PE com checagem de limites em cada acesso (arquivo pode ser hostil). */
export function parsePe(buf: Buffer, filename?: string | null): PeInfo | null {
  const opened = openPe(buf);
  if (!opened) return null;
  const { image } = opened;
  const {
    peOff,
    machine,
    timestamp,
    characteristics,
    opt,
    optSize,
    entryRva,
    subsystem,
    dirCount,
  } = opened.header;
  const { is64, u16, u32, cstr, rvaToOffset, dir } = image;

  // Orcamento de entropia (item 168): 96 secoes apontando para o arquivo inteiro releriam
  // tudo 96 vezes; acabado o orcamento, cada secao entra por uma amostra do comeco.
  let budget = ENTROPY_BUDGET;
  const sections: (PeSection & RawSection)[] = image.sections.map((s) => {
    const span = Math.min(s.rawSize, buf.length - s.rawPtr, budget > 0 ? budget : ENTROPY_SAMPLE);
    if (s.rawPtr < buf.length) budget -= span;
    return {
      ...s,
      entropy: s.rawPtr < buf.length ? entropy(buf, s.rawPtr, s.rawPtr + span) : 0,
      flags: sectionFlags(s.characteristics),
    };
  });
  const sectionOf = (rva: number) =>
    sections.find((s) => rva >= s.va && rva < s.va + Math.max(s.virtualSize, s.rawSize));

  // ---------------------------------------------------------------- imports e imphash
  const imports: PeImport[] = [];
  const named: { dll: string; names: string[] }[] = [];
  const suspicious = new Set<string>();
  const allNames = new Set<string>();
  let totalFunctions = 0;
  let complete = true;
  const importDir = dir(1);
  if (importDir) {
    let desc = rvaToOffset(importDir.rva);
    let i = 0;
    for (; desc >= 0 && i < MAX_DLLS; i++, desc += 20) {
      const original = u32(desc);
      const nameRva = u32(desc + 12);
      const first = u32(desc + 16);
      if (!nameRva || (original === 0 && first === 0)) break;
      const dll = cstr(rvaToOffset(nameRva), 128);
      if (!dll) break;
      let thunk = rvaToOffset(original || first || 0);
      const names: string[] = [];
      let functions = 0;
      const step = is64 ? 8 : 4;
      for (;;) {
        if (thunk < 0) break;
        if (totalFunctions >= MAX_FUNCTIONS) {
          complete = false;
          break;
        }
        const lo = u32(thunk);
        const hi = is64 ? u32(thunk + 4) : 0;
        if (lo === null || hi === null || (lo === 0 && hi === 0)) break;
        const byOrdinal = is64 ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
        let fn: string;
        if (byOrdinal) {
          fn = ordinalName(dll, lo & 0xffff);
        } else {
          const at = rvaToOffset(lo & 0x7fffffff);
          const read = at >= 0 ? cstr(at + 2, 256) : null;
          if (!read) {
            // Nome ilegivel: o imphash nao seria o do pefile.
            complete = false;
            break;
          }
          fn = read;
          if (SUSPICIOUS_IMPORTS.includes(fn)) suspicious.add(fn);
        }
        names.push(fn);
        allNames.add(fn);
        functions++;
        totalFunctions++;
        thunk += step;
      }
      imports.push({
        dll: dll.toLowerCase(),
        functions,
        names: names.slice(0, MAX_NAMES_PER_DLL),
      });
      named.push({ dll, names });
    }
    if (i >= MAX_DLLS) complete = false;
  }

  // ---------------------------------------------------------------- exports
  let exports: PeExports | null = null;
  // Nomes na ordem da tabela de nomes, como o get_exphash do pefile os percorre.
  const exportNames: string[] = [];
  const exportDir = dir(0);
  const exportAt = exportDir ? rvaToOffset(exportDir.rva) : -1;
  if (exportDir && exportAt >= 0) {
    const nameRva = u32(exportAt + 12) ?? 0;
    const base = u32(exportAt + 16) ?? 0;
    const nFunctions = Math.min(u32(exportAt + 20) ?? 0, MAX_EXPORT_SCAN);
    const nNames = Math.min(u32(exportAt + 24) ?? 0, MAX_EXPORT_SCAN);
    const fnTable = rvaToOffset(u32(exportAt + 28) ?? 0);
    const nameTable = rvaToOffset(u32(exportAt + 32) ?? 0);
    const ordTable = rvaToOffset(u32(exportAt + 36) ?? 0);
    const nameOf = new Map<number, string>();
    if (nameTable >= 0 && ordTable >= 0) {
      for (let i = 0; i < nNames; i++) {
        const index = u16(ordTable + i * 2);
        const rva = u32(nameTable + i * 4);
        if (index === null || rva === null) break;
        const name = cstr(rvaToOffset(rva), 256);
        if (name) exportNames.push(name);
        if (name && !nameOf.has(index)) nameOf.set(index, name);
      }
    }
    const symbols: PeExports['symbols'] = [];
    let total = 0;
    if (fnTable >= 0) {
      for (let i = 0; i < nFunctions; i++) {
        const rva = u32(fnTable + i * 4);
        if (rva === null) break;
        if (!rva) continue;
        total++;
        if (symbols.length >= MAX_EXPORTS_LISTED) continue;
        const forwards = rva >= exportDir.rva && rva < exportDir.rva + exportDir.size;
        symbols.push({
          ordinal: base + i,
          name: nameOf.get(i) ?? null,
          forwarder: forwards ? cstr(rvaToOffset(rva), 256) : null,
        });
      }
    }
    exports = {
      dll: nameRva ? cstr(rvaToOffset(nameRva), 256) : null,
      total,
      symbols,
      truncated: total > symbols.length,
    };
  }

  // ---------------------------------------------------------------- TLS callbacks
  let tlsCallbacks = 0;
  const tlsDir = dir(9);
  const tlsAt = tlsDir ? rvaToOffset(tlsDir.rva) : -1;
  if (tlsAt >= 0) {
    const imageBase = is64
      ? opt + 32 <= buf.length
        ? buf.readBigUInt64LE(opt + 24)
        : null
      : BigInt(u32(opt + 28) ?? 0);
    const readPtr = (o: number): bigint | null =>
      is64
        ? o >= 0 && o + 8 <= buf.length
          ? buf.readBigUInt64LE(o)
          : null
        : u32(o) === null
          ? null
          : BigInt(u32(o)!);
    const callbacksVa = readPtr(tlsAt + (is64 ? 24 : 12));
    if (imageBase !== null && callbacksVa && callbacksVa > imageBase) {
      let at = rvaToOffset(Number(callbacksVa - imageBase));
      while (at >= 0 && tlsCallbacks < MAX_TLS_CALLBACKS) {
        const ptr = readPtr(at);
        if (!ptr) break;
        tlsCallbacks++;
        at += is64 ? 8 : 4;
      }
    }
  }

  // ---------------------------------------------------------------- overlay
  // Mesmo recorte do `get_overlay_data_start_offset` do pefile, com uma diferenca: a tabela da
  // assinatura nao conta como dado anexado (o pefile a conta, e todo binario assinado teria overlay).
  let end = opt + optSize <= buf.length ? opt + optSize : 0;
  for (const s of sections)
    if (s.rawPtr + s.rawSize <= buf.length) end = Math.max(end, s.rawPtr + s.rawSize);
  for (let i = 0; i < dirCount; i++) {
    const d = dir(i);
    if (i === 4 || !d) continue;
    const at = rvaToOffset(d.rva);
    if (at >= 0 && at + d.size <= buf.length) end = Math.max(end, at + d.size);
  }
  let overlay: PeOverlay | null = null;
  const cert = dir(4);
  if (buf.length > end) {
    let from = end;
    let size = buf.length - end;
    if (cert && cert.rva >= end && cert.rva + cert.size <= buf.length) {
      size -= cert.size;
      if (cert.rva === from) from += cert.size;
    }
    if (size > 0) {
      const sample = buf.subarray(from, from + Math.min(size, 16 * 1024 * 1024));
      overlay = {
        offset: from,
        size,
        entropy: entropy(sample, 0, sample.length),
        type: detectType(sample)?.label ?? null,
      };
    }
  }

  // ---------------------------------------------------------------- recursos, assinatura, .NET
  const res = analyzeResources(image);
  const debug = analyzeDebug(image);
  const signature = analyzeAuthenticode(image);
  const net = analyzeDotnet(image);
  const dotnet = net?.info ?? null;

  // ---------------------------------------------------------------- empacotador e anomalias
  const entrySection = entryRva ? (sectionOf(entryRva) ?? null) : null;
  const entryAt = entryRva ? rvaToOffset(entryRva) : -1;
  let packer =
    sections.map((s) => PACKER_SECTIONS.find(([re]) => re.test(s.name))?.[1]).find(Boolean) ?? null;
  const firstRaw = Math.min(...sections.map((s) => s.rawPtr || Infinity), buf.length);
  if (!packer) {
    const head = buf.subarray(0, Math.min(buf.length, firstRaw + 0x1000));
    if (head.includes('UPX!', 0, 'latin1')) packer = 'UPX';
  }
  if (!packer && entryAt >= 0) {
    for (let o = entryAt; o < entryAt + PACKER_ENTRY_WINDOW && !packer; o++) {
      packer = PACKER_ENTRY.find((p) => matchesAt(buf, o, p.bytes))?.name ?? null;
    }
  }

  const alerts: PeAlert[] = [];
  const python = pythonPacker(buf);
  if (python) alerts.push({ level: 'info', text: PYTHON_PACKERS[python] });
  if (signature?.error) {
    alerts.push({
      level: 'medium',
      text: `Assinatura presente, mas não conferida: ${signature.error}`,
    });
  } else if (signature?.digestMatches === false) {
    alerts.push({
      level: 'high',
      text: 'A assinatura não confere com o conteúdo: o arquivo foi alterado depois de assinado.',
    });
  } else if (signature && !signature.signatureValid) {
    alerts.push({
      level: 'high',
      text: 'A assinatura digital é inválida (não confere com o certificado).',
    });
  }
  if (entryRva && !entrySection) {
    alerts.push({ level: 'high', text: 'O ponto de entrada está fora de todas as seções.' });
  } else if (entrySection && !(entrySection.characteristics & SCN_EXECUTE)) {
    alerts.push({
      level: 'high',
      text: `O ponto de entrada está na seção ${entrySection.name || '(sem nome)'}, que não é executável.`,
    });
  } else if (
    entrySection &&
    sections.length > 1 &&
    entrySection === sections[sections.length - 1] &&
    !packer
  ) {
    alerts.push({
      level: 'medium',
      text: `O ponto de entrada está na última seção (${entrySection.name || 'sem nome'}): comum em código injetado ou empacotado.`,
    });
  }
  if (packer)
    alerts.push({
      level: 'medium',
      text: `Empacotado com ${packer}: o código real só aparece ao executar.`,
    });
  const wx = sections.filter(
    (s) => s.characteristics & SCN_WRITE && s.characteristics & SCN_EXECUTE,
  );
  if (wx.length) {
    alerts.push({
      level: 'medium',
      text: `${wx.length > 1 ? 'Seções graváveis e executáveis' : 'Seção gravável e executável'}: ${wx
        .map((s) => s.name || '(sem nome)')
        .join(', ')}. O código pode se reescrever na memória.`,
    });
  }
  const loaders = ['LoadLibraryA', 'LoadLibraryW', 'LoadLibraryExA', 'LoadLibraryExW'];
  if (!dotnet && totalFunctions === 0 && importDir === null) {
    alerts.push({
      level: 'medium',
      text: 'Não importa nenhuma função: resolve tudo sozinho na execução.',
    });
  } else if (
    // Com empacotador reconhecido, a tabela minima ja esta explicada.
    !packer &&
    !dotnet &&
    totalFunctions <= 12 &&
    allNames.has('GetProcAddress') &&
    loaders.some((l) => allNames.has(l))
  ) {
    alerts.push({
      level: 'medium',
      text: `Só ${totalFunctions} funções importadas, com GetProcAddress e LoadLibrary: as demais são resolvidas na execução.`,
    });
  }
  // Datas gravadas pelo linker em mais de um lugar (item 1): o cabecalho e o mais facil de
  // trocar, e a diferenca denuncia a troca (timestomping). Compilacao reprodutivel (REPRO) grava
  // um hash no lugar da data, e o Delphi grava sempre a mesma data no cabecalho.
  const stampAt = (o: number) => {
    const v = o >= 0 ? u32(o) : null;
    return v && v !== 0xffffffff ? v : null;
  };
  const resourceDir = dir(2);
  const timestamps = {
    header: timestamp || null,
    debug: debug?.timestamp ?? null,
    exports: exportAt >= 0 ? stampAt(exportAt + 4) : null,
    resources: resourceDir ? stampAt(rvaToOffset(resourceDir.rva) + 4) : null,
  };
  const repro = Boolean(debug?.repro);
  const delphiStamp = timestamp === DELPHI_TIMESTAMP;
  const compiled = timestamp && !repro ? new Date(timestamp * 1000) : null;
  if (compiled && !delphiStamp && compiled.getTime() > Date.now() + 24 * 3600 * 1000) {
    alerts.push({ level: 'medium', text: 'A data de compilação está no futuro: foi forjada.' });
  }
  if (timestamp && !repro && !delphiStamp) {
    const day = (v: number | null) => (v ? new Date(v * 1000).toISOString().slice(0, 10) : '');
    const differs = (v: number | null) => v !== null && Math.abs(v - timestamp) > STAMP_TOLERANCE_S;
    if (differs(timestamps.debug)) {
      alerts.push({
        level: 'medium',
        text: `A data do cabeçalho (${day(timestamp)}) não bate com a do diretório de debug (${day(timestamps.debug)}): a data de compilação foi alterada.`,
      });
    }
    if (differs(timestamps.exports)) {
      alerts.push({
        level: 'medium',
        text: `A data do cabeçalho (${day(timestamp)}) não bate com a da tabela de exportações (${day(timestamps.exports)}): a data de compilação foi alterada.`,
      });
    }
    if (differs(timestamps.resources) && timestamps.resources! > timestamp) {
      alerts.push({
        level: 'info',
        text: `Os recursos têm data posterior à compilação (${day(timestamps.resources)}): foram editados depois.`,
      });
    }
  }
  if (debug?.debugBuild) {
    alerts.push({ level: 'info', text: 'Compilado na configuração Debug (caminho do PDB).' });
  }
  const rich = parseRich(buf, peOff);
  if (rich && !rich.checksumValid) {
    alerts.push({
      level: 'medium',
      text: 'O Rich header não confere com o cabeçalho: foi editado ou copiado de outro programa.',
    });
  }
  for (const r of res.resources) {
    if (r.content === 'pe') {
      alerts.push({
        level: 'high',
        text: `O recurso ${r.type}/${r.name} contém outro executável.`,
      });
    }
  }
  if (overlay) {
    const exe = overlay.type && detectType(buf.subarray(overlay.offset))?.executable;
    alerts.push({
      level: exe ? 'high' : 'info',
      text: `${overlay.size.toLocaleString('pt-BR')} bytes anexados depois do fim do executável${
        overlay.type ? ` (${overlay.type})` : ''
      }.`,
    });
  }
  if (res.manifest?.executionLevel === 'requireAdministrator') {
    alerts.push({ level: 'medium', text: 'O manifesto pede execução como administrador.' });
  }
  const company = res.version?.CompanyName ?? '';
  if (/microsoft/i.test(company) && !signature) {
    alerts.push({
      level: 'medium',
      text: `Diz ser da ${company}, mas não tem assinatura digital.`,
    });
  }
  const original = res.version?.OriginalFilename?.trim().toLowerCase();
  const declared = (filename ?? '').trim().toLowerCase().split(/[\\/]/).pop();
  if (original && declared && original !== declared) {
    alerts.push({
      level: 'info',
      text: `O nome original declarado na versão é ${res.version!.OriginalFilename}.`,
    });
  }
  // Suplemento do Excel (item 12): DLL com xlAutoOpen, que o Excel roda ao abrir o .xll.
  if (exports?.symbols.some((s) => s.name === 'xlAutoOpen')) {
    alerts.push({
      level: 'high',
      text: 'Suplemento do Excel (XLL): o Excel executa o xlAutoOpen ao abrir o arquivo.',
    });
  }
  if (signature?.selfSigned) {
    alerts.push({ level: 'medium', text: 'Assinado com certificado autoassinado.' });
  }
  for (const a of net?.alerts ?? []) alerts.push(a);
  const declaredChecksum = u32(opt + 64) ?? 0;
  const computedChecksum = peChecksum(buf, opt + 64);
  if (declaredChecksum && computedChecksum !== null && declaredChecksum !== computedChecksum) {
    alerts.push({ level: 'info', text: 'O checksum do cabeçalho não confere com o arquivo.' });
  }
  if (tlsCallbacks) {
    alerts.push({
      level: 'info',
      text: `${tlsCallbacks} TLS callback(s): código que roda antes do ponto de entrada (o CRT do MinGW também usa).`,
    });
  }

  const iconImage = mainIconImage(image, res.leaves);
  const order = { high: 0, medium: 1, info: 2 };
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    is64,
    isDll: (characteristics & 0x2000) !== 0,
    subsystem:
      subsystem !== null ? (SUBSYSTEMS[subsystem] ?? `outro (${subsystem})`) : 'desconhecido',
    compiledAt: compiled ? compiled.toISOString() : null,
    sections: sections.map(({ name, virtualSize, rawSize, entropy: e, flags }) => ({
      name,
      virtualSize,
      rawSize,
      entropy: e,
      flags,
    })),
    imports,
    suspiciousImports: [...suspicious].sort(),
    packer,
    imphash: complete ? imphash(named) : null,
    rich,
    exports,
    entryPoint: entryRva ? { rva: entryRva, section: entrySection?.name ?? null } : null,
    tlsCallbacks,
    overlay,
    checksum: { declared: declaredChecksum, computed: computedChecksum },
    resources: res.resources,
    resourcesTruncated: res.truncated,
    version: res.version,
    manifest: res.manifest,
    signature,
    dotnet,
    debug,
    timestamps,
    authentihash: authentihash(image),
    exphash: exportNames.length
      ? createHash('md5')
          .update(exportNames.map((n) => n.toLowerCase()).join(','))
          .digest('hex')
      : null,
    icon: iconImage ? iconHash(iconImage) : null,
    alerts: alerts.sort((a, b) => order[a.level] - order[b.level]),
    rev: PE_REVISION,
  };
}
