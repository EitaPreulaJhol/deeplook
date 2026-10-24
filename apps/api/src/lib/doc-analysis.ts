import { inflateSync } from 'node:zlib';

import { extractZipEntry, listZip } from './zip';

/**
 * Analise de documentos (item 70): PDF, Office moderno (OOXML), Office antigo
 * (OLE/CFB) e RTF. So le bytes, com limites (zip bomb, streams enormes,
 * recursao); nada e executado. Falhas viram "sem dados", nunca excecao.
 */

export type AlertLevel = 'high' | 'medium' | 'info';

export interface MacroModule {
  name: string;
  lines: number;
  /** Rotinas que rodam sozinhas (AutoOpen, Document_Open...). */
  autoExec: string[];
  /** Chamadas suspeitas encontradas (Shell, URLDownloadToFile...). */
  suspicious: string[];
  /** Codigo-fonte (cortado em MAX_CODE). */
  code: string;
  truncated: boolean;
}

export interface DocumentInfo {
  format: 'pdf' | 'ooxml' | 'ole' | 'rtf';
  risk: 'high' | 'medium' | 'low';
  alerts: { level: AlertLevel; text: string }[];
  pdf?: {
    pages: number | null;
    javascript: boolean;
    openAction: boolean;
    additionalActions: boolean;
    launch: boolean;
    embeddedFiles: number;
    forms: boolean;
    xfa: boolean;
    encrypted: boolean;
  };
  office?: {
    macros: boolean;
    modules: MacroModule[];
    externalLinks: string[];
    remoteTemplate: string | null;
    embedded: string[];
    dde: boolean;
  };
  /** Links do documento (URI do PDF, relacoes externas do Office). */
  links: string[];
}

const MAX_CODE = 20_000;
const MAX_CODE_TOTAL = 100_000;
const MAX_LINKS = 100;
const MAX_INFLATE_STREAM = 8 * 1024 * 1024;
const MAX_INFLATE_TOTAL = 32 * 1024 * 1024;
const MAX_ZIP_PART = 32 * 1024 * 1024;

const AUTOEXEC = [
  'AutoOpen',
  'AutoClose',
  'AutoExec',
  'AutoNew',
  'Auto_Open',
  'Auto_Close',
  'Document_Open',
  'Document_Close',
  'DocumentOpen',
  'Document_New',
  'Workbook_Open',
  'Workbook_Activate',
  'Workbook_BeforeClose',
  'Presentation_Open',
];

const SUSPICIOUS = [
  'Shell',
  'WScript.Shell',
  'CreateObject',
  'GetObject',
  'URLDownloadToFile',
  'XMLHTTP',
  'WinHttp',
  'ADODB.Stream',
  'SaveToFile',
  'PowerShell',
  'cmd.exe',
  'CallByName',
  'Environ',
  'StrReverse',
  'Chr(',
  'ChrW(',
  'Base64',
  'winmgmts',
  'RegWrite',
  'Kill ',
  'Lib "kernel32"',
  'VirtualAlloc',
  'RtlMoveMemory',
  'CreateThread',
  'ExecuteExcel4Macro',
  'MacroOptions',
];

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function scanCode(code: string): { autoExec: string[]; suspicious: string[] } {
  const lower = code.toLowerCase();
  return {
    autoExec: AUTOEXEC.filter((name) =>
      new RegExp(`\\b(sub|function)\\s+${name}\\b`, 'i').test(code),
    ),
    suspicious: SUSPICIOUS.filter((word) => lower.includes(word.toLowerCase())),
  };
}

// ------------------------------------------------------------------ PDF

/** Decodifica escapes #hh nos nomes do PDF (/J#61vaScript -> /JavaScript). */
function decodePdfNames(text: string): string {
  return text.replace(/\/[^\s/<>[\]()]+/g, (name) =>
    name.includes('#')
      ? name.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
      : name,
  );
}

/** Texto do PDF mais o conteudo dos streams FlateDecode (com limites). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts = [raw];
  let total = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && total < MAX_INFLATE_TOTAL) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dict = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/FlateDecode/.test(decodePdfNames(dict))) {
      try {
        const out = inflateSync(buf.subarray(start, end), {
          maxOutputLength: MAX_INFLATE_STREAM,
        });
        total += out.length;
        parts.push(out.toString('latin1'));
      } catch {
        /* stream corrompido ou maior que o limite: segue */
      }
    }
    re.lastIndex = end;
  }
  return decodePdfNames(parts.join('\n'));
}

