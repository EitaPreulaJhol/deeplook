/**
 * Busca de texto no pseudo-C completo do Ghidra (plans/ghidra-pseudo-c, fase 5). O texto mora num
 * objeto so no MinIO (lib/ghidra.ts): a busca le o objeto em fluxo, do inicio ao fim, e procura so
 * nas faixas das funcoes (o comentario com nome e endereco antes de cada uma fica de fora). A
 * memoria fica no tamanho de uma funcao (ate 256 mil caracteres), nao no do objeto.
 */

/** Funcoes com ocorrencias devolvidas; as demais so entram na contagem. */
export const SEARCH_MAX_FUNCTIONS = 200;
/** Linhas devolvidas por funcao; as demais so entram na contagem. */
export const SEARCH_MAX_LINES = 10;
/** Tamanho maximo do trecho de uma linha, em caracteres. */
export const SNIPPET_MAX = 160;
/** Caracteres mantidos antes da primeira ocorrencia quando a linha e cortada. */
const SNIPPET_BEFORE = 40;

/** Funcao com codigo, na ordem do objeto (cOffset crescente). */
export interface SearchFunction {
  entry: string;
  name: string;
  library: boolean;
  cOffset: number;
  cLength: number;
}

export interface SearchLine {
  /** Linha dentro da funcao, a partir de 1 (a mesma da janela). */
  line: number;
  /** A linha sem o recuo, cortada em SNIPPET_MAX com "…" nas pontas cortadas. */
  text: string;
  /** Ocorrencias dentro de `text`: [inicio, fim) em unidades de UTF-16, como String.slice. */
  marks: [number, number][];
}

export interface SearchHit {
  entry: string;
  name: string;
  library: boolean;
  /** Linhas com ocorrencia na funcao (as devolvidas sao ate SEARCH_MAX_LINES). */
  lineCount: number;
  lines: SearchLine[];
}

export interface SearchResult {
  /** Funcoes procuradas. */
  scanned: number;
  matchedFunctions: number;
  matchedLines: number;
  /** Mais funcoes com ocorrencia do que as devolvidas. */
  truncated: boolean;
  /** O tempo acabou antes do fim: as contagens valem so para o que foi lido. */
  partial: boolean;
  results: SearchHit[];
}

/** O texto procurado vira expressao literal: nada do que a pessoa digita e sintaxe de regex. */
export function searchPattern(q: string, caseSensitive: boolean): RegExp {
  // Com a flag u, so os caracteres de sintaxe (e a barra) aceitam escape.
  const literal = q.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  return new RegExp(literal, caseSensitive ? 'gu' : 'giu');
}

/** Nao parte um par de surrogates nas pontas do trecho. */
function safeStart(s: string, i: number): number {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff ? i + 1 : i;
}
function safeEnd(s: string, i: number): number {
  const c = s.charCodeAt(i - 1);
  return c >= 0xd800 && c <= 0xdbff ? i - 1 : i;
}

/** O trecho de uma linha e as ocorrencias nele (relativas ao inicio da linha na entrada). */
function snippet(
  line: string,
  marks: [number, number][],
): { text: string; marks: [number, number][] } {
  const indent = line.length - line.trimStart().length;
  let start = indent;
  let end = line.length;
  // Sem o \r de um fim de linha do Windows.
  if (end > start && line.charCodeAt(end - 1) === 13) end--;
  let prefix = '';
  let suffix = '';
  if (end - start > SNIPPET_MAX) {
    const first = marks[0]![0];
    if (first - SNIPPET_BEFORE > start) {
      start = safeStart(line, first - SNIPPET_BEFORE);
      prefix = '…';
    }
    if (end - start > SNIPPET_MAX) {
      end = safeEnd(line, start + SNIPPET_MAX);
      suffix = '…';
    }
  }
  const shift = prefix.length - start;
  return {
    text: prefix + line.slice(start, end) + suffix,
    marks: marks
      .filter(([s, e]) => s >= start && e <= end)
      .map(([s, e]): [number, number] => [s + shift, e + shift]),
  };
}

