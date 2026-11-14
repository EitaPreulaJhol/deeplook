/**
 * Datas digitadas no formato do idioma do app (dd/mm/aaaa em portugues, mm/dd/yyyy em ingles).
 * O campo nativo (`type="date"`) segue o idioma do navegador, nao o do app: com a interface em
 * portugues num navegador em ingles, aparecia "10/16/2026" (pendencias da varredura visual, item 1).
 */

type Part = 'day' | 'month' | 'year';

/** A ordem de dia, mes e ano no locale (pela formatacao do Intl, sem lista fixa por idioma). */
export function dateOrder(locale: string): Part[] {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(Date.UTC(2026, 10, 23)))
    .filter((p): p is Intl.DateTimeFormatPart & { type: Part } =>
      ['day', 'month', 'year'].includes(p.type),
    )
    .map((p) => p.type);
}

/** Texto de exemplo do campo: "dd/mm/aaaa" ou "mm/dd/yyyy". */
export function datePlaceholder(locale: string, letters: Record<Part, string>): string {
  return dateOrder(locale)
    .map((p) => letters[p].repeat(p === 'year' ? 4 : 2))
    .join('/');
}

/** "2026-10-16" no formato do locale ("16/10/2026"); vazio se nao for data ISO. */
export function formatIsoDate(iso: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const parts: Record<Part, string> = { year: m[1], month: m[2], day: m[3] };
  return dateOrder(locale)
    .map((p) => parts[p])
    .join('/');
}

/**
 * O texto digitado ("16/10/2026", "16-10-2026", "16.10.2026") em ISO, ou null se nao for uma data
 * do calendario (31/02 nao passa). Ano com 4 digitos; dia e mes com 1 ou 2.
 */
export function parseLocaleDate(text: string, locale: string): string | null {
  const nums = text.trim().split(/[/.\-\s]+/);
  if (nums.length !== 3 || nums.some((n) => !/^\d+$/.test(n))) return null;
  const order = dateOrder(locale);
  const value = (p: Part) => nums[order.indexOf(p)];
  if (value('year').length !== 4 || value('day').length > 2 || value('month').length > 2)
    return null;
  const [y, mo, d] = [Number(value('year')), Number(value('month')), Number(value('day'))];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${value('year')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
