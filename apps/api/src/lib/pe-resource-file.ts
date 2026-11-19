import { detectType } from './file-type';
import type { PeImage } from './pe-analysis';
import type { ResourceLeaf } from './pe-resources';

/**
 * Arquivo de um recurso do PE, para baixar separado (plans/analise-estatica-ampliada, item 30). O
 * recurso fica no executavel num formato que nenhum programa abre sozinho: o icone e o cursor sao
 * guardados aos pedacos (o grupo aponta para as imagens, cada uma num recurso), e o bitmap vem sem
 * o cabecalho de arquivo. Aqui eles sao remontados como .ico, .cur e .bmp; o resto sai como esta,
 * com a extensao do conteudo reconhecido.
 */

export interface ResourceFile {
  /** Nome sugerido: TIPO_NOME_IDIOMA.ext, so com caracteres seguros. */
  name: string;
  data: Buffer;
  /** Imagem (icone, cursor, bitmap, PNG...): sai como arquivo; o resto, dentro do ZIP com senha. */
  image: boolean;
}

const RT_CURSOR = 1;
const RT_BITMAP = 2;
const RT_ICON = 3;
const RT_GROUP_CURSOR = 12;
const RT_GROUP_ICON = 14;
const RT_MANIFEST = 24;
/** Imagens por grupo (um .ico real tem ate uma dezena). */
const MAX_GROUP = 64;
const IMAGE_KINDS = new Set(['png', 'jpeg', 'gif', 'bmp', 'ico']);

const safe = (text: string) => text.replace(/[^\w.-]+/g, '_').slice(0, 80) || '_';

function bytesOf(pe: PeImage, leaf: ResourceLeaf): Buffer | null {
  if (leaf.offset < 0 || leaf.offset >= pe.buf.length) return null;
  return pe.buf.subarray(leaf.offset, Math.min(pe.buf.length, leaf.offset + leaf.size));
}

const isPng = (b: Buffer) => b.length >= 8 && b.readUInt32BE(0) === 0x89504e47;

/** A imagem do grupo: o recurso ICON/CURSOR com aquele id, de preferencia no mesmo idioma. */
function member(leaves: ResourceLeaf[], typeId: number, id: number, lang: number) {
  const same = leaves.filter((l) => l.typeId === typeId && l.name === String(id));
  return same.find((l) => l.lang === lang) ?? same[0] ?? null;
}

