import { analyzeDocument, type DocumentInfo } from './doc-analysis';
import type { Ioc } from './iocs';
import { extractIocs } from './iocs';
import { analyzeScript, type ScriptInfo } from './script-analysis';

/**
 * Analise estatica do arquivo enviado: SO LEITURA de bytes (nunca executa, nunca
 * descompacta). Tudo com limites de tamanho para um arquivo hostil nao travar a
 * API. Resultado gravado em `Entry.staticInfo` (JSON) e exibido na ficha.
 */

/** Bytes lidos para entropia e strings (o tipo e o PE usam o comeco do arquivo). */
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_LIST = 20;
const MAX_DLLS = 64;
const MAX_FUNCTIONS = 4096;

export interface DetectedType {
  id: string;
  label: string;
  /** Extensoes esperadas para este conteudo. */
  extensions: string[];
  /** Executavel/script: disfarcado com outra extensao e um forte indicio. */
  executable: boolean;
}

export interface PeSection {
  name: string;
  virtualSize: number;
  rawSize: number;
  entropy: number;
}

export interface PeInfo {
  machine: string;
  is64: boolean;
  isDll: boolean;
  subsystem: string;
  /** Data de compilacao declarada no cabecalho (pode ser forjada). */
  compiledAt: string | null;
  sections: PeSection[];
  imports: { dll: string; functions: number }[];
  suspiciousImports: string[];
  packer: string | null;
}

export interface StaticInfo {
  version: 1;
  analyzedAt: string;
  size: number;
  bytesAnalyzed: number;
  detectedType: DetectedType | null;
  /** Extensao do nome nao bate com o conteudo (`dangerous`: executavel disfarcado). */
  extensionMismatch: { declared: string; expected: string[]; dangerous: boolean } | null;
  entropy: number;
  entropyLevel: 'low' | 'normal' | 'high';
  strings: {
    total: number;
    urls: string[];
    ips: string[];
    emails: string[];
    paths: string[];
    registry: string[];
    suspicious: string[];
  };
  pe: PeInfo | null;
  /** PDF, Office (OOXML/OLE) e RTF: macros, scripts, links e objetos (item 70). */
  document?: DocumentInfo | null;
  /** PowerShell, JS, VBS, BAT e HTA: chamadas suspeitas e camadas decodificadas (item 83). */
  script?: ScriptInfo | null;
  /** Indicadores encontrados nas strings: so sugestao (nao entram no indice). */
  iocCandidates: Ioc[];
}

// ------------------------------------------------------------------ tipo real

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, text: string, offset = 0) =>
  buf.length >= offset + text.length &&
  buf.toString('latin1', offset, offset + text.length) === text;

const EXE_EXTS = ['exe', 'dll', 'sys', 'scr', 'cpl', 'ocx', 'drv', 'efi', 'com'];

