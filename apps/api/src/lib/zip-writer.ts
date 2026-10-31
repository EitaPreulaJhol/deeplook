import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

/**
 * Gravador de ZIP em arquivo (backup, item 81): sem compressao (o dump ja vem
 * comprimido e as amostras quase sempre sao binarias), ZIP64 so quando o
 * tamanho ou a posicao passam de 4 GB. O tamanho de cada parte e conhecido
 * antes; o CRC-32 e calculado enquanto os dados passam e gravado no cabecalho
 * depois (o arquivo e posicionavel), sem descritor de dados.
 */

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
/** "Feito por" e "precisa de": 4.5 (ZIP64); bit 11 = nomes em UTF-8. */
const VERSION = 45;
const UTF8 = 0x0800;

/** Com senha: AES-256 no padrao WinZip AE-2 (metodo 99; o 7-Zip abre). */
const AES_METHOD = 99;
const AES_VERSION = 51;
const ENCRYPTED = 0x0001;
const AES_OVERHEAD = 16 + 2 + 10; // sal + verificador + autenticacao

/** Extra 0x9901: AE-2, fornecedor "AE", AES-256, dados originais sem compressao. */
function aesExtra(): Buffer {
  const buf = Buffer.alloc(11);
  buf.writeUInt16LE(0x9901, 0);
  buf.writeUInt16LE(7, 2);
  buf.writeUInt16LE(2, 4);
  buf.write('AE', 6, 'latin1');
  buf.writeUInt8(3, 8);
  buf.writeUInt16LE(0, 9);
  return buf;
}

/** CTR com contador little-endian a partir de 1, como o padrao pede, e HMAC-SHA1. */
class AesEncryptor {
  readonly header: Buffer;
  private readonly cipher;
  private readonly mac;
  private counter = 1;
  private spare: Buffer = Buffer.alloc(0);

  constructor(password: string) {
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 1000, 66, 'sha1');
    this.header = Buffer.concat([salt, derived.subarray(64)]);
    this.cipher = createCipheriv('aes-256-ecb', derived.subarray(0, 32), null).setAutoPadding(
      false,
    );
    this.mac = createHmac('sha1', derived.subarray(32, 64));
  }

  private keystream(length: number): Buffer {
    const blocks = Math.ceil(length / 16);
    const counters = Buffer.alloc(blocks * 16);
    for (let i = 0; i < blocks; i++) {
      counters.writeBigUInt64LE(BigInt(this.counter++), i * 16);
    }
    return this.cipher.update(counters);
  }

  encrypt(chunk: Buffer): Buffer {
    const out = Buffer.allocUnsafe(chunk.length);
    let done = 0;
    while (done < chunk.length) {
      if (!this.spare.length) this.spare = this.keystream(chunk.length - done);
      const n = Math.min(this.spare.length, chunk.length - done);
      for (let k = 0; k < n; k++) out[done + k] = chunk[done + k] ^ this.spare[k];
      this.spare = this.spare.subarray(n);
      done += n;
    }
    this.mac.update(out);
    return out;
  }

  finish(): Buffer {
    return this.mac.digest().subarray(0, 10);
  }
}

interface CentralEntry {
  name: Buffer;
  crc: number;
  size: number;
  stored: number;
  offset: number;
  time: number;
  date: number;
}

