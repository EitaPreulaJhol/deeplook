import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { extractZipEntry, listZip } from '../../src/lib/zip';
import { ZipWriter } from '../../src/lib/zip-writer';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const dir = join(process.env.TEST_TMP!, 'zip');

const refuses = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

async function build(path: string, forceZip64: boolean, big: Buffer) {
  const z = await ZipWriter.create(path, { forceZip64 });
  await z.add('manifest.json', 3, Buffer.from('{} '));
  await z.add(
    'db/deeplook.dump',
    big.length,
    Readable.from([big.subarray(0, 1e6), big.subarray(1e6)]),
  );
  const accented = Buffer.from('olá!', 'utf8');
  await z.add('relatórios/ação.txt', accented.length, accented);
  await z.finish();
}

async function main() {
  mkdirSync(dir, { recursive: true });
  // 1. Recusas.
  const bad = await ZipWriter.create(join(dir, 'bad.zip'));
  ok('tamanho errado recusado', await refuses(() => bad.add('x.bin', 10, Buffer.alloc(9))));
  await bad.abort();
  const dup = await ZipWriter.create(join(dir, 'dup.zip'));
  await dup.add('a', 1, Buffer.from('a'));
  ok('nome repetido recusado', await refuses(() => dup.add('a', 1, Buffer.from('a'))));
  ok('../ recusado', await refuses(() => dup.add('../x', 1, Buffer.from('a'))));
  await dup.abort();

  // 2. Conteudo, pelo leitor do projeto (que nao aceita ZIP64).
  const big = randomBytes(5 * 1024 * 1024);
  await build(join(dir, 'normal.zip'), false, big);
  await build(join(dir, 'zip64.zip'), true, big);
  const raw = readFileSync(join(dir, 'normal.zip'));
  const entry = listZip(raw).find((e) => e.name.endsWith('deeplook.dump'))!;
  ok(
    'conteúdo confere',
    Buffer.compare(extractZipEntry(raw, entry, '', 10 * 1024 * 1024), big) === 0,
  );

  // 2b. Com senha (AES-256, WinZip AE-2): leitor do projeto, em pedacos desalinhados.
  const PASS = 'Senha-Do-Zip-123';
  const sealed = await ZipWriter.create(join(dir, 'senha.zip'), { password: PASS });
  await sealed.add('manifest.json', 3, Buffer.from('{} '));
  await sealed.add(
    'db/deeplook.dump',
    big.length,
    Readable.from([big.subarray(0, 7), big.subarray(7, 1000), big.subarray(1000)]),
  );
  await sealed.finish();
  const sealedRaw = readFileSync(join(dir, 'senha.zip'));
  const sealedEntry = listZip(sealedRaw).find((e) => e.name.endsWith('deeplook.dump'))!;
  ok(
    'com senha: conteúdo confere',
    Buffer.compare(extractZipEntry(sealedRaw, sealedEntry, PASS, 10 * 1024 * 1024), big) === 0,
  );
  ok(
    'com senha: senha errada recusada',
    await refuses(async () => extractZipEntry(sealedRaw, sealedEntry, 'outra-senha', 1024)),
  );
  ok('com senha: nada em claro', !sealedRaw.includes(big.subarray(100, 132)));
  const zip64sealed = await ZipWriter.create(join(dir, 'senha64.zip'), {
    password: PASS,
    forceZip64: true,
  });
  await zip64sealed.add('a.bin', big.length, big);
  await zip64sealed.finish();

  // 3. Ferramentas reais, nos dois formatos.
  const script = [
    'apk add -q unzip python3 7zip >/dev/null 2>&1;',
    'for f in normal zip64; do',
    'unzip -tq /z/$f.zip >/dev/null && echo "$f unzip";',
    `python3 -c "import zipfile,sys; z=zipfile.ZipFile('/z/'+sys.argv[1]+'.zip'); assert z.testzip() is None; assert 'relatórios/ação.txt' in z.namelist()" $f && echo "$f python";`,
    '7z t /z/$f.zip >/dev/null && echo "$f 7z";',
    'done;',
    `for f in senha senha64; do 7z t -p${PASS} /z/$f.zip >/dev/null && echo "$f certa"; 7z t -perrada /z/$f.zip >/dev/null 2>&1 || echo "$f errada"; done`,
  ].join(' ');
  const out = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'PYTHONUTF8=1',
      '-v',
      `${dir}:/z`,
      'alpine:3.20',
      'sh',
      '-c',
      `${script}`,
    ],
    { encoding: 'utf8' },
  );
  for (const f of ['normal', 'zip64']) {
    for (const tool of ['unzip', 'python', '7z'])
      ok(`${f} válido no ${tool}`, out.includes(`${f} ${tool}`), out);
  }
  for (const f of ['senha', 'senha64']) {
    ok(`${f}: 7-Zip abre com a senha`, out.includes(`${f} certa`), out);
    ok(`${f}: 7-Zip recusa a errada`, out.includes(`${f} errada`), out);
  }
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
