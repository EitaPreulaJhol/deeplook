/**
 * Criptografia e codificacao no executavel (plans/analise-estatica-ampliada, item 7): as constantes
 * dos algoritmos mais usados por malware (AES, ChaCha/Salsa, RC5/RC6, TEA, Blowfish, MD5, SHA-1,
 * SHA-256, CRC32) e chaves RSA embutidas, com a posicao no arquivo; e os alfabetos Base64 proprios
 * (64 caracteres unicos que nao sao o padrao), com as strings do arquivo decodificadas por eles.
 *
 * As tabelas sao geradas pelo proprio algoritmo (S-box do AES, Te0, CRC32), nao copiadas: nenhuma
 * transcricao errada. A busca e com Buffer.indexOf (nativo), com teto de bytes.
 */

export interface CryptoConstant {
  /** Algoritmo (AES, ChaCha/Salsa, CRC32...). */
  algorithm: string;
  /** Qual constante (S-box, tabela T, valores iniciais...). */
  what: string;
  offset: number;
}

export interface Base64Alphabet {
  alphabet: string;
  offset: number;
  /** Strings do arquivo que decodificam com ele em texto legivel ou num executavel. */
  decoded: { source: string; text: string }[];
}

export interface CryptoInfo {
  constants: CryptoConstant[];
  alphabets: Base64Alphabet[];
  /** Achados para gente (alfabeto proprio, chave RSA embutida). */
  alerts: { level: 'high' | 'medium' | 'info'; text: string }[];
}

/** Bytes procurados no maximo (o resto do arquivo nao entra). */
const MAX_SCAN = 64 * 1024 * 1024;
const MAX_ALPHABETS = 5;
const MAX_DECODED = 10;
const MAX_CANDIDATES = 2000;

const u32le = (values: number[]) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
  return b;
};
const u32be = (values: number[]) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
  return b;
};

/** S-box do AES: inverso em GF(2^8) mais a transformacao afim. */
function aesSbox(): Buffer {
  const sbox = Buffer.alloc(256);
  let p = 1;
  let q = 1;
  do {
    // p percorre o grupo multiplicativo (gerador 3); q e o inverso de p.
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q = (q ^ (q << 1)) & 0xff;
    q = (q ^ (q << 2)) & 0xff;
    q = (q ^ (q << 4)) & 0xff;
    if (q & 0x80) q ^= 0x09;
    const rot = (x: number, n: number) => ((x << n) | (x >> (8 - n))) & 0xff;
    sbox[p] = q ^ rot(q, 1) ^ rot(q, 2) ^ rot(q, 3) ^ rot(q, 4) ^ 0x63;
  } while (p !== 1);
  sbox[0] = 0x63;
  return sbox;
}

export const SBOX = aesSbox();
const INV_SBOX = (() => {
  const inv = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) inv[SBOX[i]] = i;
  return inv;
})();
/** Te0 do AES "tabelado": S(x)*{02,01,01,03} num inteiro de 32 bits. */
const TE0 = (() => {
  const xt = (x: number) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
  return Array.from({ length: 8 }, (_, i) => {
    const s = SBOX[i];
    return ((xt(s) << 24) | (s << 16) | (s << 8) | (xt(s) ^ s)) >>> 0;
  });
})();
export const CRC32 = Array.from({ length: 8 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
}).slice(1, 8);
/** MD5: floor(|sin(i+1)| * 2^32), os 4 primeiros (sem perda de precisao em double). */
export const MD5_T = Array.from({ length: 4 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

const PATTERNS: { algorithm: string; what: string; bytes: Buffer }[] = [
  { algorithm: 'AES', what: 'S-box', bytes: SBOX.subarray(0, 32) },
  { algorithm: 'AES', what: 'S-box inversa', bytes: INV_SBOX.subarray(0, 32) },
  { algorithm: 'AES', what: 'tabela Te0', bytes: u32le(TE0) },
  { algorithm: 'AES', what: 'tabela Te0 (big-endian)', bytes: u32be(TE0) },
  {
    algorithm: 'ChaCha/Salsa20',
    what: 'constante "expand 32-byte k"',
    bytes: Buffer.from('expand 32-byte k'),
  },
  {
    algorithm: 'ChaCha/Salsa20',
    what: 'constante "expand 16-byte k"',
    bytes: Buffer.from('expand 16-byte k'),
  },
  { algorithm: 'CRC32', what: 'tabela', bytes: u32le(CRC32) },
  { algorithm: 'MD5', what: 'constantes T', bytes: u32le(MD5_T) },
  {
    algorithm: 'MD5/SHA-1',
    what: 'valores iniciais',
    bytes: u32le([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]),
  },
  {
    algorithm: 'SHA-1',
    what: 'valores iniciais',
    bytes: u32le([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]),
  },
  {
    algorithm: 'SHA-256',
    what: 'valores iniciais',
    bytes: u32le([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a]),
  },
  {
    algorithm: 'SHA-256',
    what: 'constantes K',
    bytes: u32le([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5]),
  },
  {
    algorithm: 'Blowfish',
    what: 'P-array inicial (dígitos de pi)',
    bytes: u32le([0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344]),
  },
  { algorithm: 'TEA/XTEA', what: 'delta 0x9E3779B9', bytes: u32le([0x9e3779b9]) },
  { algorithm: 'RC5/RC6', what: 'constantes P32 e Q32', bytes: u32le([0xb7e15163, 0x9e3779b9]) },
];

/** Chave RSA embutida: blob do CryptoAPI ou do CNG, ou PEM. */
const KEY_PATTERNS: { what: string; bytes: Buffer }[] = [
  {
    what: 'chave pública RSA (PUBLICKEYBLOB do CryptoAPI)',
    bytes: Buffer.from('0602000000a4000052534131', 'hex'),
  },
  {
    what: 'chave privada RSA (PRIVATEKEYBLOB do CryptoAPI)',
    bytes: Buffer.from('0702000000a4000052534132', 'hex'),
  },
  { what: 'chave RSA (BCRYPT_RSAKEY_BLOB do CNG)', bytes: Buffer.from('525341310008', 'hex') },
  { what: 'chave pública em PEM', bytes: Buffer.from('-----BEGIN PUBLIC KEY-----') },
  { what: 'chave RSA em PEM', bytes: Buffer.from('-----BEGIN RSA ') },
];

const STANDARD = new Set([
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
]);

/** Strings ASCII imprimiveis de pelo menos `min` caracteres, com a posicao. */
function asciiRuns(buf: Buffer, min: number, max: number): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    if (b >= 0x20 && b < 0x7f) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= min && i - start <= max) {
        out.push({ text: buf.toString('latin1', start, i), offset: start });
      }
      start = -1;
    }
  }
  return out;
}

