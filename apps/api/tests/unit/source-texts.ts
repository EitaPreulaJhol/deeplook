import { readdirSync, readFileSync, statSync } from 'node:fs';

import ts from 'typescript';

/**
 * Leitura dos textos do codigo da API, para os testes de traducao (plano pos-revisao, itens 1.2 e
 * 1.4): messages-coverage.test.ts (erros) e status-language.test.ts (status do sistema).
 *
 * Trechos variaveis (`${...}` e o que nao e texto numa concatenacao com `+`) viram `{0}`, `{1}`...
 * na ordem em que aparecem, como nos dicionarios. Um texto dentro de uma concatenacao e lido pelo
 * topo dela; textos dentro de `${...}` nao contam sozinhos. Logs e imports ficam de fora.
 */

export const PT =
  /[ãõçáéíóúâêôàÃÇÁÉÍÓÚ]|\b(de|da|do|das|dos|para|com|sem|uma|um|não|nao|que|por|na|no|ou|em|ao|os|as)\b/i;
const LOG_METHOD = /\.(log|info|warn|error|debug|trace|fatal)$|^console\./;

export interface FoundText {
  line: number;
  text: string;
  /** Tem cara de portugues (no texto ou dentro de um `${...}`, ex.: `${msg || 'sem detalhes'}`). */
  portuguese: boolean;
}

/** Os .ts de uma pasta, sem o cliente gerado do Prisma. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

const unparen = (node: ts.Node): ts.Node =>
  ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
/** O primeiro ancestral que nao e um parentese. */
function outerParent(node: ts.Node): ts.Node | undefined {
  let up: ts.Node | undefined = node.parent;
  while (up && ts.isParenthesizedExpression(up)) up = up.parent;
  return up;
}
const isPlus = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
const isText = (node: ts.Node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

/** Concatenacao que tem algum texto (e nao uma soma de numeros). */
function hasText(node: ts.Node): boolean {
  const n = unparen(node);
  if (isText(n)) return true;
  return isPlus(n) && (hasText(n.left) || hasText(n.right));
}

/** O texto como a API o monta, com `{n}` no lugar de cada trecho variavel. */
function build(node: ts.Node, slot: { next: number }): string {
  const n = unparen(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    return n.head.text + n.templateSpans.map((s) => `{${slot.next++}}${s.literal.text}`).join('');
  }
  if (isPlus(n) && hasText(n)) return build(n.left, slot) + build(n.right, slot);
  return `{${slot.next++}}`;
}

function inLogOrImport(node: ts.Node): boolean {
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isImportDeclaration(up)) return true;
    if (ts.isCallExpression(up)) {
      const callee = up.expression.getText();
      if (LOG_METHOD.test(callee) && /log|console/.test(callee)) return true;
    }
    if (ts.isStatement(up)) return false;
  }
  return false;
}

/** O que nao e texto dentro de um texto: as expressoes de `${...}` e os operandos de um `+`. */
function nestedTexts(node: ts.Node): ts.Node[] {
  const n = unparen(node);
  if (ts.isTemplateExpression(n)) return n.templateSpans.map((s) => s.expression);
  if (isPlus(n)) {
    return [n.left, n.right].flatMap((side) => {
      const inner = unparen(side);
      return isText(inner) || isPlus(inner) ? nestedTexts(inner) : [side];
    });
  }
  return [];
}

export interface ScanOptions {
  /** Tambem os textos dentro de `${...}` e de uma concatenacao (ex.: `${x ?? 'desconhecido'}`). */
  nested?: boolean;
  /** Letras seguidas que um texto precisa ter (padrao: 3). */
  minLetters?: number;
}

/** Os textos de um arquivo que `accept` aceitar (com o no do texto, para olhar o contexto). */
export function scanTexts(
  path: string,
  accept: (node: ts.Node, found: FoundText) => boolean,
  options: ScanOptions = {},
): FoundText[] {
  const letters = new RegExp(`[A-Za-zÀ-ú]{${options.minLetters ?? 3}}`);
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: FoundText[] = [];
  const visit = (node: ts.Node): void => {
    const up = outerParent(node);
    const inChain = up !== undefined && isPlus(up);
    if ((isText(node) || (isPlus(node) && hasText(node))) && !inChain) {
      const text = build(node, { next: 0 });
      const item: FoundText = {
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text,
        portuguese: PT.test(text) || PT.test(node.getText()),
      };
      if (letters.test(text) && !inLogOrImport(node) && accept(node, item)) found.push(item);
      if (options.nested) nestedTexts(node).forEach(visit);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
