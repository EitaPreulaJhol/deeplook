// Atualiza as regras Sigma em apps/api/sigma (plans/novas-analises, item 1), a partir da release da
// SigmaHQ (https://github.com/SigmaHQ/sigma/releases), o arquivo sigma_core+.zip (niveis critico, alto e medio) extraido:
//   node --import tsx scripts/vendor-sigma.mjs <pasta do sigma_core+ extraido> <tag da release> <LICENSE>
// O <LICENSE> e o LICENSE da raiz do repositorio no mesmo tag (DRL 1.1). Copia sem alterar so as regras
// de Windows que o Sysmon cobre e que o avaliador da API (src/lib/sigma.ts) compila; as outras ficam
// no manifesto, com o motivo.
/* global console, process */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSigma, SigmaUnsupported } from '../src/lib/sigma.ts';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(API, 'sigma');
const [source, tag, license] = process.argv.slice(2);
if (!source || !tag || !license) {
  throw new Error('Uso: vendor-sigma.mjs <pasta do sigma_core+> <tag> <LICENSE>');
}

const windows = join(source, 'rules', 'windows');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.yml') ? [join(dir, d.name)] : [],
  );

rmSync(join(OUT, 'sigmahq'), { recursive: true, force: true });
const kept = [];
const excluded = [];
const perCategory = {};
for (const file of walk(windows).sort()) {
  const rel = relative(source, file).split(sep).join('/');
  try {
    const rule = compileSigma(readFileSync(file, 'utf8'), rel);
    const target = join(OUT, 'sigmahq', relative(windows, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
    kept.push(relative(windows, file).split(sep).join('/'));
    const category = rel.split('/')[2];
    perCategory[category] = (perCategory[category] ?? 0) + 1;
    void rule;
  } catch (err) {
    if (!(err instanceof SigmaUnsupported)) throw err;
    // Servicos que nao sao o Sysmon (security, powershell...) nem entram na contagem.
    if (/fora do Sysmon|produto não é windows/.test(err.message)) continue;
    excluded.push({ file: rel, why: err.message });
  }
}
copyFileSync(license, join(OUT, 'sigmahq', 'LICENSE'));
writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify(
    {
      id: 'sigmahq',
      name: 'SigmaHQ (sigma_core+)',
      author: 'SigmaHQ e colaboradores',
      license: 'DRL 1.1',
      url: 'https://github.com/SigmaHQ/sigma',
      release: tag,
      rules: kept.length,
      perCategory,
      files: kept,
      excluded,
    },
    null,
    2,
  )}\n`,
);
console.log(`${kept.length} regra(s) copiada(s), ${excluded.length} fora (ver manifest.json).`);
