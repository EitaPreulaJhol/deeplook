/**
 * TLSH (Trend Micro Locality Sensitive Hash), 128 baldes e checksum de 1 byte
 * (item 71): hash "parecido" para arquivos parecidos. Implementacao propria com
 * arrays tipados (sem alocar por byte), equivalente ao tlsh-js/referencia:
 * digest de 70 caracteres hex (exibido com o prefixo "T1"); distancia 0 =
 * iguais, ate ~30 muito parecidos, acima de ~100 sem relacao.
 */

const PEARSON = new Uint8Array([
  1, 87, 49, 12, 176, 178, 102, 166, 121, 193, 6, 84, 249, 230, 44, 163, 14, 197, 213, 181, 161, 85,
  218, 80, 64, 239, 24, 226, 236, 142, 38, 200, 110, 177, 104, 103, 141, 253, 255, 50, 77, 101, 81,
  18, 45, 96, 31, 222, 25, 107, 190, 70, 86, 237, 240, 34, 72, 242, 20, 214, 244, 227, 149, 235, 97,
  234, 57, 22, 60, 250, 82, 175, 208, 5, 127, 199, 111, 62, 135, 248, 174, 169, 211, 58, 66, 154,
  106, 195, 245, 171, 17, 187, 182, 179, 0, 243, 132, 56, 148, 75, 128, 133, 158, 100, 130, 126, 91,
  13, 153, 246, 216, 219, 119, 68, 223, 78, 83, 88, 201, 99, 122, 11, 92, 32, 136, 114, 52, 10, 138,
  30, 48, 183, 156, 35, 61, 26, 143, 74, 251, 94, 129, 162, 63, 152, 170, 7, 115, 167, 241, 206, 3,
  150, 55, 59, 151, 220, 90, 53, 23, 131, 125, 173, 15, 238, 79, 95, 89, 16, 105, 137, 225, 224,
  217, 160, 37, 123, 118, 73, 2, 157, 46, 116, 9, 145, 134, 228, 207, 212, 202, 215, 69, 229, 27,
  188, 67, 124, 168, 252, 42, 4, 29, 108, 21, 247, 19, 205, 39, 203, 233, 40, 186, 147, 198, 192,
  155, 33, 164, 191, 98, 204, 165, 180, 117, 76, 140, 36, 210, 172, 41, 54, 159, 8, 185, 232, 113,
  196, 231, 47, 146, 120, 51, 65, 28, 144, 254, 221, 93, 189, 194, 139, 112, 43, 71, 109, 184, 209,
]);

/** Hash de Pearson de [salt, a, b, c]. */
function pearson(salt: number, a: number, b: number, c: number): number {
  return PEARSON[PEARSON[PEARSON[PEARSON[salt] ^ a] ^ b] ^ c];
}

/** Arquivos menores ou sem variedade nao tem TLSH (o hash nao seria confiavel). */
export const TLSH_MIN_LENGTH = 512;

const swap = (b: number) => ((b & 0x0f) << 4) | ((b & 0xf0) >> 4);

function lValue(length: number): number {
  if (length <= 656) return Math.floor(Math.log(length) / 0.4054651) % 256;
  if (length <= 3199) return Math.floor(Math.log(length) / 0.26236426 - 8.72777) % 256;
  return Math.floor(Math.log(length) / 0.09531018 - 62.5472) % 256;
}

/**
 * Digest TLSH (70 hex, sem o "T1") ou null se o conteudo for curto/simples demais. `minLength`
 * menor serve ao telfhash (plans/analise-estatica-ampliada, item 2), que usa o `forcehash` da
 * biblioteca oficial: o mesmo calculo, aceitando a partir de 50 bytes.
 */
export function tlsh(data: Uint8Array, minLength = TLSH_MIN_LENGTH): string | null {
  const length = data.length;
  if (length < minLength) return null;
  const buckets = new Uint32Array(256);
  let checksum = 0;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  let c4 = 0;
  for (let i = 0; i < length; i++) {
    const c0 = data[i];
    if (i >= 4) {
      // c0 = byte atual; c1..c4 = os quatro anteriores (c1 o mais recente).
      checksum = pearson(0, c0, c1, checksum);
      buckets[pearson(2, c0, c1, c2)]++;
      buckets[pearson(3, c0, c1, c3)]++;
      buckets[pearson(5, c0, c2, c3)]++;
      buckets[pearson(7, c0, c2, c4)]++;
      buckets[pearson(11, c0, c1, c4)]++;
      buckets[pearson(13, c0, c3, c4)]++;
    }
    c4 = c3;
    c3 = c2;
    c2 = c1;
    c1 = c0;
  }
  let nonzero = 0;
  for (let i = 0; i < 128; i++) if (buckets[i] > 0) nonzero++;
  if (nonzero <= 64) return null;
  const sorted = buckets.slice(0, 128).sort();
  const q1 = sorted[31];
  const q2 = sorted[63];
  const q3 = sorted[95];
  if (q3 === 0) return null;
  const body = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    let h = 0;
    for (let j = 0; j < 4; j++) {
      const k = buckets[4 * i + j];
      if (q3 < k) h += 3 << (j * 2);
      else if (q2 < k) h += 2 << (j * 2);
      else if (q1 < k) h += 1 << (j * 2);
    }
    body[i] = h;
  }
  const q1ratio = Math.floor((q1 * 100) / q3) % 16;
  const q2ratio = Math.floor((q2 * 100) / q3) % 16;
  const q = (q1ratio & 0x0f) | ((q2ratio & 0x0f) << 4);
  const bytes = [swap(checksum), swap(lValue(length)), swap(q)];
  for (let i = 31; i >= 0; i--) bytes.push(body[i]);
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/** Tabela da distancia entre dois bytes do corpo (4 pares de bits; diferenca 3 vale 6). */
const BIT_PAIRS = (() => {
  const t = new Uint8Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      let x = i;
      let y = j;
      let diff = 0;
      for (let z = 0; z < 4; z++) {
        const d = Math.abs((x % 4) - (y % 4));
        diff += d === 3 ? 6 : d;
        x = Math.floor(x / 4);
        y = Math.floor(y / 4);
      }
      t[i * 256 + j] = diff;
    }
  }
  return t;
})();

const modDiff = (a: number, b: number, size: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, size - d);
};

const parse = (hex: string) => {
  const b = Buffer.from(hex.replace(/^T1/i, ''), 'hex');
  return b.length === 35 ? b : null;
};

/** Distancia TLSH (com o comprimento); null se algum digest for invalido. */
export function tlshDistance(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  let diff = 0;
  const ldiff = modDiff(swap(x[1]), swap(y[1]), 256);
  diff += ldiff <= 1 ? ldiff : ldiff * 12;
  const qx = swap(x[2]);
  const qy = swap(y[2]);
  for (const [a1, b1] of [
    [qx & 0x0f, qy & 0x0f],
    [qx >> 4, qy >> 4],
  ]) {
    const d = modDiff(a1, b1, 16);
    diff += d <= 1 ? d : (d - 1) * 12;
  }
  if (x[0] !== y[0]) diff += 1;
  for (let i = 3; i < 35; i++) diff += BIT_PAIRS[x[i] * 256 + y[i]];
  return diff;
}

/** "Parecida" em % para a tela: 100 - distancia (minimo 0). */
export function tlshSimilarity(distance: number): number {
  return Math.max(0, 100 - distance);
}

/** Arquivos maiores nao tem TLSH (calculo sincrono; 32 MB levam ~0,5 s). */
export const TLSH_MAX_BYTES = 32 * 1024 * 1024;
