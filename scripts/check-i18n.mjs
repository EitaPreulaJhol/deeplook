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
//   node scripts/check-i18n.mjs --texts    cada texto, com a linha
//
// Texto que nao e de interface (dado de exemplo, mensagem so para o console) leva `i18n-ok` num
// comentario na mesma linha ou na anterior, com o motivo.
//   node scripts/check-i18n.mjs --max N    sai com erro se o total passar de N (para travar no CI)
//
// Antes da contagem, uma checagem que reprova (sai com erro): t() chamado no topo do modulo (o
// texto congelaria no idioma da carga) ou dentro de useMemo sem `locale` nas dependencias (o
// resultado ficaria no idioma antigo ate outra dependencia mudar). useCallback nao entra: a funcao
// chama t() quando roda, ja no idioma do momento.
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

/** Tira as interpolacoes `${...}` de um template (codigo, nao texto: `as Verdict` nao e o artigo). */
function withoutInterpolations(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 0;
      for (i += 1; i < text.length; i++) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}' && --depth === 0) break;
      }
    } else out += text[i];
  }
  return out;
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
            /^(React\.)?useMemo$/.test(call.expression.getText())
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
    const original = readFileSync(path, 'utf8');
    const lines = original.split('\n');
    const source = withoutComments(original);
    const lineOf = (index) => source.slice(0, index).split('\n').length;
    // `i18n-ok` num comentario na linha (ou na anterior): texto que nao e de interface (dado de
    // exemplo, mensagem so para o console), com o motivo ao lado (pendencias da varredura, item 12).
    const allowed = (line) => /i18n-ok/.test(lines[line - 1] ?? '') || /i18n-ok/.test(lines[line - 2] ?? '');
    const found = [
      ...[...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`]*)`/g)].map((m) => ({ text: m[1] ?? m[2] ?? (m[3] === undefined ? undefined : withoutInterpolations(m[3])), line: lineOf(m.index) })),
      ...[...source.matchAll(/>([^<>{}\n]+)</g)].map((m) => ({ text: m[1], line: lineOf(m.index) })),
    ].filter(({ text, line }) => text && !/^\s*import\b/.test(text) && looksPortuguese(text) && !allowed(line));
    return { file: relative(ROOT, path), count: found.length, found };
  })
  .filter((r) => r.count > 0)
  .sort((a, b) => b.count - a.count);

const total = report.reduce((sum, r) => sum + r.count, 0);
const all = process.argv.includes('--all');
const texts = process.argv.includes('--texts');
for (const r of all || texts ? report : report.slice(0, 25)) {
  console.log(`${String(r.count).padStart(5)}  ${r.file}`);
  if (texts) for (const f of r.found) console.log(`         ${r.file}:${f.line}  ${f.text.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
}
if (!all && report.length > 25) console.log(`  ... e mais ${report.length - 25} arquivo(s)`);
console.log(`\n${total} texto(s) em portugues fora dos dicionarios, em ${report.length} arquivo(s).`);
const max = process.argv.indexOf('--max');
if (max > 0 && total > Number(process.argv[max + 1])) {
  console.error(`acima do teto de ${process.argv[max + 1]}`);
  process.exit(1);
}