export function detectType(buf: Buffer): DetectedType | null {
  const t = (id: string, label: string, extensions: string[], executable = false) => ({
    id,
    label,
    extensions,
    executable,
  });
  if (startsWith(buf, [0x4d, 0x5a])) return t('pe', 'Executável do Windows (PE)', EXE_EXTS, true);
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]))
    return t('elf', 'Executável Linux (ELF)', ['', 'elf', 'so', 'bin', 'o'], true);
  if (
    startsWith(buf, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(buf, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(buf, [0xce, 0xfa, 0xed, 0xfe])
  ) {
    return t('macho', 'Executável macOS (Mach-O)', ['', 'dylib', 'bundle', 'app'], true);
  }
  if (ascii(buf, '%PDF-')) return t('pdf', 'Documento PDF', ['pdf']);
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP: Office moderno e Java se reconhecem pelos nomes internos (sem descompactar).
    const head = buf.toString('latin1', 0, Math.min(buf.length, 64 * 1024));
    if (head.includes('word/'))
      return t('docx', 'Documento Word (OOXML)', ['docx', 'docm', 'dotx', 'dotm']);
    if (head.includes('xl/'))
      return t('xlsx', 'Planilha Excel (OOXML)', ['xlsx', 'xlsm', 'xltx', 'xltm']);
    if (head.includes('ppt/'))
      return t('pptx', 'Apresentação PowerPoint (OOXML)', ['pptx', 'pptm', 'potx']);
    if (head.includes('META-INF/MANIFEST.MF')) return t('jar', 'Pacote Java (JAR)', ['jar'], true);
    if (head.includes('AndroidManifest.xml'))
      return t('apk', 'Aplicativo Android (APK)', ['apk'], true);
    return t('zip', 'Arquivo ZIP', ['zip']);
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return t('ole', 'Documento Office antigo / MSI (OLE)', [
      'doc',
      'xls',
      'ppt',
      'msi',
      'msg',
      'dot',
      'xlt',
    ]);
  }
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return t('7z', 'Arquivo 7-Zip', ['7z']);
  if (ascii(buf, 'Rar!')) return t('rar', 'Arquivo RAR', ['rar']);
  if (startsWith(buf, [0x1f, 0x8b])) return t('gzip', 'Arquivo GZIP', ['gz', 'tgz']);
  if (ascii(buf, 'MSCF')) return t('cab', 'Arquivo CAB', ['cab']);
  if (ascii(buf, 'ITSF')) return t('chm', 'Ajuda compilada (CHM)', ['chm'], true);
  if (startsWith(buf, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) {
    return t('lnk', 'Atalho do Windows (LNK)', ['lnk'], true);
  }
  if (ascii(buf, 'CD001', 0x8001)) return t('iso', 'Imagem de disco (ISO)', ['iso', 'img']);
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return t('png', 'Imagem PNG', ['png']);
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return t('jpeg', 'Imagem JPEG', ['jpg', 'jpeg']);
  if (ascii(buf, 'GIF8')) return t('gif', 'Imagem GIF', ['gif']);
  if (ascii(buf, '{\\rtf')) return t('rtf', 'Documento RTF', ['rtf', 'doc']);
  if (ascii(buf, '#!'))
    return t('script', 'Script com interpretador (#!)', ['sh', 'py', 'pl', 'rb', ''], true);
  const text = buf.toString('latin1', 0, Math.min(buf.length, 512)).trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html')) {
    return t('html', 'Página HTML', ['html', 'htm', 'hta', 'xhtml']);
  }
  return null;
}

function declaredExtension(filename: string | null | undefined): string {
  const name = (filename ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

// ------------------------------------------------------------------ entropia

export function entropy(buf: Buffer, start = 0, end = buf.length): number {
  const len = Math.max(0, end - start);
  if (!len) return 0;
  const counts = new Array<number>(256).fill(0);
  for (let i = start; i < end; i++) counts[buf[i]]++;
  let h = 0;
  for (const c of counts) {
    if (c) {
      const p = c / len;
      h -= p * Math.log2(p);
    }
  }
  return Math.round(h * 100) / 100;
}

// ------------------------------------------------------------------ strings

const MIN_STRING = 6;
const SUSPICIOUS_WORDS = [
  'powershell',
  'cmd.exe /c',
  '-encodedcommand',
  'frombase64string',
  'invoke-expression',
  'iex(',
  'vssadmin',
  'bcdedit',
  'wevtutil cl',
  'schtasks',
  'mimikatz',
  'certutil -urlcache',
  'bitsadmin',
  'rundll32',
  'regsvr32',
  'mshta',
  'wscript.shell',
  'downloadstring',
  'net user /add',
  'shadowcopy',
];

/** Sequencias legiveis ASCII e UTF-16LE com pelo menos 6 caracteres. */
export function extractStrings(buf: Buffer, end = buf.length): string[] {
  const out: string[] = [];
  const printable = (b: number) => b >= 0x20 && b < 0x7f;
  let start = -1;
  for (let i = 0; i <= end; i++) {
    if (i < end && printable(buf[i])) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN_STRING)
        out.push(buf.toString('latin1', start, Math.min(i, start + 400)));
      start = -1;
    }
  }
  // UTF-16LE: caractere imprimivel seguido de 0x00, nos dois alinhamentos (a
  // string pode comecar em byte par ou impar).
  for (const align of [0, 1]) {
    start = -1;
    // Vai ate `end` para descarregar a sequencia que termina no fim do arquivo.
    for (let i = align; i <= end; i += 2) {
      if (i + 1 < end && printable(buf[i]) && buf[i + 1] === 0) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if ((i - start) / 2 >= MIN_STRING) {
          out.push(buf.toString('utf16le', start, Math.min(i, start + 800)));
        }
        start = -1;
      }
    }
  }
  return out;
}

