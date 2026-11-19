import type { Db } from './prisma';
import type { StaticInfo } from './static-analysis';

/**
 * Pivos (plans/analise-estatica-ampliada): valores que ligam amostras na aba Relacionadas, alem do
 * imphash, do Rich header e do TLSH (que sao colunas da Entry). Ficam em EntryPivot, um por linha,
 * com a origem: a analise estatica regrava os seus a cada analise, e cada servico os dele.
 */

export const PIVOT_KINDS = {
  /** Caminho do PDB (so com pasta: "ntdll.pdb" sozinho liga todas as copias do Windows). */
  PDB_PATH: { weight: 40 },
  /** GUID + age do PDB: a mesma compilacao, mesmo com o binario alterado depois. */
  PDB_ID: { weight: 70 },
} as const;

export type PivotKind = keyof typeof PIVOT_KINDS;
export interface Pivot {
  kind: PivotKind;
  value: string;
}
export type PivotSource = 'static';

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
