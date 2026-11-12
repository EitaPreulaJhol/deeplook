import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Corpo do envio gravado em disco enquanto chega (revisao de novembro, 2.3), com o SHA-256 e o
 * tamanho calculados em transito. O /tmp da API e um volume em disco (compose), entao um envio
 * lento ocupa disco, e nao a memoria que a analise dos outros envios precisa.
 *
 * Os arquivos tem o prefixo abaixo: os que sobrarem de uma queda sao apagados na subida, junto
 * com as pastas do backup e do ISO (cleanStaleWorkDirs).
 */
export const SPOOL_PREFIX = 'deeplook-upload-';

export type Spooled = {
  path: string;
  size: number;
  sha256: string;
  /** O conteudo inteiro, lido do disco. */
  read: () => Promise<Buffer>;
  /** Apaga o arquivo (pode chamar mais de uma vez). */
  remove: () => Promise<void>;
};

/** Grava `source` num arquivo temporario; se falhar no meio, o arquivo nao fica. */
export async function spoolToDisk(source: Readable, dir = tmpdir()): Promise<Spooled> {
  const path = join(dir, `${SPOOL_PREFIX}${randomBytes(12).toString('hex')}`);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  const remove = () => rm(path, { force: true });
  try {
    // 0600: o arquivo e uma amostra, possivelmente maliciosa; so o usuario da API le.
    await pipeline(source, meter, createWriteStream(path, { mode: 0o600 }));
  } catch (err) {
    await remove();
    throw err;
  }
  return { path, size, sha256: hash.digest('hex'), read: () => readFile(path), remove };
}
