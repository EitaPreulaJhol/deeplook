import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Mapa do arquivo (plans/analise-estatica-ampliada, item 27): a entropia por bloco, as marcas
 * (secoes, overlay, segmentos, arquivos do ZIP) e a estrutura do formato pelos leitores do Kaitai
 * Struct (apps/api/kaitai, gerados por scripts/vendor-kaitai.mjs com --read-pos): cada campo com o
 * caminho, onde comeca, onde termina e o valor, para o hex mostrar ao passar o mouse.
 */

export interface LayoutMark {
  kind: 'section' | 'overlay' | 'segment' | 'entry' | 'header';
  label: string;
  start: number;
  end: number;
}

export interface LayoutField {
  path: string;
  start: number;
  end: number;
  value: string;
}

const MAX_FIELDS = 20_000;
const MAX_DEPTH = 12;
const MAX_ARRAY = 400;

/** Entropia de Shannon (0 a 8) de cada bloco; os blocos crescem para caber em `blocks`. */
export function entropyBlocks(buf: Buffer, blocks = 512): { blockSize: number; values: number[] } {
  const blockSize = Math.max(256, Math.ceil(buf.length / blocks));
  const values: number[] = [];
  const counts = new Uint32Array(256);
  for (let at = 0; at < buf.length; at += blockSize) {
    counts.fill(0);
    const end = Math.min(buf.length, at + blockSize);
    for (let i = at; i < end; i++) counts[buf[i]]++;
    const n = end - at;
    let h = 0;
    for (const c of counts) if (c) h -= (c / n) * Math.log2(c / n);
    values.push(Math.round(h * 100) / 100);
  }
  return { blockSize, values };
}

// ------------------------------------------------------------------ Kaitai

const KAITAI_DIR = join(__dirname, '..', '..', 'kaitai');
const load = (name: string) =>
  createRequire(join(KAITAI_DIR, 'package.json'))(join(KAITAI_DIR, `${name}.js`))[name];

/** Qual leitor para o tipo detectado (lib/file-type.ts). */
const READERS: Record<string, string> = {
  pe: 'MicrosoftPe',
  elf: 'Elf',
  zip: 'Zip',
  docx: 'Zip',
  xlsx: 'Zip',
  pptx: 'Zip',
  jar: 'Zip',
  apk: 'Zip',
  xpi: 'Zip',
  msix: 'Zip',
  lnk: 'WindowsLnkFile',
};

type KObject = Record<string, unknown> & {
  _io?: unknown;
  _debug?: Record<
    string,
    { start?: number; end?: number; arr?: { start?: number; end?: number }[] }
  >;
};

const isStruct = (v: unknown): v is KObject =>
  typeof v === 'object' && v !== null && '_debug' in (v as object) && '_io' in (v as object);

function show(v: unknown): string {
  if (typeof v === 'number') return v > 9 ? `${v} (0x${v.toString(16)})` : String(v);
  if (typeof v === 'bigint') return `${v} (0x${v.toString(16)})`;
  if (typeof v === 'string') return JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Uint8Array) {
    const head = Buffer.from(v.subarray(0, 16)).toString('hex').replace(/(..)/g, '$1 ').trim();
    return `${v.length} byte(s): ${head}${v.length > 16 ? ' …' : ''}`;
  }
  return '';
}

