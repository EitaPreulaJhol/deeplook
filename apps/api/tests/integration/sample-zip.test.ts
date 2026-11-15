import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { SAMPLE_ZIP_PASSWORD, sampleZipStream, zipEntryName } from '../../src/lib/sample-zip';
import { extractZipEntry, listZip } from '../../src/lib/zip';

// Plano pos-revisao, item 2.1: o ZIP com senha do download da amostra.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const dir = join(process.env.TEST_TMP!, 'sample-zip');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Passa `data` pelo fluxo em pedacos desalinhados e devolve o ZIP. */
async function zipOf(
  data: Buffer,
  options: { name?: string; size?: number; forceZip64?: boolean } = {},
): Promise<{ zip: Buffer; length: number; zip64: boolean }> {
  const { stream, length, zip64 } = sampleZipStream({
    name: options.name ?? 'amostra.exe',
    size: options.size ?? data.length,
    forceZip64: options.forceZip64,
  });
  const cuts = [0, 7, 1000, 65_537, data.length].filter(
    (n, i, a) => n <= data.length && a.indexOf(n) === i,
  );
  const chunks = cuts.slice(1).map((end, i) => data.subarray(cuts[i], end));
  const out: Buffer[] = [];
  await pipeline(Readable.from(chunks), stream, async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) out.push(chunk);
  });
  return { zip: Buffer.concat(out), length, zip64 };
}

const throws = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