/** Decodifica com um alfabeto de 64 caracteres (o '=' e o resto sao ignorados no fim). */
export function decodeWith(alphabet: string, text: string): Buffer | null {
  const index = new Map([...alphabet].map((c, i) => [c, i]));
  const clean = text.replace(/=+$/, '');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of clean) {
    const v = index.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

const readable = (b: Buffer) => {
  if (b.length < 4) return false;
  let ok = 0;
  for (const x of b) if ((x >= 0x20 && x < 0x7f) || x === 9 || x === 10 || x === 13) ok++;
  return ok / b.length >= 0.9;
};

export function scanCrypto(input: Buffer): CryptoInfo {
  const buf = input.subarray(0, MAX_SCAN);
  const constants: CryptoConstant[] = [];
  for (const p of PATTERNS) {
    const at = buf.indexOf(p.bytes);
    if (at >= 0) constants.push({ algorithm: p.algorithm, what: p.what, offset: at });
  }
  // O SHA-1 contem os valores do MD5: fica so o mais especifico na mesma posicao.
  const sha1 = constants.find((c) => c.algorithm === 'SHA-1');
  const deduped = constants.filter(
    (c) => !(c.algorithm === 'MD5/SHA-1' && sha1 && sha1.offset === c.offset),
  );
  // O delta do TEA e o Q32 do RC5/RC6 sao o mesmo numero: o RC5/RC6 so com o P32 junto.
  const rc = deduped.find((c) => c.algorithm === 'RC5/RC6');
  const final = deduped.filter(
    (c) => !(rc && c.algorithm === 'TEA/XTEA' && c.offset === rc.offset + 4),
  );

  const alerts: CryptoInfo['alerts'] = [];
  for (const k of KEY_PATTERNS) {
    const at = buf.indexOf(k.bytes);
    if (at >= 0) {
      final.push({ algorithm: 'RSA', what: k.what, offset: at });
      alerts.push({
        level: 'medium',
        text: `Chave RSA embutida na posição 0x${at.toString(16)}: típico de ransomware e de carregador que confere a carga.`,
      });
    }
  }

  // Alfabetos: string de 64 caracteres unicos (65 com o '=' do fim), quase toda alfanumerica.
  const alphabets: Base64Alphabet[] = [];
  const runs = asciiRuns(buf, 16, 4096);
  for (const run of runs) {
    if (alphabets.length >= MAX_ALPHABETS) break;
    const text =
      run.text.length === 65 && run.text.endsWith('=') ? run.text.slice(0, 64) : run.text;
    if (text.length !== 64 || new Set(text).size !== 64 || STANDARD.has(text)) continue;
    if ((text.match(/[A-Za-z0-9]/g) ?? []).length < 58) continue;
    if (alphabets.some((a) => a.alphabet === text)) continue;
    alphabets.push({ alphabet: text, offset: run.offset, decoded: [] });
  }
  for (const a of alphabets) {
    const chars = new Set(a.alphabet);
    let tried = 0;
    for (const run of runs) {
      if (a.decoded.length >= MAX_DECODED || tried >= MAX_CANDIDATES) break;
      if (run.text === a.alphabet || run.text.length < 12) continue;
      const body = run.text.replace(/=+$/, '');
      if (![...body].every((c) => chars.has(c))) continue;
      tried++;
      const out = decodeWith(a.alphabet, body);
      if (!out) continue;
      const exe = out.length >= 2 && out[0] === 0x4d && out[1] === 0x5a;
      if (exe || readable(out)) {
        a.decoded.push({
          source: run.text.slice(0, 120),
          text: exe ? '[executável (MZ)]' : out.toString('latin1').slice(0, 200),
        });
      }
    }
    alerts.push({
      level: a.decoded.length ? 'high' : 'medium',
      text: a.decoded.length
        ? `Alfabeto Base64 próprio, que decodifica ${a.decoded.length} string(s) do arquivo: texto escondido da extração comum.`
        : 'Alfabeto Base64 próprio: o programa codifica dados de um jeito que o Base64 comum não lê.',
    });
  }
  return { constants: final, alphabets, alerts };
}