/** String literal do PDF: (texto com \) escapados). */
function pdfString(text: string, from: number): string {
  let depth = 0;
  let out = '';
  for (let i = from; i < text.length && out.length < 2000; i++) {
    const c = text[i];
    if (c === '\\') {
      out += text[++i] ?? '';
      continue;
    }
    if (c === '(') {
      if (depth++ === 0) continue;
    } else if (c === ')') {
      if (--depth === 0) break;
    }
    if (depth > 0) out += c;
  }
  return out;
}

export function analyzePdf(buf: Buffer): DocumentInfo {
  const text = pdfText(buf);
  const has = (re: RegExp) => re.test(text);
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const links: string[] = [];
  const uriRe = /\/URI\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = uriRe.exec(text)) && links.length < MAX_LINKS) {
    const value = pdfString(text, m.index + m[0].length - 1).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) links.push(value);
  }
  const pdf = {
    pages: count(/\/Type\s*\/Page\b(?!s)/g) || null,
    javascript: has(/\/(JavaScript|JS)\b/),
    openAction: has(/\/OpenAction\b/),
    additionalActions: has(/\/AA\b/),
    launch: has(/\/Launch\b/),
    embeddedFiles: count(/\/EmbeddedFile\b/g),
    forms: has(/\/AcroForm\b/),
    xfa: has(/\/XFA\b/),
    encrypted: has(/\/Encrypt\b/),
  };
  const alerts: DocumentInfo['alerts'] = [];
  if (pdf.javascript) alerts.push({ level: 'high', text: 'Contém JavaScript.' });
  if (pdf.launch) alerts.push({ level: 'high', text: 'Ação "Launch": pode abrir programas.' });
  if (pdf.openAction || pdf.additionalActions) {
    alerts.push({
      level: pdf.javascript || pdf.launch ? 'high' : 'medium',
      text: 'Ação automática ao abrir ou interagir (OpenAction/AA).',
    });
  }
  if (pdf.embeddedFiles) {
    alerts.push({ level: 'medium', text: `${pdf.embeddedFiles} arquivo(s) embutido(s).` });
  }
  if (pdf.xfa) alerts.push({ level: 'medium', text: 'Formulário XFA (pode conter scripts).' });
  if (pdf.encrypted)
    alerts.push({
      level: 'info',
      text: 'Criptografado: parte do conteúdo pode não ter sido lida.',
    });
  if (links.length) alerts.push({ level: 'info', text: `${links.length} link(s) no documento.` });
  return { format: 'pdf', risk: riskOf(alerts), alerts, pdf, links: uniq(links) };
}

// ------------------------------------------------------------------ OLE / CFB

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

interface CfbEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** Leitor minimo do formato OLE (Compound File Binary), so leitura e com limites. */
class Cfb {
  private sectorSize: number;
  private fat: number[] = [];
  private miniFat: number[] = [];
  private miniStream: Buffer = Buffer.alloc(0);
  entries: CfbEntry[] = [];

  constructor(private buf: Buffer) {
    if (buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error('não é OLE');
    this.sectorSize = 1 << buf.readUInt16LE(30);
    const miniSectorShift = buf.readUInt16LE(32);
    if (miniSectorShift !== 6) throw new Error('OLE incomum');
    const numFatSectors = buf.readUInt32LE(44);
    const dirStart = buf.readUInt32LE(48);
    const miniFatStart = buf.readUInt32LE(60);
    let difatSector = buf.readUInt32LE(68);
    // DIFAT: 109 no cabecalho + cadeia.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
      fatSectors.push(buf.readUInt32LE(76 + i * 4));
    }
    let guard = 0;
    while (
      difatSector !== ENDOFCHAIN &&
      difatSector !== FREESECT &&
      fatSectors.length < numFatSectors &&
      guard++ < 10_000
    ) {
      const off = this.offset(difatSector);
      const per = this.sectorSize / 4 - 1;
      for (let i = 0; i < per && fatSectors.length < numFatSectors; i++) {
        fatSectors.push(buf.readUInt32LE(off + i * 4));
      }
      difatSector = buf.readUInt32LE(off + per * 4);
    }
    for (const s of fatSectors) {
      const off = this.offset(s);
      for (let i = 0; i < this.sectorSize / 4; i++) this.fat.push(buf.readUInt32LE(off + i * 4));
    }
    const dir = this.chain(dirStart);
    for (let i = 0; i + 128 <= dir.length; i += 128) {
      const nameLen = dir.readUInt16LE(i + 64);
      this.entries.push({
        name: dir.toString('utf16le', i, i + Math.max(0, Math.min(64, nameLen) - 2)),
        type: dir[i + 66],
        left: dir.readUInt32LE(i + 68),
        right: dir.readUInt32LE(i + 72),
        child: dir.readUInt32LE(i + 76),
        start: dir.readUInt32LE(i + 116),
        size: dir.readUInt32LE(i + 120),
      });
    }
    if (miniFatStart !== ENDOFCHAIN) {
      const mf = this.chain(miniFatStart);
      for (let i = 0; i + 4 <= mf.length; i += 4) this.miniFat.push(mf.readUInt32LE(i));
    }
    const root = this.entries[0];
    if (root) this.miniStream = this.chain(root.start, root.size);
  }

