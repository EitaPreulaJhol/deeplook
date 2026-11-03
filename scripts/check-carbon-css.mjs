#!/usr/bin/env node
// Confere que o CSS do Carbon e seletivo e continua completo (item 6.10 do plano).
//
// O app.scss importa so os modulos de Sass dos componentes que as telas usam (o
// `@carbon/react` inteiro trazia ~80 componentes, os quatro temas, o grid e as fontes). O risco
// e o proximo import: um componente novo sem o modulo correspondente fica sem estilo, em
// silencio, e nenhum teste pega se aquela tela nao estiver nas capturas.
//
//   node scripts/check-carbon-css.mjs        confere
//
// Falha quando: (1) um componente importado de '@carbon/react' nao tem o modulo no app.scss;
// (2) ha modulo importado que ninguem usa (lista mentirosa); (3) aparece componente sem
// mapeamento aqui (nesse caso, acrescente a linha na tabela).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'apps/web/src/styles');
const SRC = join(ROOT, 'apps/web/src');

/** Componente do @carbon/react -> modulo de Sass do @carbon/styles. */
const MODULES = {
  Button: 'button',
  Checkbox: 'checkbox',
  DataTable: 'data-table',
  Table: 'data-table',
  TableBody: 'data-table',
  TableCell: 'data-table',
  TableContainer: 'data-table',
  TableHead: 'data-table',
  TableHeader: 'data-table',
  TableRow: 'data-table',
  ProgressBar: 'progress-bar',
  Select: 'select',
  SelectItem: 'select',
  TextArea: 'text-area',
  TextInput: 'text-input',
  PasswordInput: 'text-input',
  Tile: 'tile',
  // O tema nao e componente: e o parcial que emite os tokens do g10 (_carbon-theme.scss).
  Theme: null,
};

/**
 * Modulos que nao vem de um componente importado, mas que os componentes usam: todo campo do
 * Carbon (TextInput, TextArea, Select, Checkbox) renderiza `cds--form-item` e `cds--label`, e
 * as regras de espacamento e de label vivem no modulo `form`.
 */
const SUPPORT = {
  form: 'cds--form-item e cds--label, que os campos do Carbon renderizam',
};

const appScss = readFileSync(join(STYLES, 'app.scss'), 'utf8');
if (/@use\s+['"]@carbon\/react['"]/.test(appScss)) {
  console.error('FALHA app.scss usa @carbon/react inteiro; volte ao seletivo (item 6.10).');
  process.exit(1);
}
const imported = new Set(
  [...appScss.matchAll(/@use\s+['"]@carbon\/styles\/scss\/components\/([a-z-]+)['"]/g)].map(
    (m) => m[1],
  ),
);
const usesPartial = (name) => new RegExp(`@use\\s+['"]\\./${name}['"]`).test(appScss);

/** Todos os nomes importados de '@carbon/react' no codigo. */
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
  }
})(SRC);

const used = new Set();
const unknown = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@carbon\/react['"]/g,
  )) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .replace(/^type\s+/, '');
      if (!name) continue;
      if (!(name in MODULES)) unknown.push(`${name} (${relative(ROOT, file)})`);
      else if (MODULES[name]) used.add(MODULES[name]);
    }
  }
}
const needsTheme =
  unknown.length === 0 &&
  files.some((f) => /from\s+['"]@carbon\/react['"]/.test(readFileSync(f, 'utf8')));

const missing = [...used].filter((m) => !imported.has(m)).sort();
const unused = [...imported].filter((m) => !used.has(m) && !(m in SUPPORT)).sort();
const problems = [];
if (unknown.length)
  problems.push(`componente sem mapeamento em scripts/check-carbon-css.mjs: ${unknown.join(', ')}`);
if (missing.length) problems.push(`modulo faltando no app.scss: ${missing.join(', ')}`);
if (unused.length)
  problems.push(`modulo no app.scss sem uso (tire, para a lista nao mentir): ${unused.join(', ')}`);
if (needsTheme && !usesPartial('carbon-theme'))
  problems.push("falta @use './carbon-theme' (tokens do tema)");
// Os modulos de suporte precisam estar la enquanto houver componente que os use.
for (const [module, why] of Object.entries(SUPPORT)) {
  if (used.size && !imported.has(module)) {
    problems.push(`modulo de suporte faltando: '${module}' (${why})`);
  }
}

console.log(`componentes do Carbon em uso -> modulos: ${[...used].sort().join(', ')}`);
console.log(`modulos declarados no app.scss: ${[...imported].sort().join(', ')}`);
if (problems.length) {
  console.error(`\nFALHA\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nok: o CSS seletivo cobre todos os componentes importados');