/** Os getters das instancias (os campos "instances" do .ksy, lidos sob demanda). */
function instanceNames(obj: object): string[] {
  const names: string[] = [];
  let proto = Object.getPrototypeOf(obj);
  while (proto && proto !== Object.prototype) {
    for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (d.get && !name.startsWith('_')) names.push(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return names;
}

export function structure(
  buf: Buffer,
  typeId: string | null | undefined,
): { format: string | null; fields: LayoutField[]; error: string | null; root: KObject | null } {
  const reader = typeId ? READERS[typeId] : undefined;
  if (!reader) return { format: null, fields: [], error: null, root: null };
  const KaitaiStream = createRequire(join(KAITAI_DIR, 'package.json'))(
    'kaitai-struct/KaitaiStream',
  );
  const Cls = load(reader);
  const stream = new KaitaiStream(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  const root = new Cls(stream) as KObject & { _read: () => void };
  let error: string | null = null;
  try {
    root._read();
  } catch (err) {
    // O que foi lido antes do erro (arquivo cortado ou malformado) ainda vale.
    error = String((err as Error).message ?? err).slice(0, 200);
  }
  const fields: LayoutField[] = [];
  // Onde cada stream comeca no arquivo: o raiz em 0; um sub-stream onde o campo dele comeca.
  const bases = new Map<unknown, number>([[stream, 0]]);
  const seen = new Set<object>();

  const walk = (obj: KObject, path: string, depth: number) => {
    if (depth > MAX_DEPTH || seen.has(obj) || fields.length >= MAX_FIELDS) return;
    seen.add(obj);
    const base = bases.get(obj._io);
    // Instancias primeiro (le o cabecalho PE, as secoes...); depois os campos lidos.
    for (const name of instanceNames(obj)) {
      try {
        void (obj as Record<string, unknown>)[name];
      } catch {
        // Instancia fora do arquivo ou malformada: fica de fora.
      }
    }
    for (const [key, dbg] of Object.entries(obj._debug ?? {})) {
      if (fields.length >= MAX_FIELDS) return;
      const name = key.startsWith('_m_') ? key.slice(3) : key;
      const value = obj[key];
      const at = (d: { start?: number; end?: number }) =>
        base === undefined || d.start === undefined || d.end === undefined
          ? null
          : { start: base + d.start, end: base + d.end };
      const here = at(dbg);
      const child = `${path}.${name}`;
      const descend = (v: unknown, p: string, pos: { start: number } | null) => {
        if (!isStruct(v)) return;
        // O filho num sub-stream: o stream dele comeca onde o campo comeca no pai.
        if (!bases.has(v._io) && pos) bases.set(v._io, pos.start);
        walk(v, p, depth + 1);
      };
      if (Array.isArray(value)) {
        if (here) fields.push({ path: child, ...here, value: `${value.length} item(ns)` });
        value.slice(0, MAX_ARRAY).forEach((item, i) => {
          const pos = dbg.arr?.[i] ? at(dbg.arr[i]) : null;
          if (isStruct(item)) {
            if (pos) fields.push({ path: `${child}[${i}]`, ...pos, value: '' });
            descend(item, `${child}[${i}]`, pos);
          } else if (pos) fields.push({ path: `${child}[${i}]`, ...pos, value: show(item) });
        });
      } else if (isStruct(value)) {
        if (here) fields.push({ path: child, ...here, value: '' });
        descend(value, child, here);
      } else if (here) {
        fields.push({ path: child, ...here, value: show(value) });
      }
    }
  };
  walk(root, reader, 0);
  return { format: reader, fields: fields.filter((f) => f.end > f.start), error, root };
}

const ELF_SEGMENTS: Record<number, string> = {
  1: 'LOAD',
  2: 'DYNAMIC',
  3: 'INTERP',
  4: 'NOTE',
  6: 'PHDR',
  7: 'TLS',
  0x6474e550: 'GNU_EH_FRAME',
  0x6474e551: 'GNU_STACK',
  0x6474e552: 'GNU_RELRO',
  0x6474e553: 'GNU_PROPERTY',
};

/** As marcas do mapa a partir do que o leitor achou. */
export function marksOf(
  format: string | null,
  root: KObject | null,
  size: number,
  fields: LayoutField[],
): LayoutMark[] {
  const marks: LayoutMark[] = [];
  const get = (o: unknown, k: string): unknown => {
    try {
      return (o as Record<string, unknown>)?.[k];
    } catch {
      return undefined;
    }
  };
  if (format === 'MicrosoftPe') {
    const pe = get(root, 'pe');
    const sections = (get(pe, 'sections') as unknown[]) ?? [];
    let last = 0;
    for (const s of sections) {
      const start = Number(get(s, 'pointerToRawData') ?? 0);
      const len = Number(get(s, 'sizeOfRawData') ?? 0);
      if (len > 0 && start < size) {
        marks.push({
          kind: 'section',
          label: String(get(s, 'name') ?? '?'),
          start,
          end: Math.min(size, start + len),
        });
        last = Math.max(last, start + len);
      }
    }
    if (last > 0 && last < size)
      marks.push({ kind: 'overlay', label: 'overlay', start: last, end: size });
  } else if (format === 'Elf') {
    const header = get(root, 'header');
    const segments = (get(header, 'programHeaders') as unknown[]) ?? [];
    for (const p of segments) {
      const start = Number(get(p, 'ofsBody') ?? 0);
      const len = Number(get(p, 'lenBody') ?? 0);
      if (len > 0 && start < size) {
        const type = Number(get(p, 'type'));
        marks.push({
          kind: 'segment',
          label: ELF_SEGMENTS[type] ?? `0x${type.toString(16)}`,
          start,
          end: Math.min(size, start + len),
        });
      }
    }
  } else if (format === 'Zip') {
    for (const f of fields) {
      const m = /^Zip\.sections\[\d+\]$/.exec(f.path);
      if (m)
        marks.push({
          kind: 'entry',
          label: f.path.replace('Zip.', ''),
          start: f.start,
          end: f.end,
        });
      if (marks.length >= 200) break;
    }
  }
  return marks.slice(0, 300);
}
