import { createCipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';

/**
 * Leitor do ZIP de backup direto do arquivo (revisao de novembro, item 1.2). E o par do
 * zip-writer.ts: le o que ele grava (sem compressao, ZIP64, AES-256 no padrao WinZip AE-2) em
 * partes, sem trazer o ZIP para a memoria. O lib/zip.ts le ZIP de amostra a partir de um Buffer,
 * o que nao serve para um backup de varios GB.
 *
 * Cada parte so e entregue inteira e conferida: com senha, pelo HMAC do AE-2; sem senha, pelo
 * CRC-32. Parte adulterada ou truncada lanca no fim da leitura, antes de o chamador concluir.
 */

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const AES_METHOD = 99;
const CHUNK = 1024 * 1024;

export class ZipReadError extends Error {
  constructor(
    readonly code: 'NOT_ZIP' | 'CORRUPT' | 'UNSUPPORTED' | 'BAD_PASSWORD' | 'NEEDS_PASSWORD',
    message: string,
  ) {
    super(message);
  }
}

export type ZipFileEntry = {
  name: string;
  /** Tamanho do conteudo (sem o envelope do AES). */
  size: number;
  /** Bytes ocupados no arquivo. */
  stored: number;
  encrypted: boolean;
  method: number;
  crc: number;
  offset: number;
};

/** Le o extra do ZIP64 (0x0001): so os campos que vieram como 0xFFFFFFFF, nesta ordem. */
function applyZip64(extra: Buffer, entry: ZipFileEntry): void {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let p = at + 4;
      const next = () => {
        if (p + 8 > at + 4 + length) throw new ZipReadError('CORRUPT', 'extra ZIP64 curto');
        const value = Number(extra.readBigUInt64LE(p));
        p += 8;
        return value;
      };
      if (entry.size === MAX32) entry.size = next();
      if (entry.stored === MAX32) entry.stored = next();
      if (entry.offset === MAX32) entry.offset = next();
      return;
    }
    at += 4 + length;
  }
}

export class ZipFileReader {
  private constructor(
    private readonly file: FileHandle,
    readonly entries: ZipFileEntry[],
  ) {}

  static async open(path: string): Promise<ZipFileReader> {
    const file = await open(path, 'r');
    try {
      return new ZipFileReader(file, await readDirectory(file));
    } catch (err) {
      await file.close().catch(() => undefined);
      throw err;
    }
  }

  close(): Promise<void> {
    return this.file.close();
  }

  find(name: string): ZipFileEntry | undefined {
    return this.entries.find((e) => e.name === name);
  }

  /** O conteudo da parte, em pedacos; lanca no fim se a integridade nao conferir. */
  async *read(entry: ZipFileEntry, password: string | null = null): AsyncGenerator<Buffer> {
    const header = await readAt(this.file, entry.offset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) {
      throw new ZipReadError('CORRUPT', `${entry.name}: cabeçalho local ausente`);
    }
    let at = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (!entry.encrypted) {
      if (entry.method !== 0) {
        throw new ZipReadError('UNSUPPORTED', `${entry.name}: só ZIP sem compressão (backup)`);
      }
      let crc = 0;
      for (let left = entry.size; left > 0;) {
        const chunk = await readAt(this.file, at, Math.min(CHUNK, left));
        crc = crc32(chunk, crc);
        at += chunk.length;
        left -= chunk.length;
        yield chunk;
      }
      if (crc >>> 0 !== entry.crc) throw new ZipReadError('CORRUPT', `${entry.name}: CRC diverge`);
      return;
    }
    if (entry.method !== AES_METHOD) {
      throw new ZipReadError('UNSUPPORTED', `${entry.name}: cifra que não é AES (AE-2)`);
    }
    if (!password) throw new ZipReadError('NEEDS_PASSWORD', 'o backup tem senha');
    // sal (16) + verificador (2) + dados + autenticacao (10)
    const envelope = await readAt(this.file, at, 18);
    const derived = pbkdf2Sync(
      Buffer.from(password, 'utf8'),
      envelope.subarray(0, 16),
      1000,
      66,
      'sha1',
    );
    if (!timingSafeEqual(derived.subarray(64), envelope.subarray(16))) {
      throw new ZipReadError('BAD_PASSWORD', 'senha do backup incorreta');
    }
    const cipher = createCipheriv('aes-256-ecb', derived.subarray(0, 32), null).setAutoPadding(
      false,
    );
    // ECB sobre os contadores = fluxo de chave do CTR com contador little-endian a partir de 1.
    const mac = createHmac('sha1', derived.subarray(32, 64));
    at += 18;
    let counter = 1;
    for (let left = entry.stored - 28; left > 0;) {
      // Multiplo de 16 em todo pedaco menos o ultimo: o contador avanca por bloco inteiro.
      const chunk = await readAt(this.file, at, Math.min(CHUNK, left));
      mac.update(chunk);
      const blocks = Math.ceil(chunk.length / 16);
      const counters = Buffer.alloc(blocks * 16);
      for (let i = 0; i < blocks; i++) counters.writeBigUInt64LE(BigInt(counter++), i * 16);
      const stream = cipher.update(counters);
      const out = Buffer.allocUnsafe(chunk.length);
      for (let i = 0; i < chunk.length; i++) out[i] = chunk[i] ^ stream[i];
      at += chunk.length;
      left -= chunk.length;
      yield out;
    }
    const auth = await readAt(this.file, at, 10);
    if (!timingSafeEqual(mac.digest().subarray(0, 10), auth)) {
      throw new ZipReadError('CORRUPT', `${entry.name}: autenticação do AES diverge`);
    }
  }

