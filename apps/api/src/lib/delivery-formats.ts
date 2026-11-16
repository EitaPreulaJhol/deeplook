import { createHash } from 'node:crypto';

import { Cfb, type CfbEntry } from './doc-analysis';
import { detectType } from './file-type';

/**
 * Formatos de entrega (plans/caca-e-formatos, item 4): OneNote, HTML smuggling e MSI. Os tres
 * escondem a carga dentro de um arquivo que parece inofensivo; aqui ela sai como arquivo (que a
 * criacao da amostra transforma em amostra filha) e o card diz de onde saiu. So le bytes, com
 * tetos de tamanho, quantidade e tempo; falha vira "sem dados", nunca excecao.
 */

export type DeliveryAlertLevel = 'high' | 'medium' | 'info';

export interface DeliveryFile {
  name: string;
  size: number;
  sha256: string;
  /** Tipo real (detectType) ou o script reconhecido pelo texto. */
  type: string | null;
  /** De onde saiu ("Binary.AcaoDll", "objeto 2", "Base64 (atob)"). */
  source: string;
  /** Amostra filha criada (preenchido na criacao da amostra). */
  entryId?: string;
  /** Nao virou amostra (o motivo). */
  skipped?: string;
}

export interface MsiCustomAction {
  action: string;
  type: number;
  /** O que a acao faz, pelo tipo ("EXE com linha de comando"). */
  kind: string;
  source: string | null;
  target: string | null;
  flags: string[];
}

export interface DeliveryInfo {
  format: 'onenote' | 'html' | 'msi';
  risk: 'high' | 'medium' | 'low';
  alerts: { level: DeliveryAlertLevel; text: string }[];
  files: DeliveryFile[];
  onenote?: { objects: number; images: number };
  html?: { smuggling: string[]; base64: number; dataUris: number; byteArrays: number };
  msi?: {
    product: {
      name: string | null;
      manufacturer: string | null;
      version: string | null;
      code: string | null;
    };
    customActions: MsiCustomAction[];
    binary: string[];
    files: string[];
    filesTotal: number;
    tables: string[];
  };
}

/** Motivo gravado quando a filha nao pode ser criada (entry-create.ts). */
export const CHILD_FAILED = 'falha ao criar a amostra';

export interface DeliveryResult {
  info: DeliveryInfo;
  /** Os bytes de cada arquivo de `info.files`, na mesma ordem. */
  payloads: Buffer[];
}

