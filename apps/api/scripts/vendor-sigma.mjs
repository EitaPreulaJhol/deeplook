// Atualiza as regras Sigma em apps/api/sigma (plans/novas-analises, item 1), a partir de uma release
// da SigmaHQ (https://github.com/SigmaHQ/sigma/releases), em tres colecoes:
//   - principal: o sigma_core+.zip (niveis critico, alto e medio) extraido;
//   - ameacas emergentes: o sigma_emerging_threats_addon.zip extraido;
//   - caca: a pasta rules-threat-hunting do repositorio no mesmo tag (nao vem em zip na release).
//
//   node --import tsx scripts/vendor-sigma.mjs <tag> <LICENSE> <core+> <emerging threats> <repo>
//
// O <LICENSE> e o LICENSE da raiz do repositorio no mesmo tag (DRL 1.1); <repo> e um clone do tag
// (basta o sparse-checkout de rules-threat-hunting). Copia sem alterar so as regras de Windows que o
// Sysmon cobre e que o avaliador da API (src/lib/sigma.ts) compila; as outras ficam no manifesto,
// com o motivo. Nas ameacas emergentes e na caca, as experimentais ficam de fora, como no core+.
/* global console, process */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSigma, SigmaUnsupported } from '../src/lib/sigma.ts';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(API, 'sigma');
const [tag, license, core, emerging, repo] = process.argv.slice(2);
if (!tag || !license || !core || !emerging || !repo) {
  throw new Error(
    'Uso: vendor-sigma.mjs <tag> <LICENSE> <sigma_core+> <sigma_emerging_threats_addon> <repo>',
  );
}

const COLLECTIONS = [
  {
    id: 'core',
    name: 'sigma_core+',
    source: core,
    folder: 'rules/windows',
    dir: 'sigmahq',
    defaultEnabled: true,
    experimental: true,
  },
  {
    id: 'emerging',
    name: 'Emerging Threats',
    source: emerging,
    folder: 'rules-emerging-threats',
    dir: 'sigmahq-et',
    defaultEnabled: true,
    experimental: false,
  },
  {
    // A SigmaHQ diz que estas nao sao para alertar: entram desligadas, e o analista liga uma a uma.
    id: 'hunting',
    name: 'Threat Hunting',
    source: repo,
    folder: 'rules-threat-hunting/windows',
    dir: 'sigmahq-hunting',
    defaultEnabled: false,
    experimental: false,
  },
];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.yml') ? [join(dir, d.name)] : [],
  );
const field = (yaml, name) => yaml.match(new RegExp(`^\\s*${name}:\\s*(\\S+)`, 'm'))?.[1] ?? null;

const collections = [];
for (const c of COLLECTIONS) {
  const root = join(c.source, ...c.folder.split('/'));
  const out = join(OUT, c.dir);
  rmSync(out, { recursive: true, force: true });
  const kept = [];
  const excluded = [];
  const perCategory = {};
  for (const file of walk(root).sort()) {
    const rel = relative(root, file).split(sep).join('/');
    const path = `${c.folder}/${rel}`;
    const yaml = readFileSync(file, 'utf8');
    try {
      compileSigma(yaml, path);
    } catch (err) {
      if (!(err instanceof SigmaUnsupported)) throw err;
      // Servicos que nao sao o Sysmon (security, powershell...) nem entram na contagem.
      if (/fora do Sysmon|produto não é windows/.test(err.message)) continue;
      excluded.push({ file: path, why: err.message });
      continue;
    }
    if (!c.experimental && field(yaml, 'status') === 'experimental') {
      excluded.push({ file: path, why: 'experimental' });
      continue;
    }
    mkdirSync(dirname(join(out, rel)), { recursive: true });
    copyFileSync(file, join(out, rel));
    kept.push(rel);
    const category = field(yaml, 'category') ?? field(yaml, 'service') ?? '?';
    perCategory[category] = (perCategory[category] ?? 0) + 1;
  }
  copyFileSync(license, join(out, 'LICENSE'));
  collections.push({
    id: c.id,
    name: c.name,
    folder: c.folder,
    dir: c.dir,
    defaultEnabled: c.defaultEnabled,
    rules: kept.length,
    perCategory: Object.fromEntries(Object.entries(perCategory).sort()),
    files: kept,
    excluded,
  });
  console.log(`${c.id}: ${kept.length} regra(s) copiada(s), ${excluded.length} fora.`);
}

writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify(
    {
      id: 'sigmahq',
      name: 'SigmaHQ',
      author: 'SigmaHQ e colaboradores',
      license: 'DRL 1.1',
      url: 'https://github.com/SigmaHQ/sigma',
      release: tag,
      rules: collections.reduce((n, c) => n + c.rules, 0),
      collections,
    },
    null,
    2,
  )}\n`,
);
console.log('Ver manifest.json para o que ficou de fora e por quê.');