  /** A parte inteira na memoria (so para as pequenas: manifesto e LEIA-ME). */
  async readAll(entry: ZipFileEntry, password: string | null, max = 64 * 1024 * 1024) {
    if (entry.size > max) throw new ZipReadError('CORRUPT', `${entry.name}: grande demais`);
    const chunks: Buffer[] = [];
    for await (const chunk of this.read(entry, password)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await file.read(buf, 0, length, position);
  if (bytesRead !== length)
    throw new ZipReadError('CORRUPT', 'o arquivo termina antes do esperado');
  return buf;
}

async function readDirectory(file: FileHandle): Promise<ZipFileEntry[]> {
  const { size } = await file.stat();
  if (size < 22) throw new ZipReadError('NOT_ZIP', 'não é um ZIP');
  // O fim do diretorio central fica nos ultimos 22 bytes (o gravador nao poe comentario), mas
  // procurar nos ultimos 64 KB aceita um ZIP regravado por outra ferramenta.
  const tailSize = Math.min(size, 65_557);
  const tail = await readAt(file, size - tailSize, tailSize);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipReadError('NOT_ZIP', 'não é um ZIP (sem o fim do diretório)');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdStart = tail.readUInt32LE(eocd + 16);
  if (count === MAX16 || cdSize === MAX32 || cdStart === MAX32) {
    const locatorAt = size - tailSize + eocd - 20;
    if (locatorAt < 0) throw new ZipReadError('CORRUPT', 'localizador ZIP64 ausente');
    const locator = await readAt(file, locatorAt, 20);
    if (locator.readUInt32LE(0) !== 0x07064b50) {
      throw new ZipReadError('CORRUPT', 'localizador ZIP64 ausente');
    }
    const z64 = await readAt(file, Number(locator.readBigUInt64LE(8)), 56);
    if (z64.readUInt32LE(0) !== 0x06064b50) {
      throw new ZipReadError('CORRUPT', 'registro ZIP64 ausente');
    }
    count = Number(z64.readBigUInt64LE(32));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdStart = Number(z64.readBigUInt64LE(48));
  }
  if (cdStart + cdSize > size || cdSize > 512 * 1024 * 1024) {
    throw new ZipReadError('CORRUPT', 'diretório central fora do arquivo');
  }
  const cd = await readAt(file, cdStart, cdSize);
  const entries: ZipFileEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) {
      throw new ZipReadError('CORRUPT', 'diretório central corrompido');
    }
    const nameLength = cd.readUInt16LE(at + 28);
    const extraLength = cd.readUInt16LE(at + 30);
    const commentLength = cd.readUInt16LE(at + 32);
    const entry: ZipFileEntry = {
      name: cd.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      encrypted: (cd.readUInt16LE(at + 8) & 0x0001) !== 0,
      method: cd.readUInt16LE(at + 10),
      crc: cd.readUInt32LE(at + 16),
      stored: cd.readUInt32LE(at + 20),
      size: cd.readUInt32LE(at + 24),
      offset: cd.readUInt32LE(at + 42),
    };
    applyZip64(cd.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), entry);
    if (entry.name.split('/').includes('..') || entry.name.startsWith('/')) {
      throw new ZipReadError('CORRUPT', `nome inválido no ZIP: ${entry.name}`);
    }
    if (entry.offset + entry.stored > size) {
      throw new ZipReadError('CORRUPT', `${entry.name}: fora do arquivo`);
    }
    entries.push(entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
