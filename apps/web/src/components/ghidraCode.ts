/**
 * Pseudo-C do Ghidra na janela de funcoes (plans/ghidra-pseudo-c, fase 3): tokenizador de C para
 * o realce e a ligacao dos nomes das funcoes chamadas. O texto vem de um arquivo hostil: daqui so
 * saem pedacos de texto com um tipo; quem desenha os poe como texto, nunca como HTML.
 */

export type TokenKind = 'keyword' | 'type' | 'number' | 'string' | 'comment' | 'name' | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

/** Acima disto, o codigo sai sem realce (o pseudo-C de uma funcao vai ate 256 mil caracteres). */
export const HIGHLIGHT_MAX = 100_000;

const KEYWORDS = new Set([
  'break',
  'case',
  'continue',
  'default',
  'do',
  'else',
  'for',
  'goto',
  'if',
  'return',
  'sizeof',
  'switch',
  'while',
  'struct',
  'union',
  'enum',
  'typedef',
  'const',
  'volatile',
  'static',
  'extern',
  'register',
  'true',
  'false',
  'NULL',
]);

/** Tipos do C e os que o Ghidra escreve (undefined4, uint, ulonglong, code...). */
const TYPES = new Set([
  'void',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  'bool',
  'byte',
  'word',
  'dword',
  'qword',
  'uchar',
  'ushort',
  'uint',
  'ulong',
  'longlong',
  'ulonglong',
  'float10',
  'code',
  'wchar_t',
  'wchar16',
  'wchar32',
  'size_t',
  'ssize_t',
  'string',
]);
/** undefined4, uint32_t, e os tipos do Windows: HANDLE, LPCWSTR, PVOID, SIZE_T... */
const TYPE_PATTERN = /^(undefined\d*|u?int\d+(_t)?|[A-Z0-9_]*(HANDLE|STR|VOID)|[A-Z][A-Z0-9_]*_T)$/;

// Ordem importa: comentario e texto antes do resto (um "//" dentro de um texto e texto).
const SCANNER =
  /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(0[xX][0-9a-fA-F]+[uUlL]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uUlLfF]*)|([A-Za-z_][\w$]*)|(\s+|[^\sA-Za-z_0-9"'/]+|\/)/gy;

function identifierKind(word: string): TokenKind {
  if (KEYWORDS.has(word)) return 'keyword';
  if (TYPES.has(word) || TYPE_PATTERN.test(word)) return 'type';
  return 'name';
}

/** Divide o codigo em pedacos com tipo; juntar os textos devolve o codigo exato. */
export function tokenizeC(code: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (kind === 'plain' && last?.kind === 'plain') last.text += text;
    else tokens.push({ kind, text });
  };
  SCANNER.lastIndex = 0;
  let pos = 0;
  while (pos < code.length) {
    SCANNER.lastIndex = pos;
    const m = SCANNER.exec(code);
    if (!m || m[0] === '') {
      // Nao deveria acontecer (a ultima alternativa pega qualquer caractere); por garantia.
      push('plain', code[pos]);
      pos += 1;
      continue;
    }
    if (m[1] !== undefined) push('comment', m[1]);
    else if (m[2] !== undefined) push('string', m[2]);
    else if (m[3] !== undefined) push('number', m[3]);
    else if (m[4] !== undefined) push(identifierKind(m[4]), m[4]);
    else push('plain', m[0]);
    pos = SCANNER.lastIndex;
  }
  return tokens;
}

/**
 * Nomes clicaveis no codigo: as funcoes que esta chama, pelo nome como aparece no C (o Ghidra da o
 * nome com o namespace, "Classe::metodo"; o tokenizador ve so o ultimo pedaco). Nome repetido em
 * duas funcoes nao vira link: nao ha como saber qual delas o codigo chama.
 */
export function linkTargets(links: { entry: string; name: string | null }[]): Map<string, string> {
  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const { entry, name } of links) {
    if (!name) continue;
    const short = name.split('::').pop()!;
    for (const key of new Set([name, short])) {
      const seen = targets.get(key);
      if (seen !== undefined && seen !== entry) ambiguous.add(key);
      else targets.set(key, entry);
    }
  }
  for (const key of ambiguous) targets.delete(key);
  return targets;
}
