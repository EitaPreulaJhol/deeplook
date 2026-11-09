import { analyzeDiskImage, type DiskImageInfo } from './disk-image';
import { analyzeDocument, type DocumentInfo } from './doc-analysis';
import { type ElfInfo, parseElf } from './elf-analysis';
import { entropy } from './entropy';
import { type DetectedType, detectType, EXE_EXTS } from './file-type';
import type { Ioc } from './iocs';
import { extractIocs } from './iocs';
import { analyzeLnk, type LnkInfo } from './lnk-analysis';
import { parsePe, type PeInfo } from './pe-analysis';
import { analyzeScript, type ScriptInfo } from './script-analysis';

export type { DetectedType, PeInfo };
export { detectType, parsePe };
export type { PeSection } from './pe-analysis';

/**
 * Analise estatica do arquivo enviado: SO LEITURA de bytes (nunca executa, nunca
 * descompacta). Tudo com limites de tamanho para um arquivo hostil nao travar a
 * API. Resultado gravado em `Entry.staticInfo` (JSON) e exibido na ficha.
 */

/** Bytes lidos para entropia e strings (o tipo e o PE usam o comeco do arquivo). */
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_LIST = 20;

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
  /** Executavel Linux (item 168): secoes, bibliotecas, simbolos importados e alertas. */
  elf?: ElfInfo | null;
  /** PDF, Office (OOXML/OLE) e RTF: macros, scripts, links e objetos (item 70). */
  document?: DocumentInfo | null;
  /** PowerShell, JS, VBS, BAT e HTA: chamadas suspeitas e camadas decodificadas (item 83). */
  script?: ScriptInfo | null;
  /** Atalho do Windows (item 84): destino, argumentos, maquina de origem. */
  lnk?: LnkInfo | null;
  /** Imagem de disco (item 84): ISO/IMG/VHD com a lista de arquivos. */
  diskImage?:
    | (Omit<DiskImageInfo, 'files'> & { files: { path: string; size: number; hidden: boolean }[] })
    | null;
  /**
   * Indicadores encontrados nas strings: so sugestao (nao entram no indice). Ate
   * CANDIDATES_PER_KIND de cada tipo.
   */
  iocCandidates: Ioc[];
}

function declaredExtension(filename: string | null | undefined): string {
  const name = (filename ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

// ------------------------------------------------------------------ entropia

export { entropy };

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

// ------------------------------------------------------------------ tudo junto

/** Sugestoes de indicador por tipo (item 165): com URL e IPv6, um tipo nao toma a lista. */
const CANDIDATES_PER_KIND = 15;

function capPerKind(iocs: Ioc[], max: number): Ioc[] {
  const count = new Map<string, number>();
  return iocs.filter((ioc) => {
    const n = (count.get(ioc.kind) ?? 0) + 1;
    count.set(ioc.kind, n);
    return n <= max;
  });
}

/** Analise completa do conteudo do arquivo (nunca lanca: falha parcial vira campo vazio). */
export function analyzeBuffer(buf: Buffer, filename?: string | null): StaticInfo {
  return withoutNul(analyzeContent(buf, filename));
}

/** O Postgres recusa \u0000 em JSON (e o envio daria 500): nomes e textos vem do arquivo. */
function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k.replaceAll('\u0000', ''), withoutNul(v)]),
    ) as T;
  }
  return value;
}

function analyzeContent(buf: Buffer, filename?: string | null): StaticInfo {
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
      pe = parsePe(buf, filename);
    } catch {
      pe = null;
    }
  }
  // Executavel Linux (item 168).
  let elf: ElfInfo | null = null;
  if (detectedType?.id === 'elf') {
    try {
      elf = parseElf(buf)?.info ?? null;
    } catch {
      elf = null;
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
  // Atalho .lnk e imagem de disco (item 84). Da imagem guarda so caminho,
  // tamanho e oculto (a extracao le o arquivo de novo).
  const lnk = analyzeLnk(buf);
  const image = lnk ? null : analyzeDiskImage(buf);
  const diskImage = image
    ? { ...image, files: image.files.map(({ path, size, hidden }) => ({ path, size, hidden })) }
    : null;
  const iocCandidates = extractIocs(
    [
      ...strings.urls,
      ...strings.ips,
      ...strings.emails,
      ...(document?.links ?? []),
      ...(script?.urls ?? []),
      lnk?.arguments ?? '',
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
    elf,
    document,
    script,
    lnk,
    diskImage,
    iocCandidates: capPerKind(iocCandidates, CANDIDATES_PER_KIND),
  };
}