  private offset(sector: number): number {
    const off = (sector + 1) * this.sectorSize;
    if (off + this.sectorSize > this.buf.length) throw new Error('setor fora do arquivo');
    return off;
  }

  private chain(start: number, size = Infinity): Buffer {
    const parts: Buffer[] = [];
    let s = start;
    let total = 0;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && total < size && guard++ < 200_000) {
      parts.push(this.buf.subarray(this.offset(s), this.offset(s) + this.sectorSize));
      total += this.sectorSize;
      s = this.fat[s] ?? ENDOFCHAIN;
    }
    const out = Buffer.concat(parts);
    return size === Infinity ? out : out.subarray(0, size);
  }

  read(entry: CfbEntry): Buffer {
    if (entry.size < 4096 && entry.type === 2) {
      const parts: Buffer[] = [];
      let s = entry.start;
      let guard = 0;
      while (s !== ENDOFCHAIN && s !== FREESECT && guard++ < 100_000) {
        parts.push(this.miniStream.subarray(s * 64, s * 64 + 64));
        s = this.miniFat[s] ?? ENDOFCHAIN;
      }
      return Buffer.concat(parts).subarray(0, entry.size);
    }
    return this.chain(entry.start, entry.size);
  }

  /** Filhos de um armazenamento (arvore de irmaos). */
  children(index: number): number[] {
    const out: number[] = [];
    const visit = (i: number, depth: number) => {
      if (i === FREESECT || i >= this.entries.length || depth > 64 || out.length > 10_000) return;
      const e = this.entries[i];
      visit(e.left, depth + 1);
      out.push(i);
      visit(e.right, depth + 1);
    };
    visit(this.entries[index]?.child ?? FREESECT, 0);
    return out;
  }

  /** Todos os armazenamentos/streams com o caminho ("Macros/VBA/dir"). */
  paths(): { path: string; index: number }[] {
    const out: { path: string; index: number }[] = [];
    const walk = (index: number, prefix: string, depth: number) => {
      if (depth > 16) return;
      for (const child of this.children(index)) {
        const e = this.entries[child];
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        out.push({ path, index: child });
        if (e.type === 1) walk(child, path, depth + 1);
      }
    };
    walk(0, '', 0);
    return out;
  }
}

/** Descompressao do VBA (MS-OVBA 2.4.1). */
export function ovbaDecompress(buf: Buffer, start = 0): Buffer {
  if (buf[start] !== 0x01) throw new Error('container VBA inválido');
  const out: number[] = [];
  let pos = start + 1;
  while (pos + 2 <= buf.length) {
    const header = buf.readUInt16LE(pos);
    const chunkSize = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const chunkEnd = Math.min(pos + chunkSize, buf.length);
    pos += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && pos < buf.length; i++) out.push(buf[pos++]);
      continue;
    }
    while (pos < chunkEnd) {
      const flags = buf[pos++];
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        if ((flags & (1 << bit)) === 0) {
          out.push(buf[pos++]);
        } else {
          const token = buf.readUInt16LE(pos);
          pos += 2;
          const current = out.length - chunkStart;
          const bitCount = Math.max(Math.ceil(Math.log2(current || 1)), 4);
          const lengthMask = 0xffff >>> bitCount;
          const length = (token & lengthMask) + 3;
          const offset = (token >>> (16 - bitCount)) + 1;
          const from = out.length - offset;
          if (from < 0) throw new Error('VBA corrompido');
          for (let i = 0; i < length; i++) out.push(out[from + i]);
        }
      }
      if (out.length > 16 * 1024 * 1024) throw new Error('VBA grande demais');
    }
  }
  return Buffer.from(out);
}

