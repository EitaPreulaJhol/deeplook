/**
 * CSV para o Excel em portugues: separador ";" e BOM UTF-8 (acentos corretos).
 * Celulas que comecam com = + - @ (ou tab/CR) ganham um apostrofo na frente para
 * nao virarem formula ao abrir a planilha (CSV/formula injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Marca de ordem de bytes UTF-8: faz o Excel ler os acentos corretamente. */
const BOM = String.fromCharCode(0xfeff);

const NEWLINE = '\r\n';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return BOM + lines.join(NEWLINE) + NEWLINE;
}
