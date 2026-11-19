import { entropy } from './entropy';
import { detectType } from './file-type';
import type { PeImage } from './pe-analysis';

/**
 * Recursos do PE (item 7.1): a arvore tipo > nome > idioma, o que ha dentro de cada um (um
 * executavel escondido num RCDATA e o caso classico de dropper), as informacoes de versao e o
 * manifesto. A arvore e de offsets que o arquivo controla: ha teto de entradas e de profundidade,
 * e cada diretorio e visitado uma vez so (um laco nao prende o parser).
 */

/** Recursos listados (o resto so e contado). */
const MAX_LISTED = 200;
/** Entradas de diretorio visitadas no total. */
const MAX_ENTRIES = 10_000;
/** Bytes somados na entropia dos recursos; depois, cada um entra por uma amostra. */
const ENTROPY_BUDGET = 32 * 1024 * 1024;
const ENTROPY_SAMPLE = 64 * 1024;
const MAX_VERSION_STRINGS = 64;

export interface PeResource {
  /** Tipo padrao pelo nome (RCDATA, ICON...), nome proprio, ou `#N`. */
  type: string;
  name: string;
  lang: number;
  size: number;
  entropy: number;
  /** Conteudo reconhecido pela assinatura (pe, zip, png...), quando ha. */
  content: string | null;
}

const RT: Record<number, string> = {
  1: 'CURSOR',
  2: 'BITMAP',
  3: 'ICON',
  4: 'MENU',
  5: 'DIALOG',
  6: 'STRING',
  7: 'FONTDIR',
  8: 'FONT',
  9: 'ACCELERATOR',
  10: 'RCDATA',
  11: 'MESSAGETABLE',
  12: 'GROUP_CURSOR',
  14: 'GROUP_ICON',
  16: 'VERSION',
  17: 'DLGINCLUDE',
  19: 'PLUGPLAY',
  20: 'VXD',
  21: 'ANICURSOR',
  22: 'ANIICON',
  23: 'HTML',
  24: 'MANIFEST',
};

/** Recurso com a posicao no arquivo (offset -1: fora dos bytes do arquivo). */
export interface ResourceLeaf {
  typeId: number | null;
  type: string;
  name: string;
  lang: number;
  offset: number;
  size: number;
}

/**
 * As folhas da arvore de recursos, na ordem da lista da ficha (os MAX_LISTED primeiros), e o total.
 * O download de um recurso (item 30) usa o indice dessa lista.
 */
export function resourceLeaves(pe: PeImage): { leaves: ResourceLeaf[]; total: number } {
  const dir = pe.dir(2);
  const root = dir ? pe.rvaToOffset(dir.rva) : -1;
  if (!dir || root < 0) return { leaves: [], total: 0 };
  const { buf, u16, u32 } = pe;

  const leaves: ResourceLeaf[] = [];
  let visited = 0;
  let total = 0;
  const seen = new Set<number>();
  const label = (raw: number) => {
    if (raw & 0x80000000) {
      const at = root + (raw & 0x7fffffff);
      const len = u16(at);
      if (len === null || at + 2 + len * 2 > buf.length) return null;
      return buf.toString('utf16le', at + 2, at + 2 + Math.min(len, 128) * 2);
    }
    return null;
  };

  const walk = (at: number, depth: number, path: { id: number | null; text: string }[]) => {
    if (seen.has(at) || at < 0 || at + 16 > buf.length) return;
    seen.add(at);
    const count = (u16(at + 12) ?? 0) + (u16(at + 14) ?? 0);
    for (let i = 0; i < count && visited < MAX_ENTRIES; i++) {
      visited++;
      const e = at + 16 + i * 8;
      const nameField = u32(e);
      const target = u32(e + 4);
      if (nameField === null || target === null) return;
      const text = label(nameField);
      const id = nameField & 0x80000000 ? null : nameField & 0xffff;
      const here = [...path, { id, text: text ?? String(id) }];
      if (target & 0x80000000) {
        if (depth < 2) walk(root + (target & 0x7fffffff), depth + 1, here);
        continue;
      }
      if (depth !== 2) continue;
      // Folha: entrada de dados com RVA e tamanho.
      const entry = root + target;
      const rva = u32(entry);
      const size = u32(entry + 4);
      if (rva === null || size === null) continue;
      total++;
      if (leaves.length >= MAX_LISTED) continue;
      const [type, name, lang] = here;
      leaves.push({
        typeId: type.id,
        type: type.id !== null ? (RT[type.id] ?? `#${type.id}`) : type.text,
        name: name.text,
        lang: lang.id ?? 0,
        offset: pe.rvaToOffset(rva),
        size,
      });
    }
  };
  walk(root, 0, []);
  return { leaves, total };
}

