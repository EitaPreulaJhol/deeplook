/**
 * CSV para o Excel: separador ";" (Excel em portugues) ou "," (em ingles; plano pos-revisao, item
 * 1.4) e BOM UTF-8 (acentos corretos).
 * Celulas que comecam com = + - @ (ou tab/CR) ganham um apostrofo na frente para
 * nao virarem formula ao abrir a planilha (CSV/formula injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Marca de ordem de bytes UTF-8: faz o Excel ler os acentos corretamente. */
const BOM = String.fromCharCode(0xfeff);

const NEWLINE = '\r\n';

function cell(value: unknown, separator: ';' | ','): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  const special = /["\r\n]/.test(text) || text.includes(separator);
  return special ? `"${text.replace(/"/g, '""')}"` : text;
}

/** O separador do Excel no idioma de quem baixa. */
export const csvSeparator = (lang: 'pt-BR' | 'en'): ';' | ',' => (lang === 'en' ? ',' : ';');

export function toCsv(header: string[], rows: unknown[][], separator: ';' | ',' = ';'): string {
  const lines = [header, ...rows].map((row) =>
    row.map((value) => cell(value, separator)).join(separator),
  );
  return BOM + lines.join(NEWLINE) + NEWLINE;
}
