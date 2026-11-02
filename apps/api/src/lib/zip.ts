import { createCipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Leitor de .zip para o envio em lote (pacote com senha "infected"). So lista e
 * extrai para a memoria: nada vai para o disco e nada e executado. Suporta
 * stored/deflate, ZipCrypto e AES do WinZip (AE-1/AE-2). ZIP64 e a criptografia
 * "forte" da PKWARE ficam de fora (erro claro).
 */

export type ZipErrorCode = 'NOT_ZIP' | 'CORRUPT' | 'UNSUPPORTED' | 'BAD_PASSWORD' | 'TOO_LARGE';

export class ZipError extends Error {
  constructor(
    public code: ZipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** Caminho dentro do pacote (com pastas). */
  path: string;
  /** So o nome do arquivo. */
  name: string;
  dir: boolean;
  encrypted: boolean;
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  flags: number;
  time: number;
  localOffset: number;
  /** AES do WinZip: forca (1, 2, 3), versao (1, 2) e o metodo real. */
  aes?: { strength: number; version: number; method: number };
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOC_SIG;
}

/** CP437 e o padrao do zip; sem a marca UTF-8, nomes com acento vem dele (latin1 e o mais proximo). */
function decodeName(raw: Buffer, utf8: boolean): string {
  return raw.toString(utf8 ? 'utf8' : 'latin1');
}

/** Le o diretorio central. Lanca ZipError se o arquivo nao for um zip valido. */
export function listZip(buf: Buffer): ZipEntry[] {
  if (!isZip(buf)) throw new ZipError('NOT_ZIP', 'O arquivo não é um .zip.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('CORRUPT', 'O .zip está corrompido (sem o diretório central).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipError('UNSUPPORTED', 'Pacotes ZIP64 (muito grandes) não são suportados.');
  }
  if (cdOffset + cdSize > eocd) {
    throw new ZipError('CORRUPT', 'O .zip está corrompido (diretório central inválido).');
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new ZipError('CORRUPT', 'O .zip está corrompido (entrada inválida).');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > buf.length)
      throw new ZipError('CORRUPT', 'O .zip está corrompido (entrada truncada).');

    const path = decodeName(buf.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    let aes: ZipEntry['aes'];
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extra.readUInt16LE(e);
      const len = extra.readUInt16LE(e + 2);
      if (id === 0x9901 && len >= 7 && e + 4 + 7 <= extra.length) {
        aes = {
          version: extra.readUInt16LE(e + 4),
          strength: extra[e + 8],
          method: extra.readUInt16LE(e + 9),
        };
      }
      e += 4 + len;
    }

    const normalized = path.replace(/\\/g, '/');
    entries.push({
      path: normalized,
      name: normalized.split('/').filter(Boolean).pop() ?? normalized,
      dir: normalized.endsWith('/'),
      encrypted: (flags & 1) !== 0,
      size,
      compressedSize,
      method,
      crc,
      flags,
      time,
      localOffset,
      aes,
    });
    p = end;
  }
  return entries;
}

// ---- ZipCrypto (criptografia tradicional da PKWARE) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crcByte = (crc: number, b: number) => (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;

function zipCryptoDecrypt(data: Buffer, password: string, check: number): Buffer {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (c: number) => {
    k0 = crcByte(k0, c);
    k1 = (Math.imul(k1 + (k0 & 0xff), 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  for (const c of Buffer.from(password, 'utf8')) update(c);
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = data[i] ^ (((t * (t ^ 1)) >>> 8) & 0xff);
    out[i] = c;
    update(c);
  }
  // Os 12 primeiros bytes sao o cabecalho; o ultimo confere a senha (1 byte:
  // 1 em 256 senhas erradas passa aqui e cai no CRC depois).
  if (out.length < 12 || out[11] !== check) {
    throw new ZipError('BAD_PASSWORD', 'Senha incorreta para o .zip.');
  }
  return out.subarray(12);
}

// ---- AES do WinZip (AE-1/AE-2) ----

function aesDecrypt(data: Buffer, password: string, strength: number): Buffer {
  const keyLen = { 1: 16, 2: 24, 3: 32 }[strength];
  if (!keyLen) throw new ZipError('UNSUPPORTED', 'Criptografia AES desconhecida no .zip.');
  const saltLen = keyLen / 2;
  if (data.length < saltLen + 2 + 10) throw new ZipError('CORRUPT', 'O .zip está corrompido.');
  const salt = data.subarray(0, saltLen);
  const verifier = data.subarray(saltLen, saltLen + 2);
  const body = data.subarray(saltLen + 2, data.length - 10);
  const mac = data.subarray(data.length - 10);

  const derived = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 1000, keyLen * 2 + 2, 'sha1');
  const encKey = derived.subarray(0, keyLen);
  const authKey = derived.subarray(keyLen, keyLen * 2);
  if (!timingSafeEqual(derived.subarray(keyLen * 2), verifier)) {
    throw new ZipError('BAD_PASSWORD', 'Senha incorreta para o .zip.');
  }
  const expected = createHmac('sha1', authKey).update(body).digest().subarray(0, 10);
  if (!timingSafeEqual(expected, mac)) {
    throw new ZipError('CORRUPT', 'O conteúdo do .zip foi alterado (falha na autenticação AES).');
  }

  // CTR com contador little-endian comecando em 1 (diferente do CTR padrao).
  const blocks = Math.ceil(body.length / 16);
  const counters = Buffer.alloc(blocks * 16);
  for (let i = 0; i < blocks; i++) {
    let n = i + 1;
    for (let b = 0; b < 8 && n > 0; b++) {
      counters[i * 16 + b] = n % 256;
      n = Math.floor(n / 256);
    }
  }
  const cipher = createCipheriv(`aes-${keyLen * 8}-ecb`, encKey, null).setAutoPadding(false);
  const stream = Buffer.concat([cipher.update(counters), cipher.final()]);
  const out = Buffer.allocUnsafe(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ stream[i];
  return out;
}

/**
 * Extrai uma entrada para a memoria, conferindo senha, tamanho e CRC.
 * `maxSize` barra zip bomb: a descompressao para ao passar do limite.
 */
export function extractZipEntry(
  buf: Buffer,
  entry: ZipEntry,
  password: string,
  maxSize: number,
): Buffer {
  if (entry.flags & 0x40) {
    throw new ZipError('UNSUPPORTED', 'Criptografia forte da PKWARE não é suportada.');
  }
  if (entry.size > maxSize) {
    throw new ZipError('TOO_LARGE', 'Arquivo maior que o limite de upload.');
  }
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC_SIG) {
    throw new ZipError('CORRUPT', 'O .zip está corrompido (cabeçalho local inválido).');
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  if (start + entry.compressedSize > buf.length) {
    throw new ZipError('CORRUPT', 'O .zip está corrompido (dados truncados).');
  }
  let data = buf.subarray(start, start + entry.compressedSize);

  let method = entry.method;
  if (entry.encrypted) {
    if (!password) throw new ZipError('BAD_PASSWORD', 'O .zip tem senha: informe a senha.');
    if (method === 99) {
      if (!entry.aes) throw new ZipError('CORRUPT', 'O .zip está corrompido (AES sem parâmetros).');
      data = aesDecrypt(data, password, entry.aes.strength);
      method = entry.aes.method;
    } else {
      // Com o bit 3 (descritor de dados), o byte de conferencia vem da hora.
      const check = entry.flags & 0x8 ? (entry.time >>> 8) & 0xff : entry.crc >>> 24;
      data = zipCryptoDecrypt(data, password, check);
    }
  }

  let out: Buffer;
  if (method === 0) {
    out = Buffer.from(data);
  } else if (method === 8) {
    try {
      // Para no tamanho declarado: quem declara pouco nao descompacta ate `maxSize`.
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) });
    } catch (err) {
      if (!entry.encrypted && (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ZipError('CORRUPT', 'O .zip está corrompido (tamanho não confere).');
      }
      throw new ZipError(
        entry.encrypted ? 'BAD_PASSWORD' : 'CORRUPT',
        entry.encrypted ? 'Senha incorreta para o .zip.' : 'O .zip está corrompido.',
      );
    }
  } else {
    throw new ZipError('UNSUPPORTED', `Método de compressão ${method} não suportado.`);
  }

  if (out.length !== entry.size) {
    throw new ZipError('CORRUPT', 'O .zip está corrompido (tamanho não confere).');
  }
  // AE-2 grava CRC 0 de proposito (a autenticacao HMAC ja cobre o conteudo).
  const skipCrc = entry.aes?.version === 2;
  if (!skipCrc && crc32(out) >>> 0 !== entry.crc) {
    throw new ZipError(
      entry.encrypted ? 'BAD_PASSWORD' : 'CORRUPT',
      entry.encrypted
        ? 'Senha incorreta para o .zip.'
        : 'O .zip está corrompido (CRC não confere).',
    );
  }
  return out;
}