export function analyzeResources(pe: PeImage): {
  resources: PeResource[];
  truncated: boolean;
  version: Record<string, string> | null;
  manifest: { executionLevel: string | null; uiAccess: boolean } | null;
  /** As folhas com a posicao no arquivo (para o icone principal; nao vao na ficha). */
  leaves: ResourceLeaf[];
} {
  const { leaves, total } = resourceLeaves(pe);
  if (!leaves.length) {
    return { resources: [], truncated: false, version: null, manifest: null, leaves };
  }
  const { buf } = pe;

  let budget = ENTROPY_BUDGET;
  const resources: PeResource[] = leaves.map((leaf) => {
    const inFile =
      leaf.offset >= 0 ? Math.max(0, Math.min(leaf.size, buf.length - leaf.offset)) : 0;
    const span = Math.min(inFile, budget > 0 ? budget : ENTROPY_SAMPLE);
    budget -= span;
    const data = inFile ? buf.subarray(leaf.offset, leaf.offset + span) : Buffer.alloc(0);
    return {
      type: leaf.type,
      name: leaf.name,
      lang: leaf.lang,
      size: leaf.size,
      entropy: data.length ? entropy(data, 0, data.length) : 0,
      content: data.length ? (detectType(data)?.id ?? null) : null,
    };
  });

  const dataOf = (typeId: number) => {
    const leaf = leaves.find((l) => l.typeId === typeId && l.offset >= 0);
    return leaf ? buf.subarray(leaf.offset, Math.min(buf.length, leaf.offset + leaf.size)) : null;
  };
  const versionData = dataOf(16);
  const manifestData = dataOf(24);
  return {
    resources,
    truncated: total > leaves.length,
    version: versionData ? parseVersionInfo(versionData) : null,
    manifest: manifestData ? parseManifest(manifestData) : null,
    leaves,
  };
}

/** VS_VERSIONINFO: as strings do StringFileInfo (CompanyName, OriginalFilename...). */
export function parseVersionInfo(data: Buffer): Record<string, string> | null {
  const align = (o: number) => (o + 3) & ~3;
  const node = (off: number, limit: number) => {
    if (off + 6 > limit) return null;
    const len = data.readUInt16LE(off);
    const valueLen = data.readUInt16LE(off + 2);
    const text = data.readUInt16LE(off + 4) === 1;
    const end = off + len;
    if (len < 6 || end > limit) return null;
    let p = off + 6;
    let key = '';
    while (p + 2 <= end && key.length < 64) {
      const c = data.readUInt16LE(p);
      p += 2;
      if (!c) break;
      key += String.fromCharCode(c);
    }
    p = align(p);
    const valueBytes = Math.min(text ? valueLen * 2 : valueLen, Math.max(0, end - p));
    return { key, value: data.subarray(p, p + valueBytes), children: align(p + valueBytes), end };
  };
  const children = (parent: { children: number; end: number }) => {
    const out: NonNullable<ReturnType<typeof node>>[] = [];
    let c = parent.children;
    while (c < parent.end && out.length < 256) {
      const child = node(c, parent.end);
      if (!child) break;
      out.push(child);
      c = align(child.end);
    }
    return out;
  };
  const root = node(0, data.length);
  if (!root || root.key !== 'VS_VERSION_INFO') return null;
  const strings: Record<string, string> = {};
  let n = 0;
  for (const info of children(root)) {
    if (info.key !== 'StringFileInfo') continue;
    for (const table of children(info)) {
      for (const s of children(table)) {
        if (n++ >= MAX_VERSION_STRINGS) break;
        const value = s.value.toString('utf16le').replace(/\0+$/, '').slice(0, 512);
        if (s.key) strings[s.key] = value;
      }
    }
  }
  return Object.keys(strings).length ? strings : null;
}

/** Manifesto (XML): o nivel de execucao que o programa pede ao Windows. */
export function parseManifest(data: Buffer): { executionLevel: string | null; uiAccess: boolean } {
  const text = data.subarray(0, 64 * 1024).toString('utf8');
  const tag = /<(?:\w+:)?requestedExecutionLevel\b([^>]*)>/i.exec(text)?.[1] ?? '';
  return {
    executionLevel: /\blevel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null,
    uiAccess: /\buiAccess\s*=\s*["']true["']/i.test(tag),
  };
}