/** Monta um .ico/.cur: cabecalho, uma entrada de 16 bytes por imagem e as imagens. */
function iconFile(kind: 1 | 2, images: { head: Buffer; data: Buffer }[]): Buffer | null {
  if (!images.length) return null;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(kind, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(({ head, data }) => {
    const entry = Buffer.alloc(16);
    head.copy(entry, 0, 0, 8);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...dir, ...images.map((i) => i.data)]);
}

/** Os 8 primeiros bytes da entrada do .ico a partir da propria imagem (PNG ou DIB). */
function iconHead(data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  let width = 0;
  let height = 0;
  let bits = 32;
  if (isPng(data) && data.length >= 24) {
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  } else if (data.length >= 16) {
    width = data.readInt32LE(4);
    // A altura do DIB de um icone conta a mascara: e o dobro.
    height = Math.abs(data.readInt32LE(8)) / 2;
    bits = data.readUInt16LE(14);
  }
  head[0] = width >= 256 ? 0 : width;
  head[1] = height >= 256 ? 0 : height;
  head.writeUInt16LE(1, 4);
  head.writeUInt16LE(bits, 6);
  return head;
}

function groupIcon(pe: PeImage, leaves: ResourceLeaf[], leaf: ResourceLeaf, grp: Buffer) {
  const count = Math.min(grp.length >= 6 ? grp.readUInt16LE(4) : 0, MAX_GROUP);
  const images: { head: Buffer; data: Buffer }[] = [];
  for (let i = 0; i < count && 6 + i * 14 + 14 <= grp.length; i++) {
    const e = 6 + i * 14;
    const found = member(leaves, RT_ICON, grp.readUInt16LE(e + 12), leaf.lang);
    const data = found && bytesOf(pe, found);
    if (!data?.length) continue;
    // Largura, altura, cores, reservado, planos e bits: os mesmos 8 bytes do grupo.
    images.push({ head: grp.subarray(e, e + 8), data });
  }
  return iconFile(1, images);
}

/**
 * O cursor guarda o ponto quente nos 4 primeiros bytes da imagem; no .cur ele vai na entrada. A
 * largura e a altura vem do proprio DIB (a altura dele conta a mascara: e o dobro), e nao do grupo,
 * onde cada compilador de recursos grava de um jeito.
 */
function cursorImage(data: Buffer) {
  const dib = data.subarray(4);
  const width = dib.length >= 8 ? dib.readInt32LE(4) : 0;
  const height = dib.length >= 12 ? Math.abs(dib.readInt32LE(8)) / 2 : 0;
  const head = Buffer.alloc(8);
  head[0] = width >= 256 ? 0 : width;
  head[1] = height >= 256 ? 0 : height;
  head.writeUInt16LE(data.readUInt16LE(0), 4);
  head.writeUInt16LE(data.readUInt16LE(2), 6);
  return { head, data: dib };
}

function groupCursor(pe: PeImage, leaves: ResourceLeaf[], leaf: ResourceLeaf, grp: Buffer) {
  const count = Math.min(grp.length >= 6 ? grp.readUInt16LE(4) : 0, MAX_GROUP);
  const images: { head: Buffer; data: Buffer }[] = [];
  for (let i = 0; i < count && 6 + i * 14 + 14 <= grp.length; i++) {
    const found = member(leaves, RT_CURSOR, grp.readUInt16LE(6 + i * 14 + 12), leaf.lang);
    const data = found && bytesOf(pe, found);
    if (!data || data.length < 8) continue;
    images.push(cursorImage(data));
  }
  return iconFile(2, images);
}

/** BITMAP: o DIB sem o BITMAPFILEHEADER, que diz onde comecam os pixels. */
export function bitmapFile(dib: Buffer): Buffer | null {
  if (dib.length < 12) return null;
  const headerSize = dib.readUInt32LE(0);
  if (headerSize < 12 || headerSize > dib.length) return null;
  const core = headerSize === 12;
  const bits = core ? dib.readUInt16LE(10) : dib.length >= 16 ? dib.readUInt16LE(14) : 0;
  const compression = !core && dib.length >= 20 ? dib.readUInt32LE(16) : 0;
  const used = !core && headerSize >= 36 && dib.length >= 36 ? dib.readUInt32LE(32) : 0;
  let palette = bits && bits <= 8 ? (used || 1 << bits) * (core ? 3 : 4) : used * 4;
  // Mascaras de cor logo depois do cabecalho antigo de 40 bytes.
  if (headerSize === 40 && compression === 3) palette += 12;
  if (headerSize === 40 && compression === 6) palette += 16;
  const file = Buffer.alloc(14);
  file.write('BM', 0, 'latin1');
  file.writeUInt32LE(14 + dib.length, 2);
  file.writeUInt32LE(Math.min(14 + headerSize + palette, 14 + dib.length), 10);
  return Buffer.concat([file, dib]);
}

/** Extensao pelo conteudo reconhecido (ou .bin). */
function extensionOf(data: Buffer): { ext: string; kind: string | null } {
  const type = detectType(data);
  if (!type) return { ext: 'bin', kind: null };
  return { ext: type.extensions.find(Boolean) ?? 'bin', kind: type.id };
}

/** O arquivo do recurso de indice `index` na lista da ficha; null se nao esta nos bytes. */
export function resourceFile(
  pe: PeImage,
  leaves: ResourceLeaf[],
  index: number,
): ResourceFile | null {
  const leaf = leaves[index];
  if (!leaf) return null;
  const raw = bytesOf(pe, leaf);
  if (!raw?.length) return null;
  const base = `${safe(leaf.type)}_${safe(leaf.name)}_${leaf.lang}`;
  const out = (data: Buffer | null, ext: string, image: boolean): ResourceFile | null =>
    data ? { name: `${base}.${ext}`, data, image } : null;

  switch (leaf.typeId) {
    case RT_GROUP_ICON:
      return out(groupIcon(pe, leaves, leaf, raw), 'ico', true);
    case RT_GROUP_CURSOR:
      return out(groupCursor(pe, leaves, leaf, raw), 'cur', true);
    case RT_ICON:
      return isPng(raw)
        ? out(raw, 'png', true)
        : out(iconFile(1, [{ head: iconHead(raw), data: raw }]), 'ico', true);
    case RT_CURSOR:
      return raw.length < 8
        ? out(raw, 'bin', false)
        : out(iconFile(2, [cursorImage(raw)]), 'cur', true);
    case RT_BITMAP:
      return out(bitmapFile(raw), 'bmp', true);
    case RT_MANIFEST:
      return out(raw, 'manifest.xml', false);
    default: {
      const { ext, kind } = extensionOf(raw);
      return out(raw, ext, kind !== null && IMAGE_KINDS.has(kind));
    }
  }
}

/**
 * A imagem do icone principal (o que o Explorer mostra): o primeiro GROUP_ICON na ordem do
 * diretorio, e dele a maior imagem (a de mais cores, no empate). Null sem icone.
 */
export function mainIconImage(pe: PeImage, leaves: ResourceLeaf[]): Buffer | null {
  const group = leaves.find((l) => l.typeId === RT_GROUP_ICON);
  const grp = group && bytesOf(pe, group);
  if (!group || !grp || grp.length < 6) return null;
  const count = Math.min(grp.readUInt16LE(4), MAX_GROUP);
  let best: { id: number; size: number; bits: number } | null = null;
  for (let i = 0; i < count && 6 + i * 14 + 14 <= grp.length; i++) {
    const e = 6 + i * 14;
    const size = grp[e] || 256;
    const bits = grp.readUInt16LE(e + 6);
    if (!best || size > best.size || (size === best.size && bits > best.bits)) {
      best = { id: grp.readUInt16LE(e + 12), size, bits };
    }
  }
  const image = best && member(leaves, RT_ICON, best.id, group.lang);
  return image ? bytesOf(pe, image) : null;
}
