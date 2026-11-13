import { randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { crc32 } from 'node:zlib';

import { dosDateTime, zip64Extra } from './zip-writer';

/**
 * Download da amostra dentro de um ZIP com senha (plano pos-revisao, item 2.1).
 *
 * O costume da area: um ZIP com a senha `infected`, para o antivirus da maquina do analista nao
 * apagar o arquivo e ninguem executa-lo com um clique duplo. A senha e publica, entao a cifra e
 * so embalagem: ZipCrypto (o "ZIP 2.0" tradicional), que o Explorer do Windows abre sem instalar
 * nada. O AES do backup (zip-writer.ts) so abre no 7-Zip.
 *
 * Gerado em fluxo, sem gravar em disco: uma entrada so, sem compressao, com descritor de dados (o
 * CRC so e conhecido no fim) e ZIP64 quando o tamanho passa de 4 GB. O tamanho final e calculado
 * antes, para a resposta levar Content-Length.
 */

export const SAMPLE_ZIP_PASSWORD = 'infected';

const MAX32 = 0xffffffff;
/** Cabecalho de cifra do ZipCrypto: 11 bytes aleatorios e 1 de conferencia. */
const CRYPT_HEADER = 12;
/** Bit 0: cifrado. Bit 3: CRC e tamanhos no descritor. Bit 11: nome em UTF-8. */
const FLAGS = 0x0001 | 0x0008 | 0x0800;
/** "Precisa de": 2.0 (cifra tradicional) ou 4.5 (ZIP64). "Feito por": 4.5, Unix. */
const NEEDS = 20;
const NEEDS_ZIP64 = 45;
const MADE_BY = (3 << 8) | 45;
const ZIP64_EXTRA = 4 + 2 * 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** As tres chaves do ZipCrypto (APPNOTE 6.1), iniciadas com a senha. */
class ZipCrypto {
  private k0 = 0x12345678;
  private k1 = 0x23456789;
  private k2 = 0x34567890;

  constructor(password: Buffer) {
    for (const byte of password) this.update(byte);
  }

  private update(byte: number): void {
    this.k0 = (CRC_TABLE[(this.k0 ^ byte) & 0xff] ^ (this.k0 >>> 8)) >>> 0;
    this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.k2 = (CRC_TABLE[(this.k2 ^ (this.k1 >>> 24)) & 0xff] ^ (this.k2 >>> 8)) >>> 0;
  }

  /** Cifra em uma copia; as chaves andam com o texto claro. */
  encrypt(plain: Buffer): Buffer {
    const out = Buffer.allocUnsafe(plain.length);
    let { k0, k1, k2 } = this;
    for (let i = 0; i < plain.length; i++) {
      const t = (k2 | 2) & 0xffff;
      const byte = plain[i];
      out[i] = byte ^ (((t * (t ^ 1)) >>> 8) & 0xff);
      k0 = (CRC_TABLE[(k0 ^ byte) & 0xff] ^ (k0 >>> 8)) >>> 0;
      k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
      k2 = (CRC_TABLE[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8)) >>> 0;
    }
    this.k0 = k0;
    this.k1 = k1;
    this.k2 = k2;
    return out;
  }
}

/** Nome do arquivo dentro do ZIP: so o nome (sem pasta), sem caracteres de controle. */
export function zipEntryName(original: string | null | undefined): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const name = clean === '.' || clean === '..' ? '' : clean;
  return [...(name || 'sample.bin')].slice(0, 200).join('');
}

export interface SampleZipOptions {
  /** Nome do arquivo dentro do ZIP (ver zipEntryName). */
  name: string;
  /** Tamanho exato dos bytes que vao passar pelo fluxo. */
  size: number;
  password?: string;
  mtime?: Date;
  /** So para os testes: ZIP64 mesmo abaixo de 4 GB, para conferir com ferramentas reais. */
  forceZip64?: boolean;
}

/**
 * Fluxo que recebe os bytes da amostra e devolve o ZIP. `length` e o tamanho final do ZIP e
 * `zip64` diz se o formato foi o de arquivos grandes. Se
 * passar um numero de bytes diferente de `size`, o fluxo termina com erro (o Content-Length ja
 * enviado estaria errado).
 */