/** Data e hora no formato do MS-DOS (hora local, como os descompactadores esperam). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zip64Extra(fields: number[]): Buffer {
  const buf = Buffer.alloc(4 + fields.length * 8);
  buf.writeUInt16LE(0x0001, 0);
  buf.writeUInt16LE(fields.length * 8, 2);
  fields.forEach((v, i) => buf.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return buf;
}

export class ZipWriter {
  private position = 0;
  private readonly entries: CentralEntry[] = [];
  private readonly names = new Set<string>();

  private constructor(
    private readonly file: FileHandle,
    /** So para os testes: forca ZIP64 em tudo, para conferir com ferramentas reais. */
    private readonly forceZip64: boolean,
    private readonly password: string | null,
  ) {}

  static async create(
    path: string,
    options: { forceZip64?: boolean; password?: string | null } = {},
  ): Promise<ZipWriter> {
    return new ZipWriter(
      await open(path, 'w'),
      options.forceZip64 ?? false,
      options.password ?? null,
    );
  }

  /** Bytes gravados ate agora. */
  get size(): number {
    return this.position;
  }

  private async write(buf: Buffer, at?: number): Promise<void> {
    await this.file.write(buf, 0, buf.length, at ?? this.position);
    if (at === undefined) this.position += buf.length;
  }

  /**
   * Acrescenta uma parte com `size` bytes vindos de `source`. Falha se vierem
   * mais ou menos bytes (o objeto mudou no meio do caminho).
   */
  async add(
    name: string,
    size: number,
    source: Readable | Buffer,
    mtime = new Date(),
  ): Promise<void> {
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').includes('..')) throw new Error(`Nome inválido no ZIP: ${name}`);
    if (this.names.has(clean)) throw new Error(`Nome repetido no ZIP: ${clean}`);
    this.names.add(clean);

    const nameBuf = Buffer.from(clean, 'utf8');
    const offset = this.position;
    const aes = this.password ? new AesEncryptor(this.password) : null;
    const stored = aes ? size + AES_OVERHEAD : size;
    const big = this.forceZip64 || stored >= MAX32;
    const extra = Buffer.concat([
      big ? zip64Extra([size, stored]) : Buffer.alloc(0),
      aes ? aesExtra() : Buffer.alloc(0),
    ]);
    const { time, date } = dosDateTime(mtime);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(aes ? AES_VERSION : VERSION, 4);
    header.writeUInt16LE(aes ? UTF8 | ENCRYPTED : UTF8, 6);
    header.writeUInt16LE(aes ? AES_METHOD : 0, 8); // sem compressao
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(0, 14); // CRC: gravado depois
    header.writeUInt32LE(big ? MAX32 : stored, 18);
    header.writeUInt32LE(big ? MAX32 : size, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(extra.length, 28);
    await this.write(Buffer.concat([header, nameBuf, extra]));
    if (aes) await this.write(aes.header);

    let crc = 0;
    let written = 0;
    const chunks = Buffer.isBuffer(source) ? [source] : source;
    for await (const chunk of chunks as AsyncIterable<Buffer>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(buf, crc);
      written += buf.length;
      if (written > size) throw new Error(`${clean}: maior que o esperado (${size} bytes).`);
      await this.write(aes ? aes.encrypt(buf) : buf);
    }
    if (written !== size) throw new Error(`${clean}: ${written} de ${size} bytes.`);
    // AE-2 nao usa CRC (nao vaza nada do texto puro): a integridade vem do HMAC.
    if (aes) await this.write(aes.finish());
    else {
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32LE(crc >>> 0, 0);
      await this.write(crcBuf, offset + 14);
    }
    this.entries.push({
      name: nameBuf,
      crc: aes ? 0 : crc >>> 0,
      size,
      stored,
      offset,
      time,
      date,
    });
  }

  /** Grava o diretorio central e fecha o arquivo. */
  async finish(): Promise<number> {
    const cdStart = this.position;
    for (const e of this.entries) {
      const encrypted = e.stored !== e.size;
      const sizeBig = this.forceZip64 || e.stored >= MAX32;
      const offsetBig = this.forceZip64 || e.offset >= MAX32;
      const extra = Buffer.concat([
        sizeBig || offsetBig
          ? zip64Extra([...(sizeBig ? [e.size, e.stored] : []), ...(offsetBig ? [e.offset] : [])])
          : Buffer.alloc(0),
        encrypted ? aesExtra() : Buffer.alloc(0),
      ]);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE((3 << 8) | VERSION, 4); // Unix: atributos abaixo
      cd.writeUInt16LE(encrypted ? AES_VERSION : VERSION, 6);
      cd.writeUInt16LE(encrypted ? UTF8 | ENCRYPTED : UTF8, 8);
      cd.writeUInt16LE(encrypted ? AES_METHOD : 0, 10);
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(sizeBig ? MAX32 : e.stored, 20);
      cd.writeUInt32LE(sizeBig ? MAX32 : e.size, 24);
      cd.writeUInt16LE(e.name.length, 28);
      cd.writeUInt16LE(extra.length, 30);
      cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // arquivo comum, rw-r--r--
      cd.writeUInt32LE(offsetBig ? MAX32 : e.offset, 42);
      await this.write(Buffer.concat([cd, e.name, extra]));
    }
    const cdSize = this.position - cdStart;
    const count = this.entries.length;
    if (this.forceZip64 || count >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32) {
      const z64 = Buffer.alloc(56);
      const at = this.position;
      z64.writeUInt32LE(0x06064b50, 0);
      z64.writeBigUInt64LE(44n, 4);
      z64.writeUInt16LE((3 << 8) | VERSION, 12);
      z64.writeUInt16LE(VERSION, 14);
      z64.writeBigUInt64LE(BigInt(count), 24);
      z64.writeBigUInt64LE(BigInt(count), 32);
      z64.writeBigUInt64LE(BigInt(cdSize), 40);
      z64.writeBigUInt64LE(BigInt(cdStart), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(at), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([z64, locator]));
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Math.min(count, MAX16), 8);
    eocd.writeUInt16LE(Math.min(count, MAX16), 10);
    eocd.writeUInt32LE(Math.min(cdSize, MAX32), 12);
    eocd.writeUInt32LE(Math.min(cdStart, MAX32), 16);
    if (this.forceZip64) {
      eocd.writeUInt16LE(MAX16, 8);
      eocd.writeUInt16LE(MAX16, 10);
      eocd.writeUInt32LE(MAX32, 12);
      eocd.writeUInt32LE(MAX32, 16);
    }
    await this.write(eocd);
    await this.file.close();
    return this.position;
  }

  /** Fecha sem terminar (falha no meio). */
  async abort(): Promise<void> {
    await this.file.close().catch(() => undefined);
  }
}
