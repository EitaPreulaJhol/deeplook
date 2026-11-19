import { createHash } from 'node:crypto';

import { type CryptoInfo, scanCrypto } from './crypto-scan';
import { analyzeDelivery, type DeliveryInfo, htmlScripts } from './delivery-formats';
import { analyzeDiskImage, type DiskImageInfo } from './disk-image';
import { analyzeDocument, type DocumentInfo } from './doc-analysis';
import { type ElfInfo, parseElf } from './elf-analysis';
import { entropy } from './entropy';
import { type Channel, findChannels, mergeChannels } from './exfil';
import { type DetectedType, detectType, EXE_EXTS } from './file-type';
import type { Ioc } from './iocs';
import { extractIocs } from './iocs';
import { analyzeLnk, type LnkInfo } from './lnk-analysis';
import { type LolInfo, lolOf } from './lol';
import { type MachoInfo, parseMacho } from './macho-analysis';
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

/**
 * Revisao da analise estatica (`rev`): o backfill refaz em segundo plano os executaveis analisados
 * numa revisao anterior (1: criptografia e codificacao, plans/analise-estatica-ampliada, item 7;
 * 2: canais de exfiltracao, item 3; 3: LOLDrivers, LOLRMM e binarios do sistema, item 4).
 * O PE tem tambem a dele (PE_REVISION).
 */
export const STATIC_REVISION = 3;

export interface StaticInfo {
  version: 1;
  /** STATIC_REVISION da analise; ausente nas anteriores ao item 7. */
  rev?: number;
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
  macho?: MachoInfo | null;
  /** PDF, Office (OOXML/OLE) e RTF: macros, scripts, links e objetos (item 70). */
  document?: DocumentInfo | null;
  /** PowerShell, JS, VBS, BAT e HTA: chamadas suspeitas e camadas decodificadas (item 83). */
  script?: ScriptInfo | null;
  /** Atalho do Windows (item 84): destino, argumentos, maquina de origem. */
  lnk?: LnkInfo | null;
  /**
   * OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4): o que estava escondido no
   * arquivo (as amostras filhas saem na criacao da amostra) e os alertas.
   */
  delivery?: DeliveryInfo | null;
  /** Imagem de disco (item 84): ISO/IMG/VHD com a lista de arquivos. */
  diskImage?:
    | (Omit<DiskImageInfo, 'files'> & { files: { path: string; size: number; hidden: boolean }[] })
    | null;
  /**
   * Constantes de criptografia, chaves RSA e alfabetos Base64 proprios, nos executaveis (PE, ELF e
   * Mach-O; plans/analise-estatica-ampliada, item 7).
   */
  crypto?: CryptoInfo | null;
  /**
   * Canais de exfiltracao e segredos nas strings e nas camadas de script (item 3): token do
   * Telegram, webhook do Discord, SMTP, FTP, paste, tunel. Os dos servicos (FLOSS, .NET, Java,
   * emulacao, configuracao) chegam depois e sao juntados na rota /channels.
   */
  channels?: Channel[];
  /** Driver do LOLDrivers, ferramenta do LOLRMM e binario do sistema abusado (item 4). */
  lol?: LolInfo | null;
  /**
   * Indicadores encontrados nas strings: so sugestao (nao entram no indice). Ate
   * CANDIDATES_PER_KIND de cada tipo.
   */
  iocCandidates: Ioc[];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

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
  let rawStrings: string[] = [];
  try {
    rawStrings = extractStrings(buf, end);
    strings = categorize(rawStrings);
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
  // Executavel macOS (comum ou universal).
  let macho: MachoInfo | null = null;
  if (detectedType?.id === 'macho') {
    try {
      macho = parseMacho(buf)?.info ?? null;
    } catch {
      macho = null;
    }
  }
  // Criptografia e codificacao nos executaveis (item 7).
  let crypto: CryptoInfo | null = null;
  if (pe || elf || macho) {
    try {
      crypto = scanCrypto(buf);
    } catch {
      crypto = null;
    }
  }
  // Documentos (item 70): macros, scripts, links e objetos; os links viram sugestao.
  const document = analyzeDocument(buf, detectedType?.id);
  // OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4): so o resumo; os bytes do que
  // sai viram amostras filhas na criacao da amostra (entry-create.ts).
  const delivery = analyzeDelivery(buf, filename, detectedType?.id)?.info ?? null;
  // Scripts (item 83): as URLs das camadas decodificadas tambem viram sugestao.
  let script: ScriptInfo | null;
  try {
    script = analyzeScript(buf, filename);
    // Pagina HTML: o JavaScript das tags <script> passa pela mesma analise.
    if (!script && delivery?.format === 'html') {
      const code = htmlScripts(buf);
      if (code) script = analyzeScript(Buffer.from(code), 'pagina.js');
    }
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
  // Canais de exfiltracao (item 3): as strings e o texto decodificado das camadas de script.
  let channels: Channel[];
  try {
    channels = mergeChannels([
      findChannels(rawStrings.join('\n'), 'strings'),
      findChannels((script?.layers ?? []).map((l) => l.text).join('\n'), 'script'),
    ]);
  } catch {
    channels = [];
  }
  const iocCandidates = extractIocs(
    [
      // Destino do canal que e host proprio (SMTP, tunel): o do Telegram e do Discord e legitimo.
      ...channels.filter((c) => c.kind === 'smtp' || c.kind === 'tunnel').map((c) => c.host ?? ''),
      ...strings.urls,
      ...strings.ips,
      ...strings.emails,
      ...(document?.links ?? []),
      ...(script?.urls ?? []),
      lnk?.arguments ?? '',
      ...(delivery?.msi?.customActions.map((a) => a.target ?? '') ?? []),
    ].join('\n'),
  );
  // Abuso conhecido (item 4): driver, ferramenta de acesso remoto, binario do sistema.
  let lol: LolInfo | null;
  try {
    const driver = pe?.subsystem === 'Nativo (driver)' || /\.sys$/i.test(filename ?? '');
    lol = lolOf({
      sha256: driver ? createHash('sha256').update(buf).digest('hex') : null,
      authentihash: pe?.authentihash ?? null,
      driver,
      version: pe?.version ?? null,
      signer: pe?.signature?.signer?.subject ?? null,
      hosts: iocCandidates
        .filter((i) => i.kind === 'DOMAIN' || i.kind === 'URL')
        .map((i) => (i.kind === 'URL' ? hostOf(i.value) : i.value))
        .filter((h): h is string => Boolean(h)),
      texts: [
        ...rawStrings,
        ...(script?.layers ?? []).map((l) => l.text),
        [lnk?.target, lnk?.arguments].filter(Boolean).join(' '),
        ...(delivery?.msi?.customActions.map((a) => a.target ?? '') ?? []),
      ],
    });
  } catch {
    lol = null;
  }
  return {
    version: 1,
    rev: STATIC_REVISION,
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
    macho,
    document,
    script,
    delivery,
    lnk,
    diskImage,
    crypto,
    channels,
    lol,
    iocCandidates: capPerKind(iocCandidates, CANDIDATES_PER_KIND),
  };
}
