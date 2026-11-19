// Gera src/lib/rich-products.json a partir do comp_id.txt do richprint (BSD-2-Clause,
// https://github.com/dishather/richprint), a tabela que diz qual ferramenta do Visual Studio (e
// qual versao) gerou cada entrada do Rich header.
//
//   node scripts/vendor-richprint.mjs <caminho do comp_id.txt> [commit]
//
// O JSON guarda:
//   - versions: as descricoes de versao, sem repeticao ("VS2022 v17.14.41 build 35229");
//   - builds: comp.id exato (produto << 16 | build, em hex de 8) -> indice em versions, e a
//     ferramenta ([ C ], [C++], [LNK]...);
//   - prodids: so o produto (hex de 4) -> ferramenta e familia ("VS2015+ (14.0+)"), para o build
//     que a tabela ainda nao conhece.
/* global console, process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, commit = 'master'] = process.argv.slice(2);
if (!source) {
  console.error('uso: node scripts/vendor-richprint.mjs <comp_id.txt> [commit]');
  process.exit(2);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'rich-products.json');

/** Rotulo curto da ferramenta, sem os espacos do formato. */
const tool = (tag) => tag.replace(/\s+/g, '').replace('CPP', 'C++');

const versions = [];
const versionIndex = new Map();
const builds = {};
const prodids = {};

for (const line of readFileSync(source, 'utf8').split(/\r?\n/)) {
  const full = /^([0-9a-f]{8}) \[(.{3})\] (.+?)(?:\s+\(\*\))?\s*$/.exec(line);
  if (full) {
    const [, id, tag, desc] = full;
    const kind = tool(tag);
    if (kind === '---') continue;
    if (!versionIndex.has(desc)) {
      versionIndex.set(desc, versions.length);
      versions.push(desc);
    }
    // A primeira ocorrencia vence (o arquivo lista a mais nova primeiro).
    builds[id] ??= [versionIndex.get(desc), kind];
    continue;
  }
  const prod = /^([0-9a-f]{4}) \[(.{3})\] (.+?)\s+#/.exec(line);
  if (prod) {
    const [, id, tag, family] = prod;
    prodids[id] ??= [tool(tag), family.trim()];
  }
}

const out = {
  source: `https://github.com/dishather/richprint/blob/${commit}/comp_id.txt`,
  license: 'BSD-2-Clause (c) dishather',
  versions,
  builds,
  prodids,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(
  `${Object.keys(builds).length} comp.id, ${Object.keys(prodids).length} produtos, ${versions.length} versões -> ${OUT}`,
);
