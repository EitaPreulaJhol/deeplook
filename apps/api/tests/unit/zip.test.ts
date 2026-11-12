// O gravador de ZIP do backup contra os dois leitores: o de arquivo (restauracao) e o de Buffer
// (amostras .zip). Um le o que o outro grava, com e sem senha, e o que foi adulterado e recusado.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { extractZipEntry, isZip, listZip, ZipError } from '../../src/lib/zip';
import { ZipFileReader, ZipReadError } from '../../src/lib/zip-file-reader';
import { ZipWriter } from '../../src/lib/zip-writer';

const dir = mkdtempSync(join(tmpdir(), 'deeplook-unit-zip-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const PASSWORD = 'senha-do-teste-unitario';
// 1 MB + 5 bytes: o leitor de arquivo le em pedacos de 1 MB e o AES conta blocos de 16.
const big = randomBytes(1024 * 1024 + 5);
const FILES: [string, Buffer][] = [
  ['vazio.bin', Buffer.alloc(0)],
  ['pasta/texto.txt', Buffer.from('conteúdo com acento')],
  ['quinze.bin', randomBytes(15)],
  ['dezesseis.bin', randomBytes(16)],
  ['grande.bin', big],
];

async function build(name: string, options: { password?: string; forceZip64?: boolean } = {}) {
  const file = join(dir, name);
  const zip = await ZipWriter.create(file, options);
  for (const [path, data] of FILES) await zip.add(path, data.length, data);
  await zip.finish();
  return file;
}

async function readAll(file: string, password: string | null) {
  const zip = await ZipFileReader.open(file);
  try {
    const out: [string, Buffer][] = [];
    for (const entry of zip.entries) out.push([entry.name, await zip.readAll(entry, password)]);
    return out;
  } finally {
    await zip.close();
  }
}

const rejects = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (err: unknown) => err instanceof ZipReadError && err.code === code);
};

for (const [label, options] of [
  ['sem senha', {}],
  ['com senha', { password: PASSWORD }],
  ['ZIP64 sem senha', { forceZip64: true }],
  ['ZIP64 com senha', { forceZip64: true, password: PASSWORD }],
] as const) {
  test(`leitor de arquivo lê o que o gravador grava (${label})`, async () => {
    const file = await build(`ok-${label.replace(/\s/g, '-')}.zip`, options);
    const read = await readAll(file, 'password' in options ? PASSWORD : null);
    assert.deepEqual(
      read.map(([name]) => name),
      FILES.map(([name]) => name),
    );
    for (const [i, [, data]] of read.entries()) assert.ok(data.equals(FILES[i][1]), FILES[i][0]);
  });
}

test('leitor de arquivo: senha errada e senha ausente', async () => {
  const file = await build('senha.zip', { password: PASSWORD });
  await rejects(readAll(file, 'outra'), 'BAD_PASSWORD');
  await rejects(readAll(file, null), 'NEEDS_PASSWORD');
});

test('leitor de arquivo: um byte trocado é recusado (CRC sem senha, HMAC com senha)', async () => {
  for (const options of [{}, { password: PASSWORD }]) {
    const bytes = readFileSync(await build(`adulterar-${'password' in options}.zip`, options));
    // No meio do grande.bin, a ultima parte antes do diretorio central.
    bytes[bytes.length - 600_000] ^= 0x01;
    const file = join(dir, `adulterado-${'password' in options}.zip`);
    writeFileSync(file, bytes);
    await rejects(readAll(file, 'password' in options ? PASSWORD : null), 'CORRUPT');
  }
});

test('leitor de arquivo: truncado e o que não é ZIP', async () => {
  const bytes = readFileSync(await build('truncar.zip'));
  const cut = join(dir, 'truncado.zip');
  writeFileSync(cut, bytes.subarray(0, bytes.length - 40));
  await assert.rejects(ZipFileReader.open(cut), ZipReadError);
  const junk = join(dir, 'lixo.zip');
  writeFileSync(junk, 'texto qualquer com mais de vinte e dois bytes');
  await assert.rejects(
    ZipFileReader.open(junk),
    (err: unknown) => err instanceof ZipReadError && err.code === 'NOT_ZIP',
  );
  const tiny = join(dir, 'curto.zip');
  writeFileSync(tiny, 'PK');
  await assert.rejects(ZipFileReader.open(tiny), ZipReadError);
});

test('gravador: nome com "..", nome repetido e tamanho que não bate', async () => {
  const zip = await ZipWriter.create(join(dir, 'nomes.zip'));
  await assert.rejects(zip.add('../fora.txt', 1, Buffer.from('x')), /Nome inválido/);
  await zip.add('a.txt', 1, Buffer.from('x'));
  await assert.rejects(zip.add('a.txt', 1, Buffer.from('y')), /Nome repetido/);
  await assert.rejects(zip.add('curto.txt', 5, Buffer.from('x')), /1 de 5 bytes/);
  await assert.rejects(zip.add('longo.txt', 1, Buffer.from('xyz')), /maior que o esperado/);
  await zip.abort();
});

test('leitor de Buffer (amostras .zip) lê o mesmo ZIP, com e sem senha', async () => {
  for (const options of [{}, { password: PASSWORD }]) {
    const buf = readFileSync(await build(`buffer-${'password' in options}.zip`, options));
    assert.ok(isZip(buf));
    const entries = listZip(buf);
    assert.equal(entries.length, FILES.length);
    for (const [i, entry] of entries.entries()) {
      assert.equal(entry.path, FILES[i][0]);
      assert.equal(entry.encrypted, 'password' in options);
      const data = extractZipEntry(
        buf,
        entry,
        'password' in options ? PASSWORD : '',
        8 * 1024 * 1024,
      );
      assert.ok(data.equals(FILES[i][1]), entry.path);
    }
  }
});

test('leitor de Buffer: teto de tamanho (zip bomb), senha errada e o que não é ZIP', async () => {
  const buf = readFileSync(await build('teto.zip', { password: PASSWORD }));
  const entries = listZip(buf);
  const large = entries.find((e) => e.path === 'grande.bin')!;
  const code = (fn: () => unknown) => {
    try {
      fn();
      return 'sem erro';
    } catch (err) {
      return err instanceof ZipError ? err.code : `outro: ${String(err)}`;
    }
  };
  assert.equal(
    code(() => extractZipEntry(buf, large, PASSWORD, 1024)),
    'TOO_LARGE',
  );
  assert.equal(
    code(() => extractZipEntry(buf, large, 'errada', 8 * 1024 * 1024)),
    'BAD_PASSWORD',
  );
  assert.equal(
    code(() => listZip(Buffer.from('não é zip'))),
    'NOT_ZIP',
  );
});
