// Formatos de entrega (plans/caca-e-formatos, item 4): OneNote, HTML smuggling e os nomes de stream
// do MSI, sem banco. O MSI inteiro (msibuild) fica no teste de integracao, com a fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeDelivery, htmlScripts, msiStreamName } from '../../src/lib/delivery-formats';
import { detectType } from '../../src/lib/file-type';
import { analyzeBuffer } from '../../src/lib/static-analysis';

/** GUID no formato de bytes do Windows. */
const guid = (g: string) => {
  const b = Buffer.from(g.replace(/[{}-]/g, ''), 'hex');
  return Buffer.concat([
    Buffer.from(b.subarray(0, 4)).reverse(),
    Buffer.from(b.subarray(4, 6)).reverse(),
    Buffer.from(b.subarray(6, 8)).reverse(),
    b.subarray(8),
  ]);
};
const HEADER = guid('{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}');
const FILE = guid('{BDE316E7-2665-4511-A4C4-8D4D0B7A9EAC}');
const FOOTER = guid('{71FBA722-0F79-4A0B-BB13-899256426B24}');

function fileObject(data: Buffer): Buffer {
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(data.length));
  const pad = Buffer.alloc((8 - (data.length % 8)) % 8);
  return Buffer.concat([FILE, size, Buffer.alloc(12), data, pad, FOOTER]);
}

/** Um PE minimo (so o que o detectType e o isDll leem). */
function pe(dll = false): Buffer {
  const b = Buffer.alloc(1024);
  b.write('MZ');
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(dll ? 0x2102 : 0x0102, 0x80 + 22);
  return b;
}

test('OneNote: reconhecido pelo cabeçalho; anexos saem, imagens não', () => {
  const hta = Buffer.from(
    '<html><head><hta:application id="x"/></head><script>new ActiveXObject("WScript.Shell").Run("calc")</script></html>'.repeat(
      4,
    ),
  );
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600)]);
  const one = Buffer.concat([
    HEADER,
    Buffer.alloc(64),
    fileObject(png),
    Buffer.alloc(32),
    fileObject(hta),
    fileObject(pe()),
  ]);
  assert.equal(detectType(one)?.id, 'onenote');
  const r = analyzeDelivery(one, 'fatura.one', 'onenote');
  assert.equal(r?.info.format, 'onenote');
  assert.deepEqual(r?.info.onenote, { objects: 3, images: 1 });
  assert.deepEqual(
    r?.info.files.map((f) => [f.name, f.type, f.source]),
    [
      ['embutido-2.hta', 'hta', 'objeto 2'],
      ['embutido-3.exe', 'pe', 'objeto 3'],
    ],
  );
  assert.ok(r!.payloads[1].equals(pe()));
  assert.equal(r?.info.risk, 'high');
  assert.ok(r?.info.alerts.some((a) => a.level === 'medium' && /clique duas vezes/.test(a.text)));
  // O tamanho declarado fora do arquivo nao derruba nem le alem do fim.
  const broken = Buffer.concat([HEADER, FILE, Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0])]);
  assert.equal(analyzeDelivery(broken, 'x.one', 'onenote')?.info.files.length, 0);
});

test('HTML smuggling: Base64 com Blob e download vira carga de risco alto', () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 7)]);
  const html = `<html><body><script>
    var b = atob("${zip.toString('base64')}");
    var blob = new Blob([b], {type: "application/zip"});
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "fatura.zip"; a.click();
  </script></body></html>`;
  const r = analyzeDelivery(Buffer.from(html), 'fatura.html', 'html');
  assert.equal(r?.info.format, 'html');
  assert.deepEqual(r?.info.html?.smuggling, ['Blob', 'URL.createObjectURL', 'download', 'atob']);
  assert.equal(r?.info.files[0]?.type, 'zip');
  assert.ok(r?.payloads[0].equals(zip));
  assert.equal(r?.info.risk, 'high');
  assert.match(r!.info.alerts[0].text, /^HTML smuggling: monta carga-1\.zip \(zip\)/);
  // A analise estatica guarda so o resumo e passa o JavaScript da pagina pela analise de scripts.
  const info = analyzeBuffer(Buffer.from(html), 'fatura.html');
  assert.equal(info.delivery?.files.length, 1);
  assert.equal(info.script?.language, 'javascript');
});

test('HTML: lista de bytes e data: URI; imagem e texto curto ficam de fora', () => {
  const exe = pe();
  const html = `<!doctype html><svg><script>
    const a = new Uint8Array([${[...exe].join(',')}]);
  </script>
  <img src="data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(800)]).toString('base64')}">
  <a href="data:application/x-msdownload;base64,${exe.toString('base64')}">x</a></svg>`;
  const r = analyzeDelivery(Buffer.from(html), 'pagina.svg', null);
  // O mesmo PE pelas duas vias conta uma vez.
  assert.deepEqual(
    r?.info.files.map((f) => [f.type, f.source]),
    [['pe', 'data: (application/x-msdownload)']],
  );
  assert.equal(r?.info.html?.byteArrays, 1);
  assert.equal(r?.info.risk, 'medium');
  const plain = analyzeDelivery(Buffer.from('<html><p>olá</p></html>'), 'a.html', 'html');
  assert.deepEqual(plain?.info.files, []);
  assert.equal(plain?.info.risk, 'low');
  assert.equal(
    htmlScripts(Buffer.from('<script>a()</script><p/><script src="x"></script>')),
    'a()',
  );
});

test('MSI: nomes de stream decodificados', () => {
  // "!_StringPool" como o Windows Installer grava (0x4840 = "!", pares em 0x3800..0x47ff).
  const enc = (name: string) => {
    const idx = (c: string) =>
      c >= '0' && c <= '9'
        ? c.charCodeAt(0) - 48
        : c >= 'A' && c <= 'Z'
          ? c.charCodeAt(0) - 55
          : c >= 'a' && c <= 'z'
            ? c.charCodeAt(0) - 61
            : c === '.'
              ? 62
              : 63;
    let out = '';
    for (let i = 0; i < name.length; i += 2) {
      out +=
        i + 1 < name.length
          ? String.fromCharCode(0x3800 + idx(name[i]) + (idx(name[i + 1]) << 6))
          : String.fromCharCode(0x4800 + idx(name[i]));
    }
    return out;
  };
  assert.equal(msiStreamName('䡀' + enc('_StringPool')), '!_StringPool');
  assert.equal(msiStreamName(enc('Binary.AcaoDll')), 'Binary.AcaoDll');
  assert.equal(msiStreamName('\u0005SummaryInformation'), '\u0005SummaryInformation');
});

test('nada que não seja OneNote, HTML ou MSI', () => {
  assert.equal(analyzeDelivery(pe(), 'a.exe', 'pe'), null);
  assert.equal(analyzeDelivery(Buffer.from('%PDF-1.7'), 'a.pdf', 'pdf'), null);
  assert.equal(analyzeDelivery(Buffer.alloc(4096), 'x.ole', 'ole'), null);
});