/** Maior arquivo lido. */
const MAX_INPUT = 64 * 1024 * 1024;
/** Arquivos tirados por amostra e o total somado. */
const MAX_FILES = 40;
const MAX_TOTAL = 128 * 1024 * 1024;
/** Literais Base64, data: e listas de bytes examinados no HTML. */
const MAX_CANDIDATES = 200;
/** Menor carga que conta (menos que isto e icone, fonte, imagem pequena). */
const MIN_PAYLOAD = 256;
const MAX_ACTIONS = 300;
const MAX_LISTED = 50;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Script pelo texto (o detectType nao reconhece texto sem #!). */
function scriptKind(data: Buffer): string | null {
  const head = data.toString('latin1', 0, Math.min(data.length, 4096)).toLowerCase();
  if (data.includes(0)) return null;
  if (/<hta:application/.test(head)) return 'hta';
  if (/^\s*@?echo\s+off|^\s*(?:set|start|cmd|powershell)\b.*$/m.test(head)) return 'bat';
  if (/\bwscript\.createobject|\bcreateobject\s*\(|^\s*dim\s/m.test(head)) return 'vbs';
  if (/new\s+activexobject|\bwscript\.(?:shell|echo)|\bfunction\s*\(/.test(head)) return 'js';
  if (/\$[a-z_]+\s*=|invoke-|iex\b|new-object/.test(head)) return 'ps1';
  if (/<job\b|<package\b/.test(head)) return 'wsf';
  return null;
}

/** Tipos que viram amostra filha (o que pode executar ou carregar codigo). */
const PAYLOAD_TYPES = new Set([
  'pe',
  'elf',
  'macho',
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'jar',
  'apk',
  'ole',
  '7z',
  'rar',
  'gzip',
  'cab',
  'chm',
  'lnk',
  'iso',
  'pdf',
  'rtf',
  'script',
]);
const IMAGE_TYPES = new Set(['png', 'jpeg', 'gif']);
const RISKY_TYPES = new Set(['pe', 'elf', 'macho', 'jar', 'apk', 'chm', 'lnk', 'script']);
const RISKY_SCRIPTS = new Set(['hta', 'bat', 'vbs', 'js', 'ps1', 'wsf']);

function typeOf(data: Buffer): { id: string | null; ext: string } {
  const detected = detectType(data);
  // HTA comeca como HTML: o <hta:application> e o que decide (ele executa como programa).
  if (detected?.id === 'html' && scriptKind(data) === 'hta') return { id: 'hta', ext: 'hta' };
  if (detected) {
    const ext =
      detected.id === 'pe' ? (isDll(data) ? 'dll' : 'exe') : detected.extensions[0] || 'bin';
    return { id: detected.id, ext };
  }
  const script = scriptKind(data);
  return script ? { id: script, ext: script } : { id: null, ext: 'bin' };
}

/** PE com a flag de DLL (Characteristics & 0x2000). */
function isDll(data: Buffer): boolean {
  try {
    const pe = data.readUInt32LE(0x3c);
    return data.readUInt32LE(pe) === 0x00004550 && (data.readUInt16LE(pe + 22) & 0x2000) !== 0;
  } catch {
    return false;
  }
}

const riskOf = (alerts: DeliveryInfo['alerts']): DeliveryInfo['risk'] =>
  alerts.some((a) => a.level === 'high')
    ? 'high'
    : alerts.some((a) => a.level === 'medium')
      ? 'medium'
      : 'low';

/** Junta os arquivos com os tetos: os que passam ficam com os bytes; os outros, com o motivo. */
class Collector {
  files: DeliveryFile[] = [];
  payloads: Buffer[] = [];
  private total = 0;
  private seen = new Set<string>();

  add(name: string, data: Buffer, source: string, type: string | null): DeliveryFile | null {
    const hash = sha256(data);
    if (this.seen.has(hash)) return null;
    this.seen.add(hash);
    const file: DeliveryFile = {
      name: safeName(name),
      size: data.length,
      sha256: hash,
      type,
      source,
    };
    if (this.files.length >= MAX_FILES) file.skipped = `limite de ${MAX_FILES} arquivos`;
    else if (this.total + data.length > MAX_TOTAL) file.skipped = 'limite de tamanho somado';
    this.files.push(file);
    this.payloads.push(file.skipped ? Buffer.alloc(0) : data);
    if (!file.skipped) this.total += data.length;
    return file;
  }
}

/** Nome de arquivo sem pasta nem caractere de controle. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const clean = [...base]
    .map((c) => (c.charCodeAt(0) < 0x20 || '<>:"|?*'.includes(c) ? '_' : c))
    .join('')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return clean || 'embutido.bin';
}

// ------------------------------------------------------------------ OneNote

/** GUID no formato de bytes do Windows (os tres primeiros campos em little-endian). */
function guidBytes(guid: string): Buffer {
  const hex = guid.replace(/[{}-]/g, '');
  const b = Buffer.from(hex, 'hex');
  return Buffer.concat([
    Buffer.from(b.subarray(0, 4)).reverse(),
    Buffer.from(b.subarray(4, 6)).reverse(),
    Buffer.from(b.subarray(6, 8)).reverse(),
    b.subarray(8),
  ]);
}
const ONENOTE_HEADER = guidBytes('{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}');
const ONENOTE_FILE = guidBytes('{BDE316E7-2665-4511-A4C4-8D4D0B7A9EAC}');

export const isOneNote = (buf: Buffer) =>
  buf.length >= 16 && buf.subarray(0, 16).equals(ONENOTE_HEADER);

/**
 * Cada FileDataStoreObject (MS-ONESTORE 2.6.13): GUID + tamanho (64 bits) + 12 bytes reservados +
 * os dados. O nome original fica noutra estrutura, longe dos dados: o nome sai do tipo.
 */
function analyzeOneNote(buf: Buffer): DeliveryResult {
  const out = new Collector();
  const alerts: DeliveryInfo['alerts'] = [];
  let objects = 0;
  let images = 0;
  let risky = 0;
  for (let at = buf.indexOf(ONENOTE_FILE); at >= 0; at = buf.indexOf(ONENOTE_FILE, at + 16)) {
    if (at + 36 > buf.length) break;
    const size = Number(buf.readBigUInt64LE(at + 16));
    const start = at + 36;
    if (!size || start + size > buf.length) continue;
    objects += 1;
    const data = buf.subarray(start, start + size);
    const { id, ext } = typeOf(data);
    if (id && IMAGE_TYPES.has(id)) {
      images += 1;
      continue;
    }
    const file = out.add(`embutido-${objects}.${ext}`, data, `objeto ${objects}`, id);
    if (file && id && (RISKY_TYPES.has(id) || RISKY_SCRIPTS.has(id))) {
      risky += 1;
      alerts.push({ level: 'high', text: `Arquivo executável ou script anexado (${file.name})` });
    }
    at = start + size - 16;
  }
  if (risky && images) {
    alerts.push({
      level: 'medium',
      text: 'Imagem junto do anexo: o "clique duas vezes para ver" que esconde o arquivo',
    });
  }
  if (!risky && out.files.length) {
    alerts.push({ level: 'info', text: `${out.files.length} arquivo(s) anexado(s)` });
  }
  return {
    info: {
      format: 'onenote',
      risk: riskOf(alerts),
      alerts,
      files: out.files,
      onenote: { objects, images },
    },
    payloads: out.payloads,
  };
}

// ------------------------------------------------------------------ HTML

const HTML_EXTS = ['html', 'htm', 'shtml', 'xhtml', 'svg', 'mht'];
const SMUGGLING_APIS: [RegExp, string][] = [
  [/new\s+Blob\s*\(/, 'Blob'],
  [/URL\.createObjectURL\s*\(/, 'URL.createObjectURL'],
  [/msSaveOrOpenBlob|msSaveBlob/, 'msSaveOrOpenBlob'],
  [/\.download\s*=|\sdownload\s*=\s*["']/, 'download'],
  [/\batob\s*\(/, 'atob'],
];

/** Parece HTML ou SVG? */
function isHtmlLike(buf: Buffer, filename: string | null | undefined, detectedId: string | null) {
  if (detectedId === 'html') return true;
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext && HTML_EXTS.includes(ext)) return true;
  if (detectedId) return false;
  const head = buf.toString('latin1', 0, Math.min(buf.length, 4096)).trimStart().toLowerCase();
  // Em latin1, o BOM do UTF-8 vira tres caracteres (ï»¿).
  return /^(?:\u00ef\u00bb\u00bf)?\s*<(?:!doctype|html|head|body|script|svg|\?xml[^>]*>\s*<svg)/.test(
    head,
  );
}

function analyzeHtml(buf: Buffer): DeliveryResult {
  const text = buf.toString('utf8');
  const out = new Collector();
  const alerts: DeliveryInfo['alerts'] = [];
  const smuggling = SMUGGLING_APIS.filter(([re]) => re.test(text)).map(([, name]) => name);
  let base64 = 0;
  let dataUris = 0;
  let byteArrays = 0;
  let candidates = 0;
  const found: DeliveryFile[] = [];
  const consider = (data: Buffer, source: string) => {
    if (data.length < MIN_PAYLOAD) return;
    const { id, ext } = typeOf(data);
    if (!id || !(PAYLOAD_TYPES.has(id) || RISKY_SCRIPTS.has(id))) return;
    const file = out.add(`carga-${out.files.length + 1}.${ext}`, data, source, id);
    if (file) found.push(file);
  };
  // data: URIs binarias (as imagens ficam de fora pelo tipo).
  for (const m of text.matchAll(
    /data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.+-]+)*;base64,([A-Za-z0-9+/]{340,}={0,2})/gi,
  )) {
    if (++candidates > MAX_CANDIDATES) break;
    dataUris += 1;
    consider(Buffer.from(m[2], 'base64'), `data: (${m[1] ?? 'sem tipo'})`);
  }
  // Literais Base64 longos (atob, payload solto): >= 1 KB decodificado.
  for (const m of text.matchAll(/(["'`])([A-Za-z0-9+/]{1366,}={0,2})\1/g)) {
    if (++candidates > MAX_CANDIDATES) break;
    base64 += 1;
    consider(Buffer.from(m[2], 'base64'), 'Base64');
  }
  // Listas de bytes (new Uint8Array([77, 90, ...]) ou [0x4d, 0x5a, ...]).
  for (const m of text.matchAll(
    /\[\s*((?:(?:0x[0-9a-f]{1,2}|\d{1,3})\s*,\s*){255,}(?:0x[0-9a-f]{1,2}|\d{1,3}))\s*\]/gi,
  )) {
    if (++candidates > MAX_CANDIDATES) break;
    const values = m[1].split(',').map((v) => Number(v.trim()));
    if (values.some((v) => !Number.isInteger(v) || v > 255)) continue;
    byteArrays += 1;
    consider(Buffer.from(values), 'lista de bytes');
  }
  const assembles = smuggling.some((api) => api !== 'atob');
  for (const file of found) {
    alerts.push(
      assembles
        ? {
            level: 'high',
            text: `HTML smuggling: monta ${file.name} (${file.type}) no navegador e entrega como download`,
          }
        : { level: 'medium', text: `Arquivo ${file.type} embutido na página (${file.name})` },
    );
  }
  if (!found.length && assembles && (base64 || byteArrays || dataUris)) {
    alerts.push({
      level: 'medium',
      text: 'Monta um arquivo no navegador (Blob/download), mas a carga não foi decodificada',
    });
  }
  return {
    info: {
      format: 'html',
      risk: riskOf(alerts),
      alerts,
      files: out.files,
      html: { smuggling, base64, dataUris, byteArrays },
    },
    payloads: out.payloads,
  };
}

/** O JavaScript embutido na pagina (as tags <script>), para a analise de scripts. */
export function htmlScripts(buf: Buffer, max = 2 * 1024 * 1024): string | null {
  const text = buf.toString('utf8', 0, Math.min(buf.length, MAX_INPUT));
  const parts: string[] = [];
  let total = 0;
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const code = m[1].trim();
    if (!code) continue;
    parts.push(code);
    total += code.length;
    if (total >= max) break;
  }
  return parts.length ? parts.join('\n;\n').slice(0, max) : null;
}

// ------------------------------------------------------------------ MSI

/** Nome de stream do MSI (MS-MSI: cada caractere guarda dois do alfabeto base 64; 0x4840 = "!"). */
export function msiStreamName(raw: string): string {
  const mime = (x: number) =>
    x < 10
      ? String.fromCharCode(48 + x)
      : x < 36
        ? String.fromCharCode(55 + x)
        : x < 62
          ? String.fromCharCode(61 + x)
          : x === 62
            ? '.'
            : '_';
  let out = '';
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3800 && c < 0x4800) {
      const v = c - 0x3800;
      out += mime(v & 0x3f) + mime((v >> 6) & 0x3f);
    } else if (c >= 0x4800 && c < 0x4840) out += mime(c - 0x4800);
    else if (c === 0x4840) out += '!';
    else out += ch;
  }
  return out;
}

const MSITYPE_VALID = 0x0100;
const MSITYPE_STRING = 0x0800;
const MSITYPE_NULLABLE = 0x1000;

type MsiValue = string | number | null;

/** O banco do MSI: as streams, o pool de strings e as tabelas (guardadas por coluna). */
class MsiDb {
  streams = new Map<string, CfbEntry>();
  strings: string[] = [''];
  refSize: 2 | 3 = 2;
  private columns = new Map<string, { name: string; type: number }[]>();

  constructor(private cfb: Cfb) {
    for (const e of cfb.entries) if (e.type === 2) this.streams.set(msiStreamName(e.name), e);
    const pool = this.read('!_StringPool');
    const data = this.read('!_StringData');
    if (!pool || !data || pool.length < 4) throw new Error('_StringPool');
    const header = pool.readUInt32LE(0);
    if (header & 0x80000000) this.refSize = 3;
    const codepage = header & 0xffff;
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(
        codepage === 65001 ? 'utf-8' : codepage ? `windows-${codepage}` : 'latin1',
      );
    } catch {
      decoder = new TextDecoder('latin1');
    }
    const words = (i: number) => (i * 2 + 2 <= pool.length ? pool.readUInt16LE(i * 2) : 0);
    const count = pool.length / 4;
    let offset = 0;
    for (let i = 1; i < count && this.strings.length < 1_000_000;) {
      const len16 = words(i * 2);
      const refs = words(i * 2 + 1);
      if (!len16 && !refs) {
        this.strings.push('');
        i += 1;
        continue;
      }
      let len: number;
      if (!len16) {
        // Mais de 64 KB: a palavra alta vem nas refs desta entrada e a baixa na seguinte.
        len = (words(i * 2 + 3) << 16) + words(i * 2 + 2);
        i += 2;
      } else {
        len = len16;
        i += 1;
      }
      this.strings.push(decoder.decode(data.subarray(offset, offset + len)));
      offset += len;
    }
    // _Columns: Table (string), Number (i2), Name (string), Type (i2).
    const cols = this.raw('!_Columns', [this.refSize, 2, this.refSize, 2]);
    const numbered = new Map<string, { n: number; name: string; type: number }[]>();
    for (const [table, number, name, type] of cols) {
      const t = this.str(table);
      const list = numbered.get(t) ?? [];
      list.push({ n: number ^ 0x8000, name: this.str(name), type: (type ^ 0x8000) & 0xffff });
      numbered.set(t, list);
    }
    for (const [t, list] of numbered) {
      this.columns.set(
        t,
        list.sort((x, y) => x.n - y.n).map(({ name, type }) => ({ name, type })),
      );
    }
  }

  read(name: string): Buffer | null {
    const e = this.streams.get(name);
    return e ? this.cfb.read(e) : null;
  }

  private str(ref: number): string {
    return this.strings[ref] ?? '';
  }

  /** Linhas de uma stream guardada por coluna, com os tamanhos dados. */
  private raw(stream: string, sizes: number[]): number[][] {
    const buf = this.read(stream);
    if (!buf) return [];
    const rowSize = sizes.reduce((a, b) => a + b, 0);
    const rows = Math.floor(buf.length / rowSize);
    const out: number[][] = Array.from({ length: rows }, () => []);
    let at = 0;
    for (const size of sizes) {
      for (let r = 0; r < rows; r++, at += size) {
        out[r].push(
          size === 4
            ? buf.readUInt32LE(at)
            : size === 3
              ? buf.readUInt16LE(at) | (buf[at + 2] << 16)
              : buf.readUInt16LE(at),
        );
      }
    }
    return out;
  }

  tables(): string[] {
    return this.raw('!_Tables', [this.refSize]).map(([ref]) => this.str(ref));
  }

  /** Uma tabela como objetos (null: vazio). */
  table(name: string): Record<string, MsiValue>[] {
    const cols = this.columns.get(name);
    if (!cols) return [];
    const isBinary = (t: number) => (t & ~MSITYPE_NULLABLE) === (MSITYPE_STRING | MSITYPE_VALID);
    const sizes = cols.map(({ type }) =>
      isBinary(type) ? 2 : type & MSITYPE_STRING ? this.refSize : (type & 0xff) <= 2 ? 2 : 4,
    );
    return this.raw(`!${name}`, sizes).map((row) =>
      Object.fromEntries(
        cols.map(({ name: col, type }, i): [string, MsiValue] => {
          const v = row[i];
          if (isBinary(type)) return [col, null];
          if (type & MSITYPE_STRING) return [col, v ? this.str(v) : null];
          if (!v) return [col, null];
          return [col, sizes[i] === 2 ? ((v ^ 0x8000) << 16) >> 16 : (v ^ 0x80000000) | 0];
        }),
      ),
    );
  }
}

const SUSPICIOUS_CMD =
  /powershell|pwsh|cmd(?:\.exe)?\s+\/[ck]|mshta|rundll32|regsvr32|wscript|cscript|certutil|bitsadmin|curl|wget|https?:\/\/|-enc|frombase64/i;

/** O que uma CustomAction faz, pelo tipo (MS-MSI, CustomAction Table). */
function actionKind(type: number): string {
  const base = type & 0x07;
  const src = type & 0x30;
  const t = type & 0x3f;
  if (t === 19) return 'Mensagem de erro';
  if (t === 35) return 'Define um diretório';
  if (t === 51) return 'Define uma propriedade';
  if (base === 7) return 'Instalação aninhada';
  const what =
    base === 1
      ? 'DLL'
      : base === 2
        ? 'EXE'
        : base === 5
          ? 'JScript'
          : base === 6
            ? 'VBScript'
            : null;
  if (!what) return `Tipo ${type}`;
  if (src === 0x00) return `${what} da tabela Binary`;
  if (src === 0x10) return `${what} instalado pelo pacote`;
  if (src === 0x20) return base === 2 ? 'EXE com linha de comando' : `${what} embutido na ação`;
  return `${what} indicado numa propriedade`;
}

function actionFlags(type: number): string[] {
  const flags: string[] = [];
  if (type & 0x400) flags.push('adiada (durante a instalação)');
  if (type & 0x800) flags.push('como SYSTEM (sem personificação)');
  if (type & 0x40) flags.push('ignora erro');
  if (type & 0x80) flags.push('assíncrona');
  return flags;
}

function analyzeMsi(buf: Buffer): DeliveryResult | null {
  let db: MsiDb;
  try {
    db = new MsiDb(new Cfb(buf));
  } catch {
    return null;
  }
  const out = new Collector();
  const alerts: DeliveryInfo['alerts'] = [];
  const props = new Map(
    db.table('Property').map((r) => [String(r.Property ?? ''), String(r.Value ?? '')]),
  );
  const prop = (k: string) => props.get(k) || null;
  const rows = db.table('CustomAction').slice(0, MAX_ACTIONS);
  const actions: MsiCustomAction[] = rows.map((r) => {
    const type = Number(r.Type ?? 0);
    return {
      action: String(r.Action ?? ''),
      type,
      kind: actionKind(type),
      source: r.Source === null ? null : String(r.Source),
      target: r.Target === null ? null : String(r.Target).slice(0, 2000),
      flags: actionFlags(type),
    };
  });
  // Os itens da tabela Binary: o tipo da acao que os usa da a extensao (DLL, EXE, script).
  const binaryExt = new Map<string, string>();
  for (const a of actions) {
    const base = a.type & 0x07;
    if ((a.type & 0x30) === 0 && a.source) {
      binaryExt.set(
        a.source,
        base === 1 ? 'dll' : base === 2 ? 'exe' : base === 5 ? 'js' : base === 6 ? 'vbs' : '',
      );
    }
  }
  const binary: string[] = [];
  for (const [name, entry] of db.streams) {
    if (!name.startsWith('Binary.')) continue;
    const key = name.slice('Binary.'.length);
    binary.push(key);
    const data = db.read(name) ?? Buffer.alloc(0);
    if (!data.length) continue;
    const { id, ext } = typeOf(data);
    out.add(`${key}.${binaryExt.get(key) || ext}`, data, name, id);
    void entry;
  }
  for (const a of actions) {
    const base = a.type & 0x07;
    const src = a.type & 0x30;
    const system = Boolean(a.type & 0x800);
    if ((base === 5 || base === 6) && src === 0x20 && a.target) {
      // Script na propria acao: vira arquivo, que a analise de scripts le.
      out.add(
        `${a.action}.${base === 5 ? 'js' : 'vbs'}`,
        Buffer.from(a.target),
        `ação ${a.action}`,
        base === 5 ? 'js' : 'vbs',
      );
    }
    if (base === 5 || base === 6) {
      alerts.push({
        level: 'high',
        text: system ? `Ação ${a.action}: ${a.kind} (como SYSTEM)` : `Ação ${a.action}: ${a.kind}`,
      });
    } else if (base === 2 && (src === 0x20 || src === 0x30)) {
      const cmd = (a.target ?? '').slice(0, 300);
      const risky = SUSPICIOUS_CMD.test(cmd);
      alerts.push({
        level: risky ? 'high' : 'medium',
        text: risky
          ? system
            ? `Ação ${a.action} (como SYSTEM) roda: ${cmd}`
            : `Ação ${a.action} roda: ${cmd}`
          : system
            ? `Ação ${a.action} roda um programa (como SYSTEM)`
            : `Ação ${a.action} roda um programa`,
      });
    } else if ((base === 1 || base === 2) && src === 0x00) {
      const from = a.source ?? '?';
      alerts.push({
        level: 'medium',
        text: system
          ? `Ação ${a.action} carrega ${a.kind} (como SYSTEM) (${from})`
          : `Ação ${a.action} carrega ${a.kind} (${from})`,
      });
    }
  }
  // As midias embutidas (CAB), e qualquer stream que seja um CAB.
  for (const [name] of db.streams) {
    if (name.startsWith('!') || name.startsWith('Binary.') || name.startsWith('\u0005')) continue;
    const data = db.read(name);
    if (!data || data.toString('latin1', 0, 4) !== 'MSCF') continue;
    out.add(name.toLowerCase().endsWith('.cab') ? name : `${name}.cab`, data, name, 'cab');
  }
  const fileRows = db.table('File');
  const files = fileRows.slice(0, MAX_LISTED).map(
    (r) =>
      String(r.FileName ?? '')
        .split('|')
        .pop() ?? '',
  );
  return {
    info: {
      format: 'msi',
      risk: riskOf(alerts),
      alerts,
      files: out.files,
      msi: {
        product: {
          name: prop('ProductName'),
          manufacturer: prop('Manufacturer'),
          version: prop('ProductVersion'),
          code: prop('ProductCode'),
        },
        customActions: actions,
        binary,
        files,
        filesTotal: fileRows.length,
        tables: db.tables().slice(0, 200),
      },
    },
    payloads: out.payloads,
  };
}

// ------------------------------------------------------------------ entrada

/** OneNote, HTML ou MSI; null se nao for um deles (ou se a leitura falhar). */
export function analyzeDelivery(
  buf: Buffer,
  filename: string | null | undefined,
  detectedId: string | null | undefined,
): DeliveryResult | null {
  if (buf.length > MAX_INPUT) return null;
  try {
    if (isOneNote(buf)) return analyzeOneNote(buf);
    if (detectedId === 'ole') return analyzeMsi(buf);
    if (isHtmlLike(buf, filename, detectedId ?? null)) return analyzeHtml(buf);
  } catch {
    return null;
  }
  return null;
}
