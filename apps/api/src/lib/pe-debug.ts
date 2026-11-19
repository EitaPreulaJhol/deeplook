import type { PeImage } from './pe-analysis';
// Tabela do richprint (BSD-2-Clause, (c) dishather), gerada por scripts/vendor-richprint.mjs.
import RICH from './rich-products.json';

/**
 * Diretorio de debug do PE (plans/analise-estatica-ampliada, item 1): o caminho do PDB (CodeView
 * RSDS ou NB10), o GUID e o age que o identificam no servidor de simbolos, os tipos de entrada
 * (POGO, REPRO...) e as datas. Tambem a ferramenta e a versao do Visual Studio de cada entrada do
 * Rich header, pela tabela do richprint.
 */

export interface PeDebug {
  /** Caminho do PDB gravado pelo linker (pista de autoria: usuario e projeto). */
  pdbPath: string | null;
  /** RSDS (atual) ou NB10 (VC6 e anteriores). */
  pdbFormat: 'RSDS' | 'NB10' | null;
  /** GUID do PDB (RSDS) e o age: os dois juntos identificam a compilacao. */
  pdbGuid: string | null;
  pdbAge: number | null;
  /** GUID sem hifens mais o age em hexadecimal, como no servidor de simbolos. */
  pdbId: string | null;
  /** Tipos de entrada presentes (CODEVIEW, POGO, REPRO...). */
  types: string[];
  /** Compilacao reprodutivel: o TimeDateStamp e um hash, nao uma data. */
  repro: boolean;
  /** Data gravada nas entradas do diretorio (a primeira nao zero). */
  timestamp: number | null;
  /** Usuario do Windows no caminho do PDB (C:\Users\<usuario>\...). */
  user: string | null;
  /** Projeto: a pasta antes de bin, obj, Release, Debug... */
  project: string | null;
  /** Compilado na configuracao Debug (uma pasta Debug no caminho). */
  debugBuild: boolean;
}

const DEBUG_TYPES: Record<number, string> = {
  1: 'COFF',
  2: 'CODEVIEW',
  3: 'FPO',
  4: 'MISC',
  5: 'EXCEPTION',
  6: 'FIXUP',
  7: 'OMAP_TO_SRC',
  8: 'OMAP_FROM_SRC',
  9: 'BORLAND',
  11: 'CLSID',
  12: 'VC_FEATURE',
  13: 'POGO',
  14: 'ILTCG',
  15: 'MPX',
  16: 'REPRO',
  17: 'EMBEDDED_PORTABLE_PDB',
  19: 'PDBCHECKSUM',
  20: 'EX_DLLCHARACTERISTICS',
};

const MAX_ENTRIES = 32;
/** Caminho do PDB: o MAX_PATH em UTF-8 cabe aqui. */
const MAX_PATH_BYTES = 1024;

/** Pastas de saida do build: o projeto e a pasta logo antes delas. */
const BUILD_DIRS = new Set([
  'bin',
  'obj',
  'x64',
  'x86',
  'win32',
  'arm64',
  'release',
  'debug',
  'out',
  'build',
  'target',
  'deps',
  'releasewithdebinfo',
  'minsizerel',
  'relwithdebinfo',
]);
/** Pastas genericas demais para serem o nome do projeto. */
const GENERIC_DIRS = new Set([
  'src',
  'source',
  'sources',
  'repos',
  'projects',
  'code',
  'dev',
  's',
  '_work',
  'a',
  'work',
  'desktop',
  'documents',
]);

