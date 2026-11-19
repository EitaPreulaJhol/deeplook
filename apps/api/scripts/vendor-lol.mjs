// Gera as listas compactas do LOLDrivers e do LOLRMM (Apache-2.0, magicsword-io) em src/lib/lol/,
// a partir das APIs publicas dos projetos (plans/analise-estatica-ampliada, item 4).
//
//   node scripts/vendor-lol.mjs <drivers.json> <rmm_tools.json>
//
// Os arquivos vem de https://www.loldrivers.io/api/drivers.json e
// https://lolrmm.io/api/rmm_tools.json. Fica so o que a analise usa:
//   - loldrivers.json: hash (SHA-256 do arquivo ou authentihash SHA-256) -> indice do driver;
//     cada driver com id, categoria, nome, CVEs e o uso documentado;
//   - lolrmm.json: cada ferramenta com nome, nomes de arquivo, produtos e os dominios de rede.
// LOLBAS e GTFOBins (GPL-3.0) nao entram: a lista de binarios e escrita a mao em lolbins.ts.
/* global console, process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [driversPath, rmmPath] = process.argv.slice(2);
if (!driversPath || !rmmPath) {
  console.error('uso: node scripts/vendor-lol.mjs <drivers.json> <rmm_tools.json>');
  process.exit(2);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'lol');
const today = new Date().toISOString().slice(0, 10);
const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ---- LOLDrivers
const drivers = [];
const hashes = {};
for (const d of JSON.parse(readFileSync(driversPath, 'utf8'))) {
  const index = drivers.length;
  const cves = list(d.CVE)
    .flat()
    .map(clean)
    .filter((c) => /^CVE-\d{4}-\d+$/i.test(c));
  const commands = list(d.Commands)[0] ?? {};
  drivers.push({
    id: d.Id,
    category: d.Category === 'malicious' ? 'malicious' : 'vulnerable',
    name: clean(list(d.Tags)[0]),
    cves,
    usecase: clean(commands.Usecase).slice(0, 120),
  });
  for (const s of d.KnownVulnerableSamples ?? []) {
    for (const h of [s.SHA256, s.Authentihash?.SHA256]) {
      if (typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h)) hashes[h.toLowerCase()] ??= index;
    }
  }
}
writeFileSync(
  join(OUT, 'loldrivers.json'),
  `${JSON.stringify({
    source: 'https://www.loldrivers.io/api/drivers.json',
    license: 'Apache-2.0 (c) magicsword-io/LOLDrivers',
    date: today,
    drivers,
    hashes,
  })}\n`,
);

// ---- LOLRMM
const tools = [];
for (const t of JSON.parse(readFileSync(rmmPath, 'utf8'))) {
  const meta = list(t.Details?.PEMetadata);
  const files = new Set();
  const products = new Set();
  for (const m of meta) {
    for (const f of [m?.Filename, m?.OriginalFileName])
      if (clean(f)) files.add(clean(f).toLowerCase());
    if (clean(m?.Product)) products.add(clean(m.Product));
  }
  const domains = new Set();
  for (const n of list(t.Artifacts?.Network)) {
    for (const d of list(n?.Domains))
      if (clean(d) && clean(d).includes('.')) domains.add(clean(d).toLowerCase());
  }
  tools.push({
    name: clean(t.Name),
    files: [...files],
    products: [...products],
    domains: [...domains],
  });
}
writeFileSync(
  join(OUT, 'lolrmm.json'),
  `${JSON.stringify({
    source: 'https://lolrmm.io/api/rmm_tools.json',
    license: 'Apache-2.0 (c) magicsword-io/LOLRMM',
    date: today,
    tools,
  })}\n`,
);
console.log(
  `${drivers.length} drivers (${Object.keys(hashes).length} hashes), ${tools.length} ferramentas RMM -> ${OUT}`,
);
