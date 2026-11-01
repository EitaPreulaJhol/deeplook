// Atualiza os pacotes de regras YARA em apps/api/rules (item 143), a partir de clones:
//   node scripts/vendor-yara-packs.mjs <pasta com os clones>
// Copia sem alterar, junto com a licenca e o commit, so o que compila no YARA-X do
// projeto. A API instala cada pacote uma vez: atualizar aqui nao muda o que ja instalou.
/* global console, process, TextDecoder */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(API, 'rules');
const clones = process.argv[2];
if (!clones) throw new Error('Informe a pasta com os clones.');

const PACKS = [
  {
    id: 'reversinglabs',
    clone: 'reversinglabs-yara-rules',
    folder: 'yara',
    name: 'ReversingLabs',
    author: 'ReversingLabs',
    license: 'MIT',
    url: 'https://github.com/reversinglabs/reversinglabs-yara-rules',
    defaultEnabled: true,
    description:
      'Detecção de malware, com foco em ransomware, feita para não gerar falso positivo.',
    skip: () => false,
  },
  {
    id: 'bartblaze',
    clone: 'Yara-rules',
    folder: 'rules',
    name: 'bartblaze',
    author: 'bartblaze',
    license: 'MIT',
    url: 'https://github.com/bartblaze/Yara-rules',
    defaultEnabled: true,
    description:
      'APT, crime e ransomware. Sem a pasta "generic", que a fonte diz não indicar malware.',
    skip: (rel) => rel.startsWith(`generic${sep}`),
    skipPrefixes: ['generic/'],
  },
  {
    id: 'signature-base',
    clone: 'signature-base',
    folder: 'yara',
    name: 'signature-base',
    author: 'Florian Roth (Neo23x0)',
    license: 'DRL 1.1',
    url: 'https://github.com/Neo23x0/signature-base',
    defaultEnabled: false,
    description: 'Base ampla e muito atualizada: APT, crime, ferramentas de ataque e webshells.',
    skip: () => false,
    // Comparam o tamanho de arquivos do Windows: marcam o legitimo em outra versao.
    ignoreRules: ['Suspicious_Size_'],
  },
];

const require = createRequire(join(API, 'package.json'));
const main = require.resolve('@virustotal/yara-x');
const yara = await import(pathToFileURL(main).href);
yara.initSync({ module: readFileSync(join(dirname(main), 'yara_x_js_bg.wasm')) });

const walk = (dir, out = []) => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Motivo de ficar de fora, ou null se o arquivo serve. */
const problem = (bytes) => {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    return 'não é UTF-8';
  }
  if (text.includes('\0')) return 'tem byte nulo';
  const compiler = new yara.Compiler();
  for (const name of ['filename', 'filepath', 'extension', 'filetype', 'owner']) {
    compiler.defineGlobal(name, '');
  }
  try {
    compiler.addSource(text);
    compiler.build().free();
    return null;
  } catch (err) {
    return String(err.message ?? err).split('\n')[0];
  }
};

const manifest = [];
for (const pack of PACKS) {
  const repo = join(clones, pack.clone);
  const root = join(repo, pack.folder);
  const dest = join(OUT, pack.id);
  rmSync(dest, { recursive: true, force: true });
  const files = [];
  const excluded = [];
  for (const path of walk(root).filter((f) => /\.ya?ra?$/i.test(f))) {
    const rel = relative(root, path);
    if (pack.skip(rel)) continue;
    const why = problem(readFileSync(path));
    if (why) {
      excluded.push({ file: rel.split(sep).join('/'), why });
      continue;
    }
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(path, join(dest, rel));
    files.push(rel.split(sep).join('/'));
  }
  mkdirSync(dest, { recursive: true });
  const license = readdirSync(repo).find((f) => /^licen[sc]e/i.test(f));
  if (!license) throw new Error(`${pack.id} sem licença`);
  copyFileSync(join(repo, license), join(dest, 'LICENSE'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  manifest.push({
    id: pack.id,
    name: pack.name,
    author: pack.author,
    license: pack.license,
    url: pack.url,
    defaultEnabled: pack.defaultEnabled,
    repo: pack.url.replace('https://github.com/', ''),
    folder: pack.folder,
    skipPrefixes: pack.skipPrefixes ?? [],
    description: pack.description,
    ...(pack.ignoreRules ? { ignoreRules: pack.ignoreRules } : {}),
    commit: git('rev-parse', 'HEAD'),
    commitDate: git('log', '-1', '--format=%cs'),
    files: files.sort(),
    excluded,
  });
  console.log(`${pack.id}: ${files.length} arquivos, ${excluded.length} de fora`);
  for (const e of excluded) console.log(`  de fora: ${e.file} (${e.why})`);
}
writeFileSync(join(OUT, 'packs.json'), `${JSON.stringify(manifest, null, 2)}\n`);
