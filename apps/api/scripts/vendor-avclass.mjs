// Gera src/lib/avclass.json a partir dos dados do AVclass (MIT, malicialab/avclass): a taxonomia,
// as regras de rotulo (alias -> tag) e as expansoes (plans/analise-estatica-ampliada, item 6).
//
//   node scripts/vendor-avclass.mjs <pasta com default.taxonomy, default.tagging e default.expansion> [commit]
//
// A leitura e a do common.py do AVclass: o nome da tag e o ultimo trecho (minusculo), a categoria o
// primeiro (maiusculo); nome repetido com outro caminho fica com o primeiro; a regra liga o nome da
// origem aos nomes dos destinos, sem a propria origem.
/* global console, process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir, commit = 'master'] = process.argv.slice(2);
if (!dir) {
  console.error('uso: node scripts/vendor-avclass.mjs <pasta> [commit]');
  process.exit(2);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'avclass.json');
const lines = (name) =>
  readFileSync(join(dir, name), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'));
const tag = (s) => {
  const words = s.trim().split(':');
  return words.length > 1
    ? {
        name: words.at(-1).toLowerCase(),
        cat: words[0].toUpperCase(),
        prefix: words.slice(1, -1).map((w) => w.toLowerCase()),
      }
    : { name: words[0].toLowerCase(), cat: 'UNC', prefix: [] };
};

const taxonomy = {};
for (const line of lines('default.taxonomy')) {
  const t = tag(line);
  taxonomy[t.name] ??= [t.cat, t.prefix];
}
const rules = (name) => {
  const map = {};
  for (const line of lines(name)) {
    const words = line.trim().split(/\s+/);
    if (words.length < 2) continue;
    const src = tag(words[0]).name;
    const dst = words
      .slice(1)
      .map((w) => tag(w).name)
      .filter((d) => d !== src);
    if (!dst.length) continue;
    map[src] = [...new Set([...(map[src] ?? []), ...dst])];
  }
  return map;
};
const out = {
  source: `https://github.com/malicialab/avclass/tree/${commit}/avclass/data`,
  license: 'MIT (c) malicialab/avclass',
  taxonomy,
  tagging: rules('default.tagging'),
  expansion: rules('default.expansion'),
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(
  `${Object.keys(taxonomy).length} tags, ${Object.keys(out.tagging).length} regras, ${Object.keys(out.expansion).length} expansões -> ${OUT}`,
);
