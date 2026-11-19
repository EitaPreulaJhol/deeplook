import type { Db } from './prisma';
import type { StaticInfo } from './static-analysis';

/**
 * Pivos (plans/analise-estatica-ampliada): valores que ligam amostras na aba Relacionadas, alem do
 * imphash, do Rich header e do TLSH (que sao colunas da Entry). Ficam em EntryPivot, um por linha,
 * com a origem: a analise estatica regrava os seus a cada analise, e cada servico os dele.
 */

/**
 * Cada tipo: o peso na ordenacao da aba Relacionadas e como se compara. `exact` liga o mesmo valor;
 * `hamming` e `tlsh` ligam valores proximos, ate `max` (bits diferentes ou distancia do TLSH).
 */
export const PIVOT_KINDS = {
  /** Caminho do PDB (so com pasta: "ntdll.pdb" sozinho liga todas as copias do Windows). */
  PDB_PATH: { weight: 40, match: 'exact' },
  /** GUID + age do PDB: a mesma compilacao, mesmo com o binario alterado depois. */
  PDB_ID: { weight: 70, match: 'exact' },
  /** SHA-256 do Authenticode: o mesmo codigo, com outra assinatura ou outro overlay (item 2). */
  AUTHENTIHASH: { weight: 90, match: 'exact' },
  /** MD5 das exportacoes, como o get_exphash do pefile (so com 3 ou mais nomes). */
  EXPHASH: { weight: 35, match: 'exact' },
  /** dHash do icone principal: ate 4 bits de diferenca. */
  ICON_DHASH: { weight: 25, match: 'hamming', max: 4 },
  /** telfhash do ELF: distancia ate 50, o corte que a Trend Micro usa para agrupar. */
  TELFHASH: { weight: 40, match: 'tlsh', max: 50 },
  /** symhash de cada arquitetura do Mach-O (so com 5 ou mais simbolos). */
  SYMHASH: { weight: 30, match: 'exact' },
  /** Modulo principal de um executavel Go, pelo GoReSym (item 14): o caminho do projeto. */
  GO_MODULE: { weight: 50, match: 'exact' },
} as const satisfies Record<
  string,
  { weight: number; match: 'exact' | 'hamming' | 'tlsh'; max?: number }
>;

export type PivotKind = keyof typeof PIVOT_KINDS;
export interface Pivot {
  kind: PivotKind;
  value: string;
}
export type PivotSource = 'static' | 'unpack';

/** Exportacoes com nome abaixo disto: tabela generica demais (DllMain, uma funcao so). */
const MIN_EXPORTS = 3;
/** Simbolos importados do Mach-O abaixo disto: o symhash ligaria qualquer binario minimo. */
const MIN_MACHO_SYMBOLS = 5;

/** Tamanho maximo do valor guardado (caminho de PDB longo e cortado aqui). */
const MAX_VALUE = 512;

/** Caminho do PDB comparavel: sem diferenca de maiusculas nem de barra. */
export const normalizePdbPath = (path: string) => path.replace(/\//g, '\\').toLowerCase();

/** Os pivos que a analise estatica da amostra produz. */
export function staticPivots(info: StaticInfo | null | undefined): Pivot[] {
  const out: Pivot[] = [];
  const debug = info?.pe?.debug;
  if (debug?.pdbPath && /[\\/]/.test(debug.pdbPath)) {
    out.push({ kind: 'PDB_PATH', value: normalizePdbPath(debug.pdbPath) });
  }
  if (debug?.pdbId) out.push({ kind: 'PDB_ID', value: debug.pdbId });
  const pe = info?.pe;
  if (pe?.authentihash) out.push({ kind: 'AUTHENTIHASH', value: pe.authentihash });
  const named = pe?.exports?.symbols.filter((e) => e.name).length ?? 0;
  if (pe?.exphash && named >= MIN_EXPORTS) out.push({ kind: 'EXPHASH', value: pe.exphash });
  // Icone liso (todo branco, todo de uma cor) da hash sem bits: nao liga nada.
  if (pe?.icon && !/^(0{16}|f{16})$/.test(pe.icon.hash)) {
    out.push({ kind: 'ICON_DHASH', value: pe.icon.hash });
  }
  if (info?.elf?.telfhash) out.push({ kind: 'TELFHASH', value: info.elf.telfhash });
  if (info?.macho && info.macho.importedSymbols >= MIN_MACHO_SYMBOLS) {
    for (const s of info.macho.symhashes ?? []) out.push({ kind: 'SYMHASH', value: s.symhash });
  }
  const seen = new Set<string>();
  return out
    .map((p) => ({ ...p, value: p.value.slice(0, MAX_VALUE) }))
    .filter((p) => {
      const key = `${p.kind}\u0000${p.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Regrava os pivos de uma origem da amostra (os das outras origens ficam). */
export async function replacePivots(
  db: Db,
  entryId: string,
  source: PivotSource,
  pivots: Pivot[],
): Promise<void> {
  await db.entryPivot.deleteMany({ where: { entryId, source } });
  if (pivots.length) {
    await db.entryPivot.createMany({
      data: pivots.map((p) => ({ entryId, source, kind: p.kind, value: p.value })),
      skipDuplicates: true,
    });
  }
}