/** Modulos de macro a partir do armazenamento VBA (dir + streams dos modulos). */
function vbaModules(cfb: Cfb): MacroModule[] {
  const paths = cfb.paths();
  const dirEntry = paths.find((p) => /(^|\/)VBA\/dir$/i.test(p.path));
  if (!dirEntry) return [];
  const vbaPrefix = dirEntry.path.slice(0, -'dir'.length);
  const dir = ovbaDecompress(cfb.read(cfb.entries[dirEntry.index]));
  const modules: { name: string; stream: string; offset: number }[] = [];
  let current: { name: string; stream: string; offset: number } | null = null;
  let pos = 0;
  while (pos + 6 <= dir.length) {
    const id = dir.readUInt16LE(pos);
    let size = dir.readUInt32LE(pos + 2);
    // PROJECTVERSION tem 6 bytes de dados apesar do tamanho 4.
    if (id === 0x0009) size = 6;
    const data = dir.subarray(pos + 6, pos + 6 + size);
    pos += 6 + size;
    if (id === 0x0019) {
      current = { name: data.toString('latin1'), stream: data.toString('latin1'), offset: 0 };
      modules.push(current);
    } else if (id === 0x001a && current) current.stream = data.toString('latin1');
    else if (id === 0x0031 && current) current.offset = data.readUInt32LE(0);
  }
  let budget = MAX_CODE_TOTAL;
  const out: MacroModule[] = [];
  for (const mod of modules) {
    const entry = paths.find(
      (p) => p.path.toLowerCase() === `${vbaPrefix}${mod.stream}`.toLowerCase(),
    );
    if (!entry) continue;
    let code: string;
    try {
      // Pedacos sem compressao vem completados com NUL: tirados do fim.
      code = ovbaDecompress(cfb.read(cfb.entries[entry.index]), mod.offset)
        .toString('latin1')
        .replace(/\0+$/, '');
    } catch {
      continue;
    }
    const { autoExec, suspicious } = scanCode(code);
    const limit = Math.max(0, Math.min(MAX_CODE, budget));
    budget -= Math.min(code.length, limit);
    out.push({
      name: mod.name,
      lines: code.split(/\r?\n/).length,
      autoExec,
      suspicious,
      code: code.slice(0, limit),
      truncated: code.length > limit,
    });
  }
  return out;
}

function officeAlerts(office: NonNullable<DocumentInfo['office']>): DocumentInfo['alerts'] {
  const alerts: DocumentInfo['alerts'] = [];
  if (office.macros) {
    const auto = uniq(office.modules.flatMap((m) => m.autoExec));
    const sus = uniq(office.modules.flatMap((m) => m.suspicious));
    alerts.push({
      level: auto.length || sus.length ? 'high' : 'medium',
      text: `Contém macros VBA (${office.modules.length} módulo(s))${auto.length ? `; executam ao abrir: ${auto.join(', ')}` : ''}.`,
    });
    if (sus.length)
      alerts.push({ level: 'high', text: `Chamadas suspeitas nas macros: ${sus.join(', ')}.` });
  }
  if (office.remoteTemplate) {
    alerts.push({
      level: 'high',
      text: `Template remoto (baixado ao abrir): ${office.remoteTemplate}`,
    });
  }
  if (office.dde) alerts.push({ level: 'high', text: 'Campo DDE (pode executar comandos).' });
  if (office.embedded.length) {
    alerts.push({ level: 'medium', text: `${office.embedded.length} objeto(s) embutido(s).` });
  }
  if (office.externalLinks.length) {
    alerts.push({ level: 'info', text: `${office.externalLinks.length} link(s) externo(s).` });
  }
  return alerts;
}

export function analyzeOle(buf: Buffer): DocumentInfo {
  const cfb = new Cfb(buf);
  const paths = cfb.paths();
  const modules = vbaModules(cfb);
  const office = {
    macros:
      modules.length > 0 || paths.some((p) => /(^|\/)(_VBA_PROJECT_CUR|Macros|VBA)$/i.test(p.path)),
    modules,
    externalLinks: [],
    remoteTemplate: null,
    embedded: paths.filter((p) => /^ObjectPool\/[^/]+$/i.test(p.path)).map((p) => p.path),
    dde: /DDEAUTO|\bDDE\s/i.test(buf.toString('latin1')),
  };
  const alerts = officeAlerts(office);
  return { format: 'ole', risk: riskOf(alerts), alerts, office, links: [] };
}

