/**
 * Imagens de evidencia do relatorio (item 76): so PNG, JPEG e WebP, pelo tipo
 * REAL (assinatura dos bytes, nunca a extensao), com os metadados removidos
 * (EXIF com GPS/aparelho, XMP, IPTC, comentarios e textos). So le e recorta
 * bytes: nada e decodificado nem executado. Imagem malformada e recusada.
 */

export type EvidenceType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CleanImage {
  type: EvidenceType;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  data: Buffer;
  /** Quantos blocos de metadados sairam. */
  removed: number;
}

export class EvidenceImageError extends Error {}

const fail = (msg: string): never => {
  throw new EvidenceImageError(msg);
};

/** Tipo pela assinatura dos bytes; null = nao e PNG/JPEG/WebP. */
export function sniffImage(buf: Buffer): EvidenceType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// ------------------------------------------------------------------ PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks de metadados (texto livre, EXIF, data). O resto (imagem, cor) fica. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function cleanPng(buf: Buffer): CleanImage {
  const parts: Buffer[] = [PNG_SIGNATURE];
  let pos = 8;
  let width = 0;
  let height = 0;
  let removed = 0;
  let sawEnd = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (len > 0x7fffffff || end > buf.length) fail('PNG corrompido.');
    if (type === 'IHDR') {
      if (len < 8) fail('PNG corrompido.');
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    if (PNG_DROP.has(type)) removed++;
    else parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!width || !height || !sawEnd) fail('PNG incompleto.');
  // Bytes depois do IEND (comum para esconder dados) tambem saem.
  if (pos < buf.length) removed++;
  return { type: 'image/png', ext: 'png', width, height, data: Buffer.concat(parts), removed };
}

// ------------------------------------------------------------------ JPEG

/**
 * Segmentos que saem: APP1 (EXIF/XMP), APP3..APP13 (IPTC/Photoshop e afins),
 * APP15 e COM. Ficam APP0 (JFIF), APP2 (perfil de cor ICC) e APP14 (Adobe).
 */
function dropJpegMarker(marker: number): boolean {
  if (marker === 0xfe) return true; // COM
  if (marker < 0xe0 || marker > 0xef) return false;
  return marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(buf: Buffer): CleanImage {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  let width = 0;
  let height = 0;
  let removed = 0;
  for (;;) {
    if (pos + 4 > buf.length) fail('JPEG incompleto.');
    if (buf[pos] !== 0xff) fail('JPEG corrompido.');
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos++; // preenchimento
      continue;
    }
    const len = buf.readUInt16BE(pos + 2);
    const end = pos + 2 + len;
    if (len < 2 || end > buf.length) fail('JPEG corrompido.');
    if (SOF.has(marker)) {
      if (len < 7) fail('JPEG corrompido.');
      height = buf.readUInt16BE(pos + 5);
      width = buf.readUInt16BE(pos + 7);
    }
    if (dropJpegMarker(marker)) removed++;
    else parts.push(buf.subarray(pos, end));
    pos = end;
    if (marker === 0xda) break; // SOS: dai em diante sao os dados da imagem
  }
  // Dados comprimidos ate o EOI (FFD9); o que vier depois sai.
  const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (eoi < pos) fail('JPEG incompleto.');
  parts.push(buf.subarray(pos, eoi + 2));
  if (eoi + 2 < buf.length) removed++;
  if (!width || !height) fail('JPEG sem dimensões.');
  return { type: 'image/jpeg', ext: 'jpg', width, height, data: Buffer.concat(parts), removed };
}

// ------------------------------------------------------------------ WebP

/** Chunks de metadados do WebP estendido. */
const WEBP_DROP = new Set(['EXIF', 'XMP ']);

function cleanWebp(buf: Buffer): CleanImage {
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const chunks: Buffer[] = [];
  let pos = 12;
  let width = 0;
  let height = 0;
  let removed = 0;
  const vp8x: Buffer[] = [];
  while (pos + 8 <= riffEnd) {
    const type = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + len + (len % 2); // chunks alinhados em 2 bytes
    if (end > riffEnd + 1) fail('WebP corrompido.');
    const chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
    const body = pos + 8;
    if (type === 'VP8X' && len >= 10) {
      width = 1 + buf.readUIntLE(body + 4, 3);
      height = 1 + buf.readUIntLE(body + 7, 3);
      vp8x.push(chunk);
    } else if (type === 'VP8 ' && len >= 10 && !width) {
      width = buf.readUInt16LE(body + 6) & 0x3fff;
      height = buf.readUInt16LE(body + 8) & 0x3fff;
    } else if (type === 'VP8L' && len >= 5 && !width) {
      const bits = buf.readUInt32LE(body + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (WEBP_DROP.has(type)) removed++;
    else chunks.push(chunk);
    pos = end;
  }
  if (!width || !height || !chunks.length) fail('WebP incompleto.');
  // Sem os chunks, o VP8X nao pode mais anunciar EXIF (bit 3) nem XMP (bit 2).
  for (const header of vp8x) header[8] &= ~0x0c;
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + payload.length, 4);
  header.write('WEBP', 8, 'latin1');
  if (buf.length > riffEnd) removed++;
  return {
    type: 'image/webp',
    ext: 'webp',
    width,
    height,
    data: Buffer.concat([header, payload]),
    removed,
  };
}

/** Maior lado aceito (evita "bombas" de pixels ao abrir no navegador). */
export const EVIDENCE_MAX_SIDE = 12_000;

/** Valida o tipo real e devolve a imagem sem metadados (ou lanca EvidenceImageError). */
export function cleanEvidenceImage(buf: Buffer): CleanImage {
  const type = sniffImage(buf);
  if (!type) fail('Envie uma imagem PNG, JPEG ou WebP (o conteúdo não é de imagem).');
  let image: CleanImage;
  try {
    image =
      type === 'image/png'
        ? cleanPng(buf)
        : type === 'image/jpeg'
          ? cleanJpeg(buf)
          : cleanWebp(buf);
  } catch (err) {
    if (err instanceof EvidenceImageError) throw err;
    // Leitura fora do buffer (RangeError) = arquivo truncado/malformado.
    throw new EvidenceImageError('Imagem corrompida.');
  }
  if (image.width > EVIDENCE_MAX_SIDE || image.height > EVIDENCE_MAX_SIDE) {
    fail(`Imagem grande demais (máximo ${EVIDENCE_MAX_SIDE} pixels por lado).`);
  }
  return image;
}