export function sampleZipStream(options: SampleZipOptions): {
  stream: Transform;
  length: number;
  zip64: boolean;
} {
  const name = Buffer.from(options.name, 'utf8');
  const size = options.size;
  const stored = size + CRYPT_HEADER;
  const localLength = 30 + name.length;
  // ZIP64 quando algum tamanho ou posicao nao cabe em 32 bits (com folga para os cabecalhos).
  const zip64 = options.forceZip64 === true || localLength + ZIP64_EXTRA + stored + 24 >= MAX32;
  const extraLength = zip64 ? ZIP64_EXTRA : 0;
  const descriptorLength = zip64 ? 24 : 16;
  const centralOffset = localLength + extraLength + stored + descriptorLength;
  const centralLength = 46 + name.length + extraLength;
  const endLength = 22 + (zip64 ? 56 + 20 : 0);
  const length = centralOffset + centralLength + endLength;

  const { time, date } = dosDateTime(options.mtime ?? new Date());
  const cipher = new ZipCrypto(Buffer.from(options.password ?? SAMPLE_ZIP_PASSWORD, 'utf8'));
  let started = false;
  let crc = 0;
  let bytes = 0;

  const head = (): Buffer => {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? NEEDS_ZIP64 : NEEDS, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // sem compressao
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // CRC e tamanhos ficam zerados aqui (bit 3): vao no descritor, depois dos dados.
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(zip64 ? MAX32 : 0, 18);
    local.writeUInt32LE(zip64 ? MAX32 : 0, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extraLength, 28);
    // Com o bit 3, o byte de conferencia da senha e o alto da hora (o CRC ainda nao existe).
    const header = randomBytes(CRYPT_HEADER);
    header[CRYPT_HEADER - 1] = (time >> 8) & 0xff;
    return Buffer.concat([
      local,
      name,
      zip64 ? zip64Extra([0, 0]) : Buffer.alloc(0),
      cipher.encrypt(header),
    ]);
  };

  const tail = (): Buffer => {
    const descriptor = Buffer.alloc(descriptorLength);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    if (zip64) {
      descriptor.writeBigUInt64LE(BigInt(stored), 8);
      descriptor.writeBigUInt64LE(BigInt(size), 16);
    } else {
      descriptor.writeUInt32LE(stored, 8);
      descriptor.writeUInt32LE(size, 12);
    }

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY, 4);
    central.writeUInt16LE(zip64 ? NEEDS_ZIP64 : NEEDS, 6);
    central.writeUInt16LE(FLAGS, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(zip64 ? MAX32 : stored, 20);
    central.writeUInt32LE(zip64 ? MAX32 : size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extraLength, 30);
    // comentario, disco, atributos internos: 0. Externos: arquivo comum, rw-r--r--.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(0, 42); // posicao do cabecalho local: o inicio
    const parts: Buffer[] = [descriptor, central, name];
    if (zip64) parts.push(zip64Extra([size, stored]));

    if (zip64) {
      const record = Buffer.alloc(56);
      record.writeUInt32LE(0x06064b50, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(MADE_BY, 12);
      record.writeUInt16LE(NEEDS_ZIP64, 14);
      record.writeBigUInt64LE(1n, 24);
      record.writeBigUInt64LE(1n, 32);
      record.writeBigUInt64LE(BigInt(centralLength), 40);
      record.writeBigUInt64LE(BigInt(centralOffset), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(centralOffset + centralLength), 8);
      locator.writeUInt32LE(1, 16);
      parts.push(record, locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(centralLength, 12);
    end.writeUInt32LE(zip64 ? MAX32 : centralOffset, 16);
    parts.push(end);
    return Buffer.concat(parts);
  };

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (!started) {
        started = true;
        this.push(head());
      }
      bytes += chunk.length;
      if (bytes > size) {
        callback(new Error(`a amostra passou do tamanho esperado (${size} bytes)`));
        return;
      }
      crc = crc32(chunk, crc);
      callback(null, cipher.encrypt(chunk));
    },
    flush(callback: TransformCallback) {
      if (bytes !== size) {
        callback(new Error(`a amostra veio com ${bytes} de ${size} bytes`));
        return;
      }
      if (!started) this.push(head());
      callback(null, tail());
    },
  });
  return { stream, length, zip64 };
}
