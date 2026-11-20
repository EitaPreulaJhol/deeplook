/**
 * Aba de strings unificada (plans/analise-estatica-ampliada, item 26): as strings do arquivo (ASCII e
 * UTF-16, com o deslocamento), as do FLOSS (decodificadas, de pilha e "tight") e os literais do
 * codigo descompilado (.NET, Java, Python), cada uma com a origem e as categorias. A ordem vem do
 * StringSifter (servico ml); sem ele, de uma nota pelas categorias.
 */

export type StringSource =
  'ascii' | 'utf16' | 'floss-decoded' | 'floss-stack' | 'floss-tight' | 'dotnet' | 'jar' | 'python';

export type StringCategory =
  'url' | 'ip' | 'email' | 'path' | 'registry' | 'base64' | 'crypto' | 'command';

export interface TabString {
  text: string;
  source: StringSource;
  /** Deslocamento no arquivo (so as do arquivo). */
  offset: number | null;
  categories: StringCategory[];
  score: number;
}

const MIN = 6;
const MAX_LEN = 400;
export const MAX_FILE_STRINGS = 20_000;
const MAX_LITERALS = 3000;

/** Sequencias legiveis ASCII e UTF-16LE (6+ caracteres), com o deslocamento. */
export function stringsWithOffsets(buf: Buffer, max = MAX_FILE_STRINGS): TabString[] {
  const out: TabString[] = [];
  const printable = (b: number) => b >= 0x20 && b < 0x7f;
  let start = -1;
  for (let i = 0; i <= buf.length && out.length < max; i++) {
    if (i < buf.length && printable(buf[i])) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= MIN) {
        out.push(item(buf.toString('latin1', start, Math.min(i, start + MAX_LEN)), 'ascii', start));
      }
      start = -1;
    }
  }
  for (const align of [0, 1]) {
    start = -1;
    for (let i = align; i <= buf.length && out.length < max; i += 2) {
      if (i + 1 < buf.length && printable(buf[i]) && buf[i + 1] === 0) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if ((i - start) / 2 >= MIN) {
          out.push(
            item(buf.toString('utf16le', start, Math.min(i, start + 2 * MAX_LEN)), 'utf16', start),
          );
        }
        start = -1;
      }
    }
  }
  return out;
}

const CATEGORY_RULES: [StringCategory, RegExp][] = [
  ['url', /\b(?:https?|ftp):\/\/[^\s"'<>]{3,}/i],
  ['ip', /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/],
  ['email', /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i],
  ['path', /(?:\b[a-z]:\\|%[a-z]+%\\|\\\\[\w.-]+\\|\/(?:tmp|etc|usr|var|home|dev)\/)/i],
  ['registry', /\b(?:HKEY_[A-Z_]+|HKLM|HKCU|HKCR)\\/],
  ['base64', /^[A-Za-z0-9+/]{24,}={0,2}$/],
  [
    'crypto',
    /BEGIN (?:RSA |EC |)(?:PUBLIC|PRIVATE) KEY|\b(?:AES|RC4|ChaCha20|Salsa20|RSA|SHA-?256|MD5|Blowfish|CryptAcquireContext|BCryptEncrypt)\b/i,
  ],
  [
    'command',
    /\b(?:cmd(?:\.exe)?\s+\/[ck]|powershell|wscript|cscript|mshta|rundll32|regsvr32|schtasks|vssadmin|bcdedit|certutil|bitsadmin|curl\s|wget\s|chmod\s|\/bin\/(?:ba)?sh)\b/i,
  ],
];

const WEIGHT: Record<StringCategory, number> = {
  url: 9,
  ip: 7,
  command: 8,
  registry: 6,
  path: 5,
  email: 6,
  crypto: 5,
  base64: 4,
};

export function categoriesOf(text: string): StringCategory[] {
  return CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([c]) => c);
}

/** A nota sem o StringSifter: as categorias, e um pouco de comprimento e de variedade. */
export function heuristicScore(text: string, categories: StringCategory[]): number {
  const cat = categories.reduce((n, c) => n + WEIGHT[c], 0);
  const letters = (text.match(/[a-z]/gi) ?? []).length / Math.max(1, text.length);
  const unique = new Set(text).size / Math.max(1, Math.min(text.length, 40));
  return Math.round((cat + Math.min(text.length, 60) / 20 + letters * 2 + unique * 2) * 100) / 100;
}

function item(text: string, source: StringSource, offset: number | null): TabString {
  const categories = categoriesOf(text);
  return { text, source, offset, categories, score: heuristicScore(text, categories) };
}

export const tabString = item;

/** Os literais de texto de um fonte descompilado ("..."), sem os escapes de aspas. */
export function literalsOf(source: string, kind: 'dotnet' | 'jar' | 'python'): TabString[] {
  const out: TabString[] = [];
  const re =
    kind === 'python' ? /(['"])((?:(?!\1)[^\\\n]|\\.){6,400})\1/g : /"((?:[^"\\\n]|\\.){6,400})"/g;
  for (const m of source.matchAll(re)) {
    if (out.length >= MAX_LITERALS) break;
    const raw = kind === 'python' ? m[2] : m[1];
    out.push(item(raw.replace(/\\(["'\\])/g, '$1'), kind, null));
  }
  return out;
}

/** Sem repetir o mesmo texto da mesma origem; o primeiro deslocamento fica. */
export function dedupe(list: TabString[]): TabString[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = `${s.source}\u0000${s.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
