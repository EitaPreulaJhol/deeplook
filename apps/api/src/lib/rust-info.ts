/**
 * Executavel Rust (plans/analise-estatica-ampliada, item 14): o compilador grava o caminho dos
 * fontes nas mensagens de panic, mesmo no binario sem simbolos. Daqui saem os crates usados (com a
 * versao, pelo caminho do registro do cargo), o commit do rustc e os arquivos do proprio projeto,
 * que costumam trazer o usuario e o nome do projeto de quem compilou.
 */

export interface RustInfo {
  crates: { name: string; version: string }[];
  /** Commit do rustc (/rustc/<hash>/library/...). */
  rustc: string | null;
  /** Arquivos .rs do projeto (fora do registro do cargo e da biblioteca padrao). */
  sources: string[];
}

const MAX_CRATES = 200;
const MAX_SOURCES = 100;
const CRATE_RE =
  /[\\/]\.?cargo[\\/]registry[\\/]src[\\/][^\\/\s]{1,80}[\\/]([A-Za-z0-9_-]{1,64})-(\d+\.\d+\.\d+(?:-[\w.]{1,40})?)[\\/]/g;
const RUSTC_RE = /[\\/]rustc[\\/]([0-9a-f]{40})[\\/]library[\\/]/;
const SOURCE_RE = /(?:[A-Za-z]:\\|\/)[^\s"'<>|*?\0]{1,300}?\.rs\b/g;

export function rustInfo(strings: string[]): RustInfo | null {
  const text = strings.join('\n');
  const crates = new Map<string, string>();
  for (const m of text.matchAll(CRATE_RE)) {
    if (crates.size >= MAX_CRATES) break;
    crates.set(`${m[1]}@${m[2]}`, m[1]);
  }
  const rustc = RUSTC_RE.exec(text)?.[1] ?? null;
  if (!crates.size && !rustc) return null;
  const sources = new Set<string>();
  for (const m of text.matchAll(SOURCE_RE)) {
    if (sources.size >= MAX_SOURCES) break;
    const path = m[0];
    if (/[\\/]\.?cargo[\\/]registry|[\\/]rustc[\\/][0-9a-f]{40}|[\\/]\.rustup[\\/]/.test(path)) {
      continue;
    }
    sources.add(path);
  }
  return {
    crates: [...crates.keys()]
      .map((k) => {
        const [name, version] = k.split('@');
        return { name, version };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    rustc,
    sources: [...sources],
  };
}
