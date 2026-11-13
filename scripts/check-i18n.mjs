// Texto da interface ainda fora dos dicionarios (revisao de novembro, item 2.5).
//
// A traducao vai por etapas: a moldura (menu, barra superior, login, preferencias, rotulos) ja usa
// t() de apps/web/src/i18n; as telas ainda tem o texto em portugues no codigo. Este script conta o
// que falta, por arquivo, para medir o andamento e escolher a proxima tela. E uma heuristica:
// texto entre aspas ou entre tags JSX com acento ou com palavras comuns do portugues, fora de
// comentarios, testes e dos proprios dicionarios. Pode errar para os dois lados.
//
//   node scripts/check-i18n.mjs            os 25 arquivos com mais texto e o total
//   node scripts/check-i18n.mjs --all      todos os arquivos
//   node scripts/check-i18n.mjs --max N    sai com erro se o total passar de N (para travar no CI)
//
// Antes da contagem, uma checagem que reprova (sai com erro): t() chamado no topo do modulo (o
// texto congelaria no idioma da carga) ou dentro de useMemo/useCallback sem `locale` nas
// dependencias (ficaria no idioma antigo ate outra dependencia mudar).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'apps', 'web', 'src');
const WORDS = /\b(de|da|do|das|dos|para|com|sem|uma|um|os|as|em|ao|não|nao|que|por|na|no|se|já|ou)\b/i;
const ACCENT = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔ]/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Tira comentarios (de linha e de bloco), mantendo as quebras para o numero da linha. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const looksPortuguese = (text) => {
  const clean = text.trim();
  if (clean.length < 2 || !/[A-Za-zÀ-ú]/.test(clean)) return false;
  if (/^[\w./:-]+$/.test(clean) && !ACCENT.test(clean)) return false; // classe, rota, id
  return ACCENT.test(clean) || (WORDS.test(clean) && /\s/.test(clean));
};

const ts = createRequire(join(ROOT, '..', 'package.json'))('typescript');

/** Chamadas de t() (importado de src/i18n) fora da hora de desenhar. */
function frozenCalls(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !/\/i18n(\/|'|$)/.test(stmt.moduleSpecifier.getText())) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === 't') names.add(el.name.text);
    }
  }
  if (!names.size) return [];
  const problems = [];
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) {
      let inside = null;
      for (let up = node.parent; up; up = up.parent) {
        if (ts.isFunctionLike(up)) {
          inside ??= up;
          const call = up.parent;
          if (
            call && ts.isCallExpression(call) && call.arguments[0] === up &&
            /^(useMemo|useCallback)$/.test(call.expression.getText())
          ) {
            const deps = call.arguments[1];
            if (!deps || !/\blocale\b/.test(deps.getText())) {
              problems.push(`${relative(ROOT, path)}:${line(node)}: t() em ${call.expression.getText()} sem locale nas dependencias`);
            }
            break;
          }
        }
      }
      if (!inside) problems.push(`${relative(ROOT, path)}:${line(node)}: t() no topo do modulo`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

const frozen = files(ROOT).flatMap(frozenCalls);
if (frozen.length) {
  for (const problem of frozen) console.error(problem);
  console.error(`\n${frozen.length} chamada(s) de t() que nao acompanham a troca de idioma.`);
  process.exit(1);
}

const report = files(ROOT)
  .map((path) => {
    const source = withoutComments(readFileSync(path, 'utf8'));
    const found = [
      ...[...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]),
      ...[...source.matchAll(/>([^<>{}\n]+)</g)].map((m) => m[1]),
    ].filter((text) => text && !/^\s*import\b/.test(text) && looksPortuguese(text));
    return { file: relative(ROOT, path), count: found.length };
  })
  .filter((r) => r.count > 0)
  .sort((a, b) => b.count - a.count);

const total = report.reduce((sum, r) => sum + r.count, 0);
const all = process.argv.includes('--all');
for (const r of all ? report : report.slice(0, 25)) console.log(`${String(r.count).padStart(5)}  ${r.file}`);
if (!all && report.length > 25) console.log(`  ... e mais ${report.length - 25} arquivo(s)`);
console.log(`\n${total} texto(s) em portugues fora dos dicionarios, em ${report.length} arquivo(s).`);
const max = process.argv.indexOf('--max');
if (max > 0 && total > Number(process.argv[max + 1])) {
  console.error(`acima do teto de ${process.argv[max + 1]}`);
  process.exit(1);
}