function categorize(strings: string[]): StaticInfo['strings'] {
  const pick = (re: RegExp) => {
    const found = new Set<string>();
    for (const s of strings) {
      for (const m of s.matchAll(re)) {
        if (found.size >= MAX_LIST) return [...found];
        found.add(m[0]);
      }
    }
    return [...found];
  };
  const suspicious = new Set<string>();
  for (const s of strings) {
    const lower = s.toLowerCase();
    for (const word of SUSPICIOUS_WORDS) if (lower.includes(word)) suspicious.add(word);
  }
  const ips = new Set(
    extractIocs(pick(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g).join('\n'))
      .filter((i) => i.kind === 'IPV4')
      .map((i) => i.value),
  );
  return {
    total: strings.length,
    urls: pick(/\bhttps?:\/\/[^\s"'<>]{4,200}/gi),
    ips: [...ips].slice(0, MAX_LIST),
    emails: pick(/\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi),
    paths: pick(/(?:\b[a-z]:\\|%[a-z]+%\\)[^\s"'<>|*?]{3,200}/gi),
    registry: pick(/\b(?:HKEY_[A-Z_]+|HKLM|HKCU)\\[^\s"'<>]{3,200}/g),
    suspicious: [...suspicious].slice(0, MAX_LIST),
  };
}

// ------------------------------------------------------------------ PE

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

/** Le o cabecalho PE com checagem de limites em cada acesso (arquivo pode ser hostil). */
export function parsePe(buf: Buffer): PeInfo | null {
  const u16 = (o: number) => (o >= 0 && o + 2 <= buf.length ? buf.readUInt16LE(o) : null);
  const u32 = (o: number) => (o >= 0 && o + 4 <= buf.length ? buf.readUInt32LE(o) : null);
  const cstr = (o: number, max = 256) => {
    if (o < 0 || o >= buf.length) return null;
    const end = buf.indexOf(0, o);
    const stop = end < 0 ? Math.min(buf.length, o + max) : Math.min(end, o + max);
    return buf.toString('latin1', o, stop);
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
  const subsystem = u16(opt + 68);
  const importDirOff = opt + (is64 ? 120 : 104);
  const importRva = u32(importDirOff);

  const sections: (PeSection & { va: number; rawPtr: number })[] = [];
  const secTable = opt + optSize;
  for (let i = 0; i < Math.min(nSections, 96); i++) {
    const s = secTable + i * 40;
    const name = (cstr(s, 8) ?? '').replace(/[^\x20-\x7e]/g, '');
    const virtualSize = u32(s + 8);
    const va = u32(s + 12);
    const rawSize = u32(s + 16);
    const rawPtr = u32(s + 20);
    if (virtualSize === null || va === null || rawSize === null || rawPtr === null) break;
    const rawEnd = Math.min(buf.length, rawPtr + rawSize);
    sections.push({
      name,
      virtualSize,
      rawSize,
      entropy: rawPtr < buf.length ? entropy(buf, rawPtr, rawEnd) : 0,
      va,
      rawPtr,
    });
  }
  const rvaToOffset = (rva: number) => {
    const sec = sections.find(
      (s) => rva >= s.va && rva < s.va + Math.max(s.virtualSize, s.rawSize),
    );
    return sec ? rva - sec.va + sec.rawPtr : -1;
  };

  const imports: PeInfo['imports'] = [];
  const suspicious = new Set<string>();
  let totalFunctions = 0;
  if (importRva) {
    let desc = rvaToOffset(importRva);
    for (let i = 0; desc >= 0 && i < MAX_DLLS; i++, desc += 20) {
      const original = u32(desc);
      const nameRva = u32(desc + 12);
      const first = u32(desc + 16);
      if (!nameRva || (original === 0 && first === 0)) break;
      const dll = cstr(rvaToOffset(nameRva), 128);
      if (!dll) break;
      let thunk = rvaToOffset(original || first || 0);
      let functions = 0;
      const step = is64 ? 8 : 4;
      while (thunk >= 0 && totalFunctions < MAX_FUNCTIONS) {
        const lo = u32(thunk);
        const hi = is64 ? u32(thunk + 4) : 0;
        if (lo === null || hi === null || (lo === 0 && hi === 0)) break;
        const byOrdinal = is64 ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
        if (!byOrdinal) {
          const fn = cstr(rvaToOffset(lo) + 2, 128);
          if (fn && SUSPICIOUS_IMPORTS.includes(fn)) suspicious.add(fn);
        }
        functions++;
        totalFunctions++;
        thunk += step;
      }
      imports.push({ dll: dll.toLowerCase(), functions });
    }
  }

  const packer =
    sections.map((s) => PACKER_SECTIONS.find(([re]) => re.test(s.name))?.[1]).find(Boolean) ?? null;
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    is64,
    isDll: (characteristics & 0x2000) !== 0,
    subsystem:
      subsystem !== null ? (SUBSYSTEMS[subsystem] ?? `outro (${subsystem})`) : 'desconhecido',
    compiledAt: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    sections: sections.map(({ name, virtualSize, rawSize, entropy: e }) => ({
      name,
      virtualSize,
      rawSize,
      entropy: e,
    })),
    imports,
    suspiciousImports: [...suspicious].sort(),
    packer,
  };
}

// ------------------------------------------------------------------ tudo junto

/** Analise completa do conteudo do arquivo (nunca lanca: falha parcial vira campo vazio). */
export function analyzeBuffer(buf: Buffer, filename?: string | null): StaticInfo {
  const end = Math.min(buf.length, MAX_BYTES);
  const detectedType = detectType(buf);
  const declared = declaredExtension(filename);
  let extensionMismatch: StaticInfo['extensionMismatch'] = null;
  if (detectedType && declared && !detectedType.extensions.includes(declared)) {
    extensionMismatch = {
      declared,
      expected: detectedType.extensions.filter(Boolean),
      dangerous: detectedType.executable && !EXE_EXTS.includes(declared),
    };
  }
  const e = entropy(buf, 0, end);
  let strings: StaticInfo['strings'] = {
    total: 0,
    urls: [],
    ips: [],
    emails: [],
    paths: [],
    registry: [],
    suspicious: [],
  };
  try {
    strings = categorize(extractStrings(buf, end));
  } catch {
    /* strings sao um extra: segue sem elas */
  }
  let pe: PeInfo | null = null;
  if (detectedType?.id === 'pe') {
    try {
      pe = parsePe(buf);
    } catch {
      pe = null;
    }
  }
  // Documentos (item 70): macros, scripts, links e objetos; os links viram sugestao.
  const document = analyzeDocument(buf, detectedType?.id);
  // Scripts (item 83): as URLs das camadas decodificadas tambem viram sugestao.
  let script: ScriptInfo | null;
  try {
    script = analyzeScript(buf, filename);
  } catch {
    script = null;
  }
  const iocCandidates = extractIocs(
    [
      ...strings.urls,
      ...strings.ips,
      ...strings.emails,
      ...(document?.links ?? []),
      ...(script?.urls ?? []),
    ].join('\n'),
  );
  return {
    version: 1,
    analyzedAt: new Date().toISOString(),
    size: buf.length,
    bytesAnalyzed: end,
    detectedType,
    extensionMismatch,
    entropy: e,
    entropyLevel: e >= 7.2 ? 'high' : e < 4 ? 'low' : 'normal',
    strings,
    pe,
    document,
    script,
    iocCandidates: iocCandidates.slice(0, 50),
  };
}
