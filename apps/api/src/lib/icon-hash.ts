import { inflateSync } from 'node:zlib';

/**
 * Hash do icone principal do executavel (plans/analise-estatica-ampliada, item 2): um dHash de 64
 * bits sobre a imagem em tons de cinza. O mesmo icone (ou quase: outra profundidade de cor, outro
 * tamanho) da hash igual ou a poucos bits de distancia, o que liga amostras da mesma campanha que
 * mudam todo o resto, e ajuda a ver o executavel que se veste de documento.
 *
 * A imagem vem do proprio arquivo (hostil): o decodificador aceita so os formatos comuns de icone
 * (DIB de 1, 4, 8, 24 e 32 bits, e PNG de 8 bits, sem entrelacamento), com teto de tamanho, e
 * devolve null para o resto.
 */

/** Lado maximo da imagem decodificada (os icones vao ate 256; 1024 e folga). */
const MAX_SIDE = 1024;
/** Bits do dHash: 8 linhas de 8 comparacoes (miniatura de 9x8). */
export const ICON_HASH_BITS = 64;

interface Gray {
  width: number;
  height: number;
  /** Luminancia de 0 a 255, linha a linha de cima para baixo, ja sobre fundo branco. */
  pixels: Float64Array;
}

const luma = (r: number, g: number, b: number, a: number) =>
  ((0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (255 - a)) / 255;

/** DIB de icone (BITMAPINFOHEADER): altura dobrada (cor + mascara AND), linhas de baixo para cima. */
function decodeDib(data: Buffer): Gray | null {
  if (data.length < 40) return null;
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const fullHeight = data.readInt32LE(8);
  const bits = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (headerSize < 40 || headerSize > data.length || width <= 0 || width > MAX_SIDE) return null;
  const height = Math.abs(fullHeight) / 2;
  if (!Number.isInteger(height) || height <= 0 || height > MAX_SIDE) return null;
  if (![1, 4, 8, 24, 32].includes(bits) || (compression !== 0 && compression !== 3)) return null;
  const topDown = fullHeight < 0;
  const used = data.readUInt32LE(32);
  const paletteCount = bits <= 8 ? used || 1 << bits : 0;
  const masks = compression === 3 && headerSize === 40 ? 12 : 0;
  const paletteAt = headerSize + masks;
  const pixelsAt = paletteAt + paletteCount * 4;
  const stride = Math.floor((width * bits + 31) / 32) * 4;
  const maskStride = Math.floor((width + 31) / 32) * 4;
  const maskAt = pixelsAt + stride * height;
  if (maskAt > data.length) return null;
  const hasMask = maskAt + maskStride * height <= data.length;
  // 32 bits sem alfa nenhum (icone antigo): a transparencia vem da mascara.
  let alphaUsed = false;
  if (bits === 32) {
    for (let i = pixelsAt + 3; i < maskAt; i += 4) {
      if (data[i]) {
        alphaUsed = true;
        break;
      }
    }
  }
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = pixelsAt + (topDown ? y : height - 1 - y) * stride;
    const maskRow = maskAt + (topDown ? y : height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (bits >= 24) {
        const o = row + x * (bits / 8);
        b = data[o];
        g = data[o + 1];
        r = data[o + 2];
        if (bits === 32 && alphaUsed) a = data[o + 3];
      } else {
        const bit = x * bits;
        const byte = data[row + (bit >> 3)];
        const index = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
        const p = paletteAt + Math.min(index, paletteCount - 1) * 4;
        b = data[p];
        g = data[p + 1];
        r = data[p + 2];
      }
      if (hasMask && !(bits === 32 && alphaUsed)) {
        const transparent = (data[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1;
        if (transparent) a = 0;
      }
      pixels[y * width + x] = luma(r, g, b, a);
    }
  }
  return { width, height, pixels };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG de 8 bits (ou paleta/cinza de 1, 2 e 4 bits), sem entrelacamento. */
function decodePng(data: Buffer): Gray | null {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at + 12 <= data.length;) {
    const len = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + len);
    if (body.length !== len) return null;
    if (type === 'IHDR' && len >= 13) {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (body[12] !== 0) return null; // entrelacado
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color as 0 | 2 | 3 | 4 | 6];
  if (!channels) return null;
  // 16 bits sao lidos pelo byte alto; abaixo de 8, so cinza e paleta.
  const supported =
    depth === 8 || depth === 16 || ((color === 0 || color === 3) && [1, 2, 4].includes(depth));
  if (!supported) return null;
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  } catch {
    return null;
  }
  if (raw.length < (stride + 1) * height) return null;
  // Desfaz os filtros de cada linha (None, Sub, Up, Average, Paeth).
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? lines[dst + i - bpp] : 0;
      const up = y ? lines[dst - stride + i] : 0;
      const corner = y && i >= bpp ? lines[dst - stride + i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (filter !== 0) return null;
      lines[dst + i] = (raw[src + i] + pred) & 0xff;
    }
  }
  const sample = (y: number, x: number, channel: number) => {
    if (depth === 16) return lines[y * stride + (x * channels + channel) * 2];
    if (depth === 8) return lines[y * stride + x * channels + channel];
    const bit = x * depth;
    const byte = lines[y * stride + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (color === 3) {
        const i = sample(y, x, 0);
        if (!palette || i * 3 + 2 >= palette.length) return null;
        r = palette[i * 3];
        g = palette[i * 3 + 1];
        b = palette[i * 3 + 2];
        if (trns && i < trns.length) a = trns[i];
      } else if (color === 0 || color === 4) {
        const v = sample(y, x, 0);
        r = g = b = depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v;
        if (color === 4) a = sample(y, x, 1);
      } else {
        r = sample(y, x, 0);
        g = sample(y, x, 1);
        b = sample(y, x, 2);
        if (color === 6) a = sample(y, x, 3);
      }
      pixels[y * width + x] = luma(r, g, b, a);
    }
  }
  return { width, height, pixels };
}

/** dHash: miniatura de 9x8 pela media de cada area, um bit por par vizinho (esquerdo > direito). */
function dhash(image: Gray): string {
  const cols = 9;
  const rows = 8;
  const cell = new Float64Array(cols * rows);
  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.floor((ry * image.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * image.height) / rows));
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor((rx * image.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * image.width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < Math.min(y1, image.height); y++) {
        for (let x = x0; x < Math.min(x1, image.width); x++) {
          sum += image.pixels[y * image.width + x];
          n++;
        }
      }
      cell[ry * cols + rx] = n ? sum / n : 255;
    }
  }
  let hex = '';
  for (let ry = 0; ry < rows; ry++) {
    let byte = 0;
    for (let rx = 0; rx < 8; rx++) {
      if (cell[ry * cols + rx] > cell[ry * cols + rx + 1]) byte |= 1 << (7 - rx);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Hash de uma imagem de icone (PNG ou DIB); null se o formato nao e suportado ou esta corrompido. */
export function iconHash(data: Buffer): { hash: string; width: number; height: number } | null {
  try {
    const image = decodePng(data) ?? decodeDib(data);
    return image ? { hash: dhash(image), width: image.width, height: image.height } : null;
  } catch {
    return null;
  }
}

const POPCOUNT = Array.from({ length: 256 }, (_, n) => {
  let bits = 0;
  for (let v = n; v; v >>= 1) bits += v & 1;
  return bits;
});

/** Bits diferentes entre dois hashes de icone; null se algum nao for um. */
export function iconDistance(a: string, b: string): number | null {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return null;
  let diff = 0;
  for (let i = 0; i < 16; i += 2) {
    diff += POPCOUNT[parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)];
  }
  return diff;
}
