export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** Acima disso (linhas antigas x novas) o LCS ficaria pesado: mostra troca inteira. */
const MAX_CELLS = 4_000_000;

/**
 * Diferenca linha a linha entre dois textos (maior subsequencia comum): linhas
 * iguais, removidas (so no antigo) e adicionadas (so no novo), na ordem.
 */
export function lineDiff(
  before: string | null | undefined,
  after: string | null | undefined,
): DiffLine[] {
  const a = before ? before.split(/\r?\n/) : [];
  const b = after ? after.split(/\r?\n/) : [];
  // Inicio e fim iguais ficam fora da tabela.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: DiffLine[];
  if (midA.length * midB.length > MAX_CELLS) {
    middle = [
      ...midA.map((text) => ({ kind: 'del' as const, text })),
      ...midB.map((text) => ({ kind: 'add' as const, text })),
    ];
  } else {
    // lcs[i][j] = tamanho da maior subsequencia comum de midA[i..] e midB[j..].
    const cols = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        lcs[i * cols + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * cols + j + 1] + 1
            : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        middle.push({ kind: 'same', text: midA[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
        middle.push({ kind: 'del', text: midA[i++] });
      } else {
        middle.push({ kind: 'add', text: midB[j++] });
      }
    }
    while (i < midA.length) middle.push({ kind: 'del', text: midA[i++] });
    while (j < midB.length) middle.push({ kind: 'add', text: midB[j++] });
  }
  return [...head, ...middle, ...tail];
}
