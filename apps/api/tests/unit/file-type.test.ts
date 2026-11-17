// Deteccao de tipo por assinatura: Mach-O universal x .class, pacotes ZIP derivados (MSIX, XPI, JAR),
// CRX, ASAR, .pyc e ClickOnce, com buffers sinteticos e sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';

import { detectType } from '../../src/lib/file-type';

const id = (buf: Buffer) => detectType(buf)?.id ?? null;

/** ZIP minimo (stored) so com os nomes: o suficiente para o diretorio central. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('Mach-O universal (fat) nao se confunde com .class', () => {
  const fat = Buffer.alloc(32);
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]).copy(fat);
  fat.writeUInt32BE(2, 4); // nfat_arch
  assert.equal(id(fat), 'macho');

  const cls = Buffer.alloc(32);
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]).copy(cls);
  cls.writeUInt16BE(0, 4); // minor
  cls.writeUInt16BE(52, 6); // major (Java 8)
  assert.equal(id(cls), 'java-class');

  const fat64 = Buffer.from([0xca, 0xfe, 0xba, 0xbf, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(id(fat64), 'macho');
});

test('pacotes ZIP derivados saem antes do JAR', () => {
  const manifest = 'Manifest-Version: 1.0';
  assert.equal(id(zip({ 'META-INF/MANIFEST.MF': manifest, 'A.class': 'x' })), 'jar');
  assert.equal(
    id(zip({ 'AppxManifest.xml': '<Package/>', 'META-INF/MANIFEST.MF': manifest })),
    'msix',
  );
  assert.equal(id(zip({ 'install.rdf': '<RDF/>' })), 'xpi');
  assert.equal(id(zip({ 'manifest.json': '{"browser_specific_settings":{"gecko":{}}}' })), 'xpi');
  assert.equal(id(zip({ 'META-INF/mozilla.rsa': 'x', 'META-INF/MANIFEST.MF': manifest })), 'xpi');
  assert.equal(id(zip({ 'a.txt': 'oi' })), 'zip');
  // manifest.json sem "gecko" e uma extensao qualquer, nao um XPI.
  assert.equal(id(zip({ 'manifest.json': '{"manifest_version":3}' })), 'zip');
});

test('CRX, ASAR e .pyc', () => {
  assert.equal(id(Buffer.concat([Buffer.from('Cr24'), Buffer.alloc(16)])), 'crx');

  const json = '{"files":{"main.js":{"size":1,"offset":"0"}}}';
  const asar = Buffer.alloc(16 + json.length);
  asar.writeUInt32LE(4, 0);
  asar.writeUInt32LE(json.length + 8, 4);
  asar.writeUInt32LE(json.length + 4, 8);
  asar.writeUInt32LE(json.length, 12);
  asar.write(json, 16);
  assert.equal(id(asar), 'asar');

  const pyc = Buffer.alloc(16);
  pyc.writeUInt16LE(3495, 0); // Python 3.10
  pyc[2] = 0x0d;
  pyc[3] = 0x0a;
  assert.equal(id(pyc), 'pyc');

  const notPyc = Buffer.alloc(16);
  notPyc.writeUInt16LE(100, 0);
  notPyc[2] = 0x0d;
  notPyc[3] = 0x0a;
  assert.equal(id(notPyc), null);
});

test('manifesto ClickOnce', () => {
  const app =
    '<?xml version="1.0" encoding="utf-8"?>\n<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">\n<deployment install="true"/></assembly>';
  assert.equal(id(Buffer.from(app)), 'clickonce');
  // XML qualquer nao e ClickOnce.
  assert.equal(id(Buffer.from('<?xml version="1.0"?><a/>')), null);
});