/** Ocorrencias num trecho de codigo, agrupadas por linha. `re` precisa da flag g. */
export function searchCode(
  code: string,
  re: RegExp,
  maxLines = SEARCH_MAX_LINES,
): { lineCount: number; lines: SearchLine[] } {
  const lines: SearchLine[] = [];
  let lineCount = 0;
  let lineNo = 1;
  let counted = 0; // ate onde as quebras de linha ja foram contadas
  let open: { line: number; start: number; end: number; marks: [number, number][] } | null = null;
  const close = () => {
    if (!open) return;
    const { text, marks } = snippet(
      code.slice(open.start, open.end),
      open.marks.map(([s, e]) => [s - open!.start, e - open!.start]),
    );
    lines.push({ line: open.line, text, marks });
    open = null;
  };
  let lastLine = 0; // a ultima linha com ocorrencia ja contada
  re.lastIndex = 0;
  for (const m of code.matchAll(re)) {
    const at = m.index;
    const end = at + m[0].length;
    for (let p = code.indexOf('\n', counted); p !== -1 && p < at; p = code.indexOf('\n', p + 1)) {
      lineNo++;
    }
    counted = at;
    if (lineNo === lastLine) {
      open?.marks.push([at, end]);
      continue;
    }
    close();
    lineCount++;
    lastLine = lineNo;
    if (lines.length < maxLines) {
      const start = code.lastIndexOf('\n', at - 1) + 1;
      const nl = code.indexOf('\n', at);
      open = { line: lineNo, start, end: nl === -1 ? code.length : nl, marks: [[at, end]] };
    }
  }
  close();
  return { lineCount, lines };
}

/** Leitor de faixas de um fluxo de bytes que so anda para frente. */
class ForwardReader {
  private readonly it: AsyncIterator<Uint8Array>;
  private buf: Buffer = Buffer.alloc(0);
  /** Posicao no objeto do primeiro byte de `buf`. */
  private at = 0;
  bytes = 0;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.it = source[Symbol.asyncIterator]();
  }

  /** Os bytes [offset, offset + length); null se o objeto acabar antes. */
  async take(offset: number, length: number): Promise<Buffer | null> {
    if (offset < this.at) throw new Error('faixas do pseudo-C fora de ordem');
    for (;;) {
      // Descarta o que ficou para tras: a memoria e a da funcao atual.
      const drop = Math.min(this.buf.length, Math.max(0, offset - this.at));
      if (drop) {
        this.buf = this.buf.subarray(drop);
        this.at += drop;
      }
      if (this.at <= offset && this.at + this.buf.length >= offset + length) break;
      const next = await this.it.next();
      if (next.done) return null;
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      this.bytes += chunk.length;
      // `at` + buf.length e sempre o total lido: o pedaco novo continua o buffer.
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    }
    const from = offset - this.at;
    return this.buf.subarray(from, from + length);
  }

  /** Para de ler (fecha o fluxo do MinIO). */
  async close(): Promise<void> {
    await this.it.return?.();
  }
}

/**
 * Procura `re` em cada funcao de `fns` (na ordem do objeto), lendo `source` uma vez. Passado
 * `deadline` (ms desde 1970), para e devolve o que achou com `partial`.
 */
export async function searchPseudo(
  source: AsyncIterable<Uint8Array>,
  fns: SearchFunction[],
  re: RegExp,
  deadline: number,
): Promise<SearchResult & { bytes: number }> {
  const reader = new ForwardReader(source);
  const results: SearchHit[] = [];
  let scanned = 0;
  let matchedFunctions = 0;
  let matchedLines = 0;
  let partial = false;
  try {
    for (const fn of fns) {
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      const bytes = await reader.take(fn.cOffset, fn.cLength);
      if (!bytes) throw new Error('pseudo-C menor que o índice');
      scanned++;
      const keep = results.length < SEARCH_MAX_FUNCTIONS;
      const { lineCount, lines } = searchCode(
        bytes.toString('utf8'),
        re,
        keep ? SEARCH_MAX_LINES : 0,
      );
      if (!lineCount) continue;
      matchedFunctions++;
      matchedLines += lineCount;
      if (keep) {
        results.push({ entry: fn.entry, name: fn.name, library: fn.library, lineCount, lines });
      }
    }
  } finally {
    await reader.close();
  }
  return {
    scanned,
    matchedFunctions,
    matchedLines,
    truncated: matchedFunctions > results.length,
    partial,
    results,
    bytes: reader.bytes,
  };
}
