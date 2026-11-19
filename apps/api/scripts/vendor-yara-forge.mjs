// Instala o pacote core do YARA Forge (https://github.com/YARAHQ/yara-forge) NESTE servidor
// (plans/analise-estatica-ampliada, item 13), fora do Git: as regras do Forge vem de dezenas de
// repositorios, cada conjunto com a licenca dele (GPL, DRL, MIT, e alguns sem licenca declarada),
// e por isso nao entram no repositorio do DeepLook.
//
//   node scripts/vendor-yara-forge.mjs <yara-forge-rules-core.zip>
//   node scripts/vendor-yara-forge.mjs --tag 20261108      (baixa a release do GitHub)
//
// Separa o arquivo unico do Forge por repositorio de origem (um conjunto por repositorio), tira os
// que ja sao pacotes dedicados (signature-base, ESET, Volexity, ReversingLabs, bartblaze), deixa so
// o que compila no YARA-X e grava:
//   - rules/yara-forge/<conjunto>.yar e rules/yara-forge/LICENSE (as licencas de cada conjunto);
//   - rules/local-packs.json, que a API junta ao packs.json.
// As duas coisas estao no .gitignore. Depois, `docker compose build api` e ligar o pacote em
// Administracao > Configuracoes. Para atualizar, rode de novo com uma release mais nova.
/* global console, process, fetch, Buffer */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = join(API, 'rules');
const OUT = join(RULES, 'yara-forge');
const args = process.argv.slice(2);
const tagAt = args.indexOf('--tag');
let zipPath = tagAt >= 0 ? null : args[0];
if (!zipPath && tagAt < 0) {
  console.error(
    'uso: node scripts/vendor-yara-forge.mjs <yara-forge-rules-core.zip> | --tag <release>',
  );
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'yara-forge-'));
try {
  if (!zipPath) {
    const tag = args[tagAt + 1];
    if (!/^\d{8}$/.test(tag ?? '')) throw new Error('a tag do Forge e uma data: --tag 20261108');
    const url = `https://github.com/YARAHQ/yara-forge/releases/download/${tag}/yara-forge-rules-core.zip`;
    const res = await fetch(url, { headers: { 'User-Agent': 'DeepLook' } });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} para ${url}`);
    zipPath = join(work, 'core.zip');
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const text = execFileSync('unzip', ['-p', zipPath, 'packages/core/yara-rules-core.yar'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  // Ja sao pacotes dedicados do DeepLook: ficam com eles.
  const DEDICATED = [
    'Neo23x0/signature-base',
    'eset/malware-ioc',
    'volexity/threat-intel',
    'reversinglabs/reversinglabs-yara-rules',
    'bartblaze/Yara-rules',
  ].map((r) => r.toLowerCase());

  const imports = [...new Set(text.match(/^import\s+"[^"]+"\s*$/gm) ?? [])].join('\n');
  const created = /Creation Date:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? '';
  const parts = text.split(/(?=^\/\*\s*\n \* YARA Rule Set\b)/m).slice(1);

  const require = createRequire(join(API, 'package.json'));
  const main = require.resolve('@virustotal/yara-x');
  const yara = await import(pathToFileURL(main).href);
  yara.initSync({ module: readFileSync(join(dirname(main), 'yara_x_js_bg.wasm')) });
  const problem = (source) => {
    const compiler = new yara.Compiler();
    for (const name of ['filename', 'filepath', 'extension', 'filetype', 'owner']) {
      compiler.defineGlobal(name, '');
    }
    try {
      compiler.addSource(source);
      compiler.build().free();
      return null;
    } catch (err) {
      return String(err.message ?? err).split('\n')[0];
    }
  };

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files = [];
  const excluded = [];
  const licenses = [];
  for (const part of parts) {
    const name = /Repository Name:\s*(.+)/.exec(part)?.[1]?.trim() ?? 'sem-nome';
    const repo = /Repository:\s*(\S+)/.exec(part)?.[1] ?? '';
    const license = /\* LICENSE\s*\n((?:\s*\*.*\n)*?)\s*\*\//
      .exec(part)?.[1]
      ?.split('\n')
      .map((l) => l.replace(/^\s*\* ?/, ''))
      .join('\n')
      .trim();
    const file = `${name.replace(/[^\w.-]+/g, '_')}.yar`;
    if (DEDICATED.some((d) => repo.toLowerCase().includes(d))) {
      excluded.push({ file, why: 'já é um pacote dedicado do DeepLook' });
      continue;
    }
    const source = `${imports}\n\n${part}`;
    const why = problem(source);
    if (why) {
      excluded.push({ file, why });
      continue;
    }
    writeFileSync(join(OUT, file), source);
    files.push(file);
    licenses.push(`==== ${name} (${repo}) ====\n${license || 'sem licença declarada'}\n`);
  }
  writeFileSync(join(OUT, 'LICENSE'), licenses.join('\n'));
  const pack = {
    id: 'yara-forge',
    name: 'YARA Forge (core)',
    author: 'YARA Forge (vários autores)',
    license: 'várias, por conjunto (ver LICENSE)',
    url: 'https://github.com/YARAHQ/yara-forge',
    defaultEnabled: false,
    description:
      'Regras de dezenas de repositórios, filtradas por qualidade e pontuação pelo YARA Forge. Instalado neste servidor pelo script, fora do Git.',
    repo: 'YARAHQ/yara-forge',
    folder: '',
    skipPrefixes: [],
    commit: created,
    commitDate: created,
    autoUpdate: false,
    files: files.sort(),
    excluded,
  };
  writeFileSync(join(RULES, 'local-packs.json'), `${JSON.stringify([pack], null, 2)}\n`);
  console.log(`yara-forge: ${files.length} conjuntos, ${excluded.length} de fora`);
  for (const e of excluded) console.log(`  de fora: ${e.file} (${e.why})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