function guidOf(b: Buffer): string {
  const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');
  const tail = b.subarray(8, 16).toString('hex').toUpperCase();
  return `${hex(b.readUInt32LE(0), 8)}-${hex(b.readUInt16LE(4), 4)}-${hex(b.readUInt16LE(6), 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** Usuario, projeto e configuracao a partir do caminho do PDB. */
export function pdbHints(path: string): Pick<PeDebug, 'user' | 'project' | 'debugBuild'> {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const user =
    /(?:^|[\\/])(?:Users|Documents and Settings|home)[\\/]+([^\\/]+)[\\/]/i.exec(path)?.[1] ?? null;
  let project: string | null = null;
  // Sem o nome do arquivo; a primeira pasta de build (de tras para frente, a mais externa da
  // sequencia) marca o fim do projeto.
  const dirs = parts.slice(0, -1);
  let i = dirs.length - 1;
  while (i >= 0 && BUILD_DIRS.has(dirs[i].toLowerCase())) i--;
  if (i >= 0 && i < dirs.length - 1) {
    const candidate = dirs[i];
    if (!GENERIC_DIRS.has(candidate.toLowerCase()) && !/^[a-z]:$/i.test(candidate)) {
      project = candidate;
    }
  }
  return {
    user: user && user.length <= 64 ? user : null,
    project: project && project.length <= 128 ? project : null,
    debugBuild: dirs.some((d) => d.toLowerCase() === 'debug'),
  };
}

/** Le o diretorio de debug; null sem diretorio ou ilegivel. */
export function analyzeDebug(image: PeImage): PeDebug | null {
  const dir = image.dir(6);
  if (!dir) return null;
  const at = image.rvaToOffset(dir.rva);
  if (at < 0) return null;
  const { buf } = image;
  const types = new Set<string>();
  let timestamp: number | null = null;
  let repro = false;
  let pdb: Pick<PeDebug, 'pdbPath' | 'pdbFormat' | 'pdbGuid' | 'pdbAge'> | null = null;
  const count = Math.min(Math.floor(dir.size / 28), MAX_ENTRIES);
  for (let i = 0; i < count; i++) {
    const e = at + i * 28;
    const stamp = image.u32(e + 4);
    const type = image.u32(e + 12);
    const size = image.u32(e + 16);
    const rva = image.u32(e + 20);
    const ptr = image.u32(e + 24);
    if (stamp === null || type === null || size === null || rva === null || ptr === null) break;
    types.add(DEBUG_TYPES[type] ?? `#${type}`);
    if (type === 16) repro = true;
    if (stamp && stamp !== 0xffffffff && timestamp === null) timestamp = stamp;
    if (type !== 2 || pdb) continue;
    // O ponteiro no arquivo vale mais que o RVA (dado de debug fora das secoes).
    const from = ptr && ptr < buf.length ? ptr : rva ? image.rvaToOffset(rva) : -1;
    if (from < 0 || size < 16) continue;
    const data = buf.subarray(
      from,
      Math.min(buf.length, from + Math.min(size, MAX_PATH_BYTES + 24)),
    );
    const sig = data.toString('latin1', 0, 4);
    const pathOf = (start: number) => {
      const rest = data.subarray(start);
      const end = rest.indexOf(0);
      // eslint-disable-next-line no-control-regex
      return rest.toString('utf8', 0, end < 0 ? rest.length : end).replace(/[\u0000-\u001f]/g, '');
    };
    if (sig === 'RSDS' && data.length >= 24) {
      pdb = {
        pdbFormat: 'RSDS',
        pdbGuid: guidOf(data.subarray(4, 20)),
        pdbAge: data.readUInt32LE(20),
        pdbPath: pathOf(24) || null,
      };
    } else if (sig === 'NB10' && data.length >= 16) {
      pdb = {
        pdbFormat: 'NB10',
        pdbGuid: null,
        pdbAge: data.readUInt32LE(12),
        pdbPath: pathOf(16) || null,
      };
    }
  }
  const pdbPath = pdb?.pdbPath ?? null;
  const pdbId =
    pdb?.pdbGuid && pdb.pdbAge !== null
      ? `${pdb.pdbGuid.replace(/-/g, '')}${pdb.pdbAge.toString(16).toUpperCase()}`
      : null;
  return {
    pdbPath,
    pdbFormat: pdb?.pdbFormat ?? null,
    pdbGuid: pdb?.pdbGuid ?? null,
    pdbAge: pdb?.pdbAge ?? null,
    pdbId,
    types: [...types],
    repro,
    timestamp: repro ? null : timestamp,
    ...(pdbPath ? pdbHints(pdbPath) : { user: null, project: null, debugBuild: false }),
  };
}

const TABLE = RICH as unknown as {
  versions: string[];
  builds: Record<string, [number, string]>;
  prodids: Record<string, [string, string]>;
};

/** Ferramenta ([C], [C++], [LNK]...) e versao do Visual Studio de uma entrada do Rich header. */
export function richTool(
  product: number,
  build: number,
): { tool: string | null; version: string | null } {
  if (product === 0) return { tool: null, version: null };
  if (product === 1) return { tool: 'IMP', version: null };
  const id = ((product << 16) | build) >>> 0;
  const exact = TABLE.builds[id.toString(16).padStart(8, '0')];
  if (exact) return { tool: exact[1], version: TABLE.versions[exact[0]] ?? null };
  const known = TABLE.prodids[product.toString(16).padStart(4, '0')];
  return known
    ? { tool: known[0], version: `${known[1]} build ${build}` }
    : { tool: null, version: null };
}