// ------------------------------------------------------------------ OOXML

export function analyzeOoxml(buf: Buffer): DocumentInfo {
  const entries = listZip(buf).filter((e) => !e.dir);
  const read = (path: string) => {
    const entry = entries.find((e) => e.path === path);
    return entry ? extractZipEntry(buf, entry, '', MAX_ZIP_PART) : null;
  };
  let modules: MacroModule[] = [];
  const vba = entries.find((e) => /(^|\/)vbaProject\.bin$/i.test(e.path));
  if (vba) {
    try {
      modules = vbaModules(new Cfb(extractZipEntry(buf, vba, '', MAX_ZIP_PART)));
    } catch {
      modules = [];
    }
  }
  const externalLinks: string[] = [];
  let remoteTemplate: string | null = null;
  for (const rel of entries.filter((e) => e.path.endsWith('.rels'))) {
    const xml = read(rel.path)?.toString('utf8') ?? '';
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      if (!/TargetMode="External"/i.test(tag)) continue;
      const target = /Target="([^"]*)"/.exec(tag)?.[1]?.replace(/&amp;/g, '&');
      if (!target) continue;
      if (/attachedTemplate/i.test(tag)) remoteTemplate = target;
      if (externalLinks.length < MAX_LINKS) externalLinks.push(target);
    }
  }
  const main = entries.find((e) =>
    /^(word\/document\.xml|xl\/workbook\.xml|ppt\/presentation\.xml)$/.test(e.path),
  );
  const mainXml = main ? (read(main.path)?.toString('utf8') ?? '') : '';
  const office = {
    macros: Boolean(vba),
    modules,
    externalLinks: uniq(externalLinks),
    remoteTemplate,
    embedded: entries.filter((e) => /\/embeddings\//.test(e.path)).map((e) => e.path),
    dde: /DDEAUTO|instrText[^>]*>\s*DDE\b/i.test(mainXml),
  };
  const alerts = officeAlerts(office);
  return {
    format: 'ooxml',
    risk: riskOf(alerts),
    alerts,
    office,
    links: office.externalLinks.filter((l) => /^[a-z][a-z0-9+.-]*:/i.test(l)),
  };
}

// ------------------------------------------------------------------ RTF

export function analyzeRtf(buf: Buffer): DocumentInfo {
  const text = buf.toString('latin1', 0, Math.min(buf.length, 16 * 1024 * 1024));
  const objects = (text.match(/\\object\b/g) ?? []).length;
  const objData = /\\objdata\b/.test(text);
  const objUpdate = /\\objupdate\b/.test(text);
  const alerts: DocumentInfo['alerts'] = [];
  if (objects || objData) {
    alerts.push({
      level: objUpdate ? 'high' : 'medium',
      text: `${objects || 1} objeto(s) OLE embutido(s)${objUpdate ? ' com atualização automática (\\objupdate)' : ''}.`,
    });
  }
  const links = uniq([...text.matchAll(/HYPERLINK\s+"([^"]+)"/g)].map((m) => m[1])).slice(
    0,
    MAX_LINKS,
  );
  if (links.length) alerts.push({ level: 'info', text: `${links.length} link(s) no documento.` });
  return {
    format: 'rtf',
    risk: riskOf(alerts),
    alerts,
    office: {
      macros: false,
      modules: [],
      externalLinks: links,
      remoteTemplate: null,
      embedded: objects ? [`${objects} objeto(s)`] : [],
      dde: /DDEAUTO/i.test(text),
    },
    links,
  };
}

function riskOf(alerts: DocumentInfo['alerts']): DocumentInfo['risk'] {
  if (alerts.some((a) => a.level === 'high')) return 'high';
  if (alerts.some((a) => a.level === 'medium')) return 'medium';
  return 'low';
}

/** Escolhe o analisador pelo tipo real; null se nao for documento ou falhar. */
export function analyzeDocument(
  buf: Buffer,
  detectedTypeId: string | null | undefined,
): DocumentInfo | null {
  try {
    if (detectedTypeId === 'pdf') return analyzePdf(buf);
    if (detectedTypeId === 'docx' || detectedTypeId === 'xlsx' || detectedTypeId === 'pptx') {
      return analyzeOoxml(buf);
    }
    if (detectedTypeId === 'ole') return analyzeOle(buf);
    if (buf.toString('latin1', 0, 5) === '{\\rtf') return analyzeRtf(buf);
  } catch {
    return null;
  }
  return null;
}