async function main() {
  mkdirSync(dir, { recursive: true });

  // 1. Nome dentro do ZIP.
  ok('nome: sem pasta', zipEntryName('C:\\Users\\x\\fatura.exe') === 'fatura.exe');
  ok('nome: sem pasta (/)', zipEntryName('../../etc/passwd') === 'passwd');
  ok(
    'nome: vazio vira sample.bin',
    zipEntryName('') === 'sample.bin' && zipEntryName(null) === 'sample.bin',
  );
  ok('nome: ".." vira sample.bin', zipEntryName('..') === 'sample.bin');
  ok('nome: sem caracteres de controle', zipEntryName('a\u0000b\nc.exe') === 'abc.exe');
  ok('nome: acentos ficam', zipEntryName('relatório ação.pdf') === 'relatório ação.pdf');

  // 2. Quando o formato de arquivos grandes entra.
  ok('ZIP64: 1 MB não usa', !sampleZipStream({ name: 'a', size: 1024 * 1024 }).zip64);
  ok(
    'ZIP64: logo abaixo de 4 GB já usa',
    sampleZipStream({ name: 'a', size: 0xffffffff - 40 }).zip64,
  );
  ok('ZIP64: 5 GB usa', sampleZipStream({ name: 'a', size: 5 * 1024 ** 3 }).zip64);

  // 3. Tamanhos, Content-Length e volta pelo leitor do projeto (o do envio em lote).
  const cases: [string, Buffer, boolean][] = [
    ['vazio', Buffer.alloc(0), false],
    ['um-byte', Buffer.from([0x4d]), false],
    ['64k', randomBytes(64 * 1024), false],
    ['5mb', randomBytes(5 * 1024 * 1024), false],
    ['zip64', randomBytes(300 * 1024), true],
  ];
  const names: Record<string, string> = { '5mb': 'relatório ação.exe' };
  for (const [label, data, forceZip64] of cases) {
    const { zip, length, zip64 } = await zipOf(data, { name: names[label], forceZip64 });
    writeFileSync(join(dir, `${label}.zip`), zip);
    writeFileSync(join(dir, `${label}.sha`), sha256(data));
    ok(`${label}: tamanho calculado antes confere`, zip.length === length, [zip.length, length]);
    ok(`${label}: ZIP64 só quando pedido`, zip64 === forceZip64);
    if (data.length >= 64) {
      ok(`${label}: nada em claro`, !zip.includes(data.subarray(16, 48)));
    }
    if (!forceZip64) {
      const [entry] = listZip(zip);
      ok(`${label}: uma entrada, cifrada`, listZip(zip).length === 1 && entry.encrypted);
      ok(`${label}: nome`, entry.name === (names[label] ?? 'amostra.exe'), entry.name);
      const back = extractZipEntry(zip, entry, SAMPLE_ZIP_PASSWORD, 10 * 1024 * 1024);
      ok(`${label}: conteúdo volta igual`, Buffer.compare(back, data) === 0);
      if (data.length === 0) {
        // ZipCrypto confere a senha por 1 byte do cabecalho (aleatorio a cada ZIP) e depois pelo
        // CRC; sem conteudo o CRC e sempre 0, entao 1 em 256 senhas erradas passa. O teste fixo
        // de "recusada" falhava 1 vez a cada 256 rodadas. O que importa e nao sair nada: ou
        // recusa, ou devolve os mesmos 0 bytes.
        let leaked = false;
        try {
          leaked = extractZipEntry(zip, entry, 'errada', 10 * 1024 * 1024).length !== 0;
        } catch {
          /* recusada */
        }
        ok(`${label}: senha errada não devolve nada`, !leaked);
      } else {
        ok(
          `${label}: senha errada recusada`,
          await throws(async () => extractZipEntry(zip, entry, 'errada', 10 * 1024 * 1024)),
        );
      }
    }
  }

  // 4. Bytes a menos ou a mais que o tamanho anunciado: o fluxo termina com erro.
  ok('bytes a menos: erro', await throws(() => zipOf(Buffer.alloc(10), { size: 11 })));
  ok('bytes a mais: erro', await throws(() => zipOf(Buffer.alloc(10), { size: 9 })));

  // 5. Ferramentas reais: unzip (Info-ZIP), python (zipfile) e 7-Zip.
  const labels = cases.map(([label]) => label).join(' ');
  const script = [
    'apk add -q unzip python3 7zip >/dev/null 2>&1;',
    `for f in ${labels}; do`,
    `[ "$(unzip -P ${SAMPLE_ZIP_PASSWORD} -p /z/$f.zip | sha256sum | cut -d' ' -f1)" = "$(cat /z/$f.sha)" ] && echo "$f unzip";`,
    `python3 -c "import zipfile,sys,hashlib; z=zipfile.ZipFile('/z/'+sys.argv[1]+'.zip'); n=z.namelist()[0]; print(sys.argv[1], 'python' if hashlib.sha256(z.read(n, pwd=b'${SAMPLE_ZIP_PASSWORD}')).hexdigest()==open('/z/'+sys.argv[1]+'.sha').read() else 'diverge')" $f;`,
    `7z t -p${SAMPLE_ZIP_PASSWORD} /z/$f.zip >/dev/null && echo "$f 7z";`,
    '7z t -perrada /z/$f.zip >/dev/null 2>&1 || echo "$f 7z-errada";',
    'unzip -P errada -tq /z/$f.zip >/dev/null 2>&1 || echo "$f unzip-errada";',
    'done',
  ].join(' ');
  const out = execFileSync(
    'docker',
    ['run', '--rm', '-e', 'PYTHONUTF8=1', '-v', `${dir}:/z`, 'alpine:3.20', 'sh', '-c', script],
    { encoding: 'utf8' },
  );
  for (const [label, data] of cases) {
    for (const tool of ['unzip', 'python', '7z']) {
      ok(
        `${label}: ${tool} abre com a senha e o conteúdo confere`,
        out.includes(`${label} ${tool}\n`),
        out,
      );
    }
    // Arquivo vazio nao tem o que conferir com a senha errada: so o cabecalho de 12 bytes.
    if (data.length > 0) {
      ok(`${label}: 7-Zip recusa a senha errada`, out.includes(`${label} 7z-errada`), out);
      ok(`${label}: unzip recusa a senha errada`, out.includes(`${label} unzip-errada`), out);
    }
  }

  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
