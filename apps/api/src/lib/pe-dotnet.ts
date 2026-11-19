import { entropy } from './entropy';
import { detectType } from './file-type';
import type { PeAlert, PeImage } from './pe-analysis';

/**
 * Assembly .NET (item 7.1): todo .NET importa so `mscoree.dll!_CorExeMain`, entao o que ele usa de
 * verdade esta nos metadados do CLR (ECMA-335, particao II, cap. 24). Daqui saem a versao do
 * runtime, o assembly, as referencias, as APIs nativas chamadas por P/Invoke (o "import" real de
 * um carregador .NET), chamadas de reflexao sensiveis e marcas de ofuscador. Tabelas e heaps sao
 * lidos com teto de linhas e checagem de limites; tabela desconhecida encerra a leitura.
 */

const MAX_ROWS_READ = 20_000;
const MAX_LIST = 200;

export interface DotnetInfo {
  /** Versao do runtime pedida nos metadados (ex.: v4.0.30319). */
  runtime: string | null;
  /** IL only, 32 bits, nome forte, entrada nativa. */
  flags: string[];
  assembly: { name: string; version: string } | null;
  module: string | null;
  assemblyRefs: string[];
  /** Funcoes nativas chamadas por P/Invoke (DllImport). */
  pinvoke: { dll: string; name: string }[];
  /** Chamadas sensiveis (carregar assembly da memoria, baixar, executar...). */
  suspicious: string[];
  obfuscator: string | null;
  types: number;
  methods: number;
  /**
   * Recursos embutidos no assembly (ManifestResource), que podem ser baixados separados
   * (plans/analise-estatica-ampliada, item 30). Ausente nas analises anteriores.
   */
  resources?: DotnetResource[];
}

export interface DotnetResource {
  name: string;
  size: number;
  entropy: number;
  /** Conteudo reconhecido pela assinatura (pe, zip, png...). */
  content: string | null;
  public: boolean;
}

/** Onde estao os bytes de cada recurso .NET (na ordem de `resources`). */
export interface DotnetResourceData {
  name: string;
  offset: number;
  size: number;
}

const CLR_FLAGS: [number, string][] = [
  [0x1, 'IL only'],
  [0x2, '32 bits obrigatório'],
  [0x8, 'nome forte'],
  [0x10, 'entrada nativa'],
  [0x20000, '32 bits preferido'],
];

// Indices codificados: bits da etiqueta e tabelas possiveis (-1 = nao usada).
const CODED: Record<string, [number, number[]]> = {
  TypeDefOrRef: [2, [0x02, 0x01, 0x1b]],
  HasConstant: [2, [0x04, 0x08, 0x17]],
  HasCustomAttribute: [
    5,
    [
      0x06, 0x04, 0x01, 0x02, 0x08, 0x09, 0x0a, 0x00, 0x0e, 0x17, 0x14, 0x11, 0x1a, 0x1b, 0x20,
      0x23, 0x26, 0x27, 0x28, 0x2a, 0x2c, 0x2b,
    ],
  ],
  HasFieldMarshal: [1, [0x04, 0x08]],
  HasDeclSecurity: [2, [0x02, 0x06, 0x20]],
  MemberRefParent: [3, [0x02, 0x01, 0x1a, 0x06, 0x1b]],
  HasSemantics: [1, [0x14, 0x17]],
  MethodDefOrRef: [1, [0x06, 0x0a]],
  MemberForwarded: [1, [0x04, 0x06]],
  Implementation: [2, [0x26, 0x23, 0x27]],
  CustomAttributeType: [3, [-1, -1, 0x06, 0x0a, -1]],
  ResolutionScope: [2, [0x00, 0x1a, 0x23, 0x01]],
  TypeOrMethodDef: [1, [0x02, 0x06]],
};

// Colunas de cada tabela: 2/4 = inteiro fixo, s/g/b = indice de heap (strings, guid, blob),
// tNN = indice simples para a tabela NN, c:Nome = indice codificado.
const SCHEMA: Record<number, string[]> = {
  0x00: ['2', 's', 'g', 'g', 'g'],
  0x01: ['c:ResolutionScope', 's', 's'],
  0x02: ['4', 's', 's', 'c:TypeDefOrRef', 't04', 't06'],
  0x03: ['t04'],
  0x04: ['2', 's', 'b'],
  0x05: ['t06'],
  0x06: ['4', '2', '2', 's', 'b', 't08'],
  0x07: ['t08'],
  0x08: ['2', '2', 's'],
  0x09: ['t02', 'c:TypeDefOrRef'],
  0x0a: ['c:MemberRefParent', 's', 'b'],
  0x0b: ['2', 'c:HasConstant', 'b'],
  0x0c: ['c:HasCustomAttribute', 'c:CustomAttributeType', 'b'],
  0x0d: ['c:HasFieldMarshal', 'b'],
  0x0e: ['2', 'c:HasDeclSecurity', 'b'],
  0x0f: ['2', '4', 't02'],
  0x10: ['4', 't04'],
  0x11: ['b'],
  0x12: ['t02', 't14'],
  0x13: ['t14'],
  0x14: ['2', 's', 'c:TypeDefOrRef'],
  0x15: ['t02', 't17'],
  0x16: ['t17'],
  0x17: ['2', 's', 'b'],
  0x18: ['2', 't06', 'c:HasSemantics'],
  0x19: ['t02', 'c:MethodDefOrRef', 'c:MethodDefOrRef'],
  0x1a: ['s'],
  0x1b: ['b'],
  0x1c: ['2', 'c:MemberForwarded', 's', 't1a'],
  0x1d: ['4', 't04'],
  0x1e: ['4', '4'],
  0x1f: ['4'],
  0x20: ['4', '2', '2', '2', '2', '4', 'b', 's', 's'],
  0x21: ['4'],
  0x22: ['4', '4', '4'],
  0x23: ['2', '2', '2', '2', '4', 'b', 's', 's', 'b'],
  0x24: ['4', 't23'],
  0x25: ['4', '4', '4', 't23'],
  0x26: ['4', 's', 'b'],
  0x27: ['4', '4', 's', 's', 'c:Implementation'],
  0x28: ['4', '4', 's', 'c:Implementation'],
  0x29: ['t02', 't02'],
  0x2a: ['2', '2', 'c:TypeOrMethodDef', 's'],
  0x2b: ['c:MethodDefOrRef', 'b'],
  0x2c: ['t2a', 'c:TypeDefOrRef'],
};

/** APIs nativas que, chamadas de .NET, quase sempre servem para rodar codigo na memoria. */
const SENSITIVE_PINVOKE = new Set([
  'VirtualAlloc',
  'VirtualAllocEx',
  'VirtualProtect',
  'VirtualProtectEx',
  'WriteProcessMemory',
  'ReadProcessMemory',
  'CreateRemoteThread',
  'CreateThread',
  'NtUnmapViewOfSection',
  'ZwUnmapViewOfSection',
  'NtWriteVirtualMemory',
  'SetThreadContext',
  'ResumeThread',
  'QueueUserAPC',
  'RtlMoveMemory',
  'GetProcAddress',
  'LoadLibraryA',
  'LoadLibraryW',
  'SetWindowsHookExA',
  'SetWindowsHookExW',
  'GetAsyncKeyState',
  'IsDebuggerPresent',
  'CheckRemoteDebuggerPresent',
  'OpenProcess',
  'AdjustTokenPrivileges',
]);

/** Tipo::membro (referencias a outras bibliotecas) que contam a historia de um carregador. */
const SENSITIVE_MEMBERS: [RegExp, string][] = [
  [
    /^System\.Reflection\.Assembly::(Load|LoadFile|LoadFrom|UnsafeLoadFrom)$/,
    'Assembly.Load (carrega código da memória)',
  ],
  [/^System\.AppDomain::Load$/, 'AppDomain.Load (carrega código da memória)'],
  [
    /^System\.Reflection\.(MethodBase|MethodInfo)::Invoke$/,
    'MethodInfo.Invoke (chamada por reflexão)',
  ],
  [/^System\.Convert::FromBase64String$/, 'Convert.FromBase64String'],
  [/^System\.Diagnostics\.Process::Start$/, 'Process.Start (executa programa)'],
  [
    /^System\.Net\.WebClient::(DownloadData|DownloadString|DownloadFile|OpenRead)/,
    'WebClient (baixa da internet)',
  ],
  [/^System\.Net\.WebRequest::Create$/, 'WebRequest.Create'],
  [
    /^System\.Net\.Http\.HttpClient::(GetByteArrayAsync|GetStringAsync|GetAsync|GetStreamAsync)$/,
    'HttpClient (baixa da internet)',
  ],
  [
    /^System\.Runtime\.InteropServices\.Marshal::(GetDelegateForFunctionPointer|Copy)$/,
    'Marshal (executa código nativo da memória)',
  ],
  [/^System\.Security\.Cryptography\.\w+::CreateDecryptor$/, 'CreateDecryptor (decifra conteúdo)'],
  [/^Microsoft\.Win32\.RegistryKey::SetValue$/, 'RegistryKey.SetValue (grava no registro)'],
  [/^System\.Management\.ManagementObjectSearcher::/, 'WMI (ManagementObjectSearcher)'],
];

/** Atributos que ofuscadores conhecidos deixam no assembly. */
const OBFUSCATORS: [string, string][] = [
  ['ConfusedByAttribute', 'ConfuserEx'],
  ['DotfuscatorAttribute', 'Dotfuscator'],
  ['PoweredByAttribute', 'SmartAssembly'],
  ['BabelObfuscatorAttribute', 'Babel'],
  ['ObfuscatedByGoliath', 'Goliath'],
  ['YanoAttribute', 'Yano'],
  ['ObfuscatedByAgileDotNetAttribute', 'Agile.NET'],
  ['CryptoObfuscator', 'Crypto Obfuscator'],
];

/** Recursos listados e bytes somados na entropia deles (o resto entra por amostra). */
const MAX_RESOURCES = 200;
const RESOURCE_ENTROPY_BUDGET = 32 * 1024 * 1024;
const RESOURCE_ENTROPY_SAMPLE = 64 * 1024;

export function analyzeDotnet(
  pe: PeImage,
): { info: DotnetInfo; alerts: PeAlert[]; resourceData: DotnetResourceData[] } | null {
  const dir = pe.dir(14);
  const cli = dir ? pe.rvaToOffset(dir.rva) : -1;
  if (!dir || cli < 0) return null;
  const { buf, u16, u32 } = pe;
  const mdRva = u32(cli + 8);
  const clrFlags = u32(cli + 16) ?? 0;
  const md = mdRva ? pe.rvaToOffset(mdRva) : -1;
  const base: DotnetInfo = {
    runtime: null,
    flags: CLR_FLAGS.filter(([bit]) => clrFlags & bit).map(([, label]) => label),
    assembly: null,
    module: null,
    assemblyRefs: [],
    pinvoke: [],
    suspicious: [],
    obfuscator: null,
    types: 0,
    methods: 0,
  };
  if (md < 0 || u32(md) !== 0x424a5342) return { info: base, alerts: [], resourceData: [] };
  const mdSize = Math.min(u32(cli + 12) ?? 0, buf.length - md);
  const mdEnd = md + mdSize;
  const verLen = u32(md + 12) ?? 0;
  if (verLen > 256 || md + 16 + verLen > mdEnd) return { info: base, alerts: [], resourceData: [] };
  base.runtime = buf.toString('latin1', md + 16, md + 16 + verLen).replace(/\0.*$/s, '') || null;

  // Cabecalhos dos streams: offset, tamanho e nome (NUL, alinhado a 4).
  let p = md + 16 + ((verLen + 3) & ~3) + 2;
  const nStreams = Math.min(u16(p) ?? 0, 16);
  p += 2;
  const streams = new Map<string, { at: number; size: number }>();
  for (let i = 0; i < nStreams; i++) {
    const off = u32(p);
    const size = u32(p + 4);
    const name = pe.cstr(p + 8, 32);
    if (off === null || size === null || name === null) break;
    const at = md + off;
    if (at < mdEnd && at + size <= mdEnd) streams.set(name, { at, size });
    p = p + 8 + ((name.length + 4) & ~3);
  }
  const tables = streams.get('#~') ?? streams.get('#-');
  const strings = streams.get('#Strings');
  if (!tables) return { info: base, alerts: [], resourceData: [] };

  const t = tables.at;
  const heapSizes = buf[t + 6];
  const validLo = u32(t + 8) ?? 0;
  const validHi = u32(t + 12) ?? 0;
  const rows: number[] = new Array(64).fill(0);
  let q = t + 24;
  for (let id = 0; id < 64; id++) {
    const present = id < 32 ? (validLo >>> id) & 1 : (validHi >>> (id - 32)) & 1;
    if (!present) continue;
    const n = u32(q);
    if (n === null) return { info: base, alerts: [], resourceData: [] };
    rows[id] = n;
    q += 4;
  }
  if (heapSizes & 0x40) q += 4;

  const strSize = heapSizes & 0x01 ? 4 : 2;
  const guidSize = heapSizes & 0x02 ? 4 : 2;
  const blobSize = heapSizes & 0x04 ? 4 : 2;
  const codedSize = (name: string) => {
    const [bits, ids] = CODED[name];
    const max = Math.max(...ids.map((id) => (id < 0 ? 0 : rows[id])));
    return max < 1 << (16 - bits) ? 2 : 4;
  };
  const colSize = (col: string) => {
    if (col === '2') return 2;
    if (col === '4') return 4;
    if (col === 's') return strSize;
    if (col === 'g') return guidSize;
    if (col === 'b') return blobSize;
    if (col.startsWith('t')) return rows[parseInt(col.slice(1), 16)] < 0x10000 ? 2 : 4;
    return codedSize(col.slice(2));
  };

  // Posicao de cada tabela: em sequencia, na ordem dos ids. Tabela fora do esquema (ex.: as de
  // PDB portatil) para a conta, e o que vem depois dela nao e lido.
  const layout = new Map<number, { at: number; rowSize: number; cols: number[]; n: number }>();
  for (let id = 0; id < 64; id++) {
    if (!rows[id]) continue;
    const schema = SCHEMA[id];
    if (!schema) break;
    const sizes = schema.map(colSize);
    const rowSize = sizes.reduce((a, b) => a + b, 0);
    const cols = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
    if (q + rowSize * rows[id] > tables.at + tables.size) break;
    layout.set(id, { at: q, rowSize, cols, n: rows[id] });
    q += rowSize * rows[id];
  }
  const cell = (id: number, row: number, col: number): number | null => {
    const tb = layout.get(id);
    if (!tb || row < 1 || row > tb.n) return null;
    const o = tb.at + (row - 1) * tb.rowSize + tb.cols[col];
    const size = colSize(SCHEMA[id][col]);
    return size === 2 ? u16(o) : u32(o);
  };
  const str = (index: number | null): string => {
    if (!strings || index === null || index >= strings.size) return '';
    const at = strings.at + index;
    const window = buf.subarray(at, Math.min(strings.at + strings.size, at + 512));
    const end = window.indexOf(0);
    return window.toString('utf8', 0, end < 0 ? window.length : end);
  };
  const count = (id: number) => (layout.has(id) ? Math.min(rows[id], MAX_ROWS_READ) : 0);

  base.types = rows[0x02];
  base.methods = rows[0x06];
  base.module = str(cell(0x00, 1, 1)) || null;
  if (layout.has(0x20)) {
    const v = [1, 2, 3, 4].map((c) => cell(0x20, 1, c) ?? 0).join('.');
    base.assembly = { name: str(cell(0x20, 1, 7)), version: v };
  }
  for (let r = 1; r <= count(0x23) && base.assemblyRefs.length < MAX_LIST; r++) {
    base.assemblyRefs.push(str(cell(0x23, r, 6)));
  }
  for (let r = 1; r <= count(0x1c) && base.pinvoke.length < MAX_LIST; r++) {
    const scope = cell(0x1c, r, 3);
    base.pinvoke.push({ dll: str(cell(0x1a, scope ?? 0, 0)), name: str(cell(0x1c, r, 2)) });
  }

  // Referencias a membros de outras bibliotecas: Namespace.Tipo::Membro.
  const typeRef = (row: number) => {
    const ns = str(cell(0x01, row, 2));
    const name = str(cell(0x01, row, 1));
    return ns ? `${ns}.${name}` : name;
  };
  const suspicious = new Set<string>();
  const [parentBits] = CODED.MemberRefParent;
  for (let r = 1; r <= count(0x0a); r++) {
    const parent = cell(0x0a, r, 0);
    if (parent === null || (parent & ((1 << parentBits) - 1)) !== 1) continue; // so TypeRef
    const member = `${typeRef(parent >>> parentBits)}::${str(cell(0x0a, r, 1))}`;
    for (const [re, label] of SENSITIVE_MEMBERS) if (re.test(member)) suspicious.add(label);
  }
  base.suspicious = [...suspicious].sort();

  // Recursos embutidos (ManifestResource sem Implementation): no diretorio de recursos do CLR,
  // cada um com 4 bytes de tamanho antes dos dados.
  const resourceData: DotnetResourceData[] = [];
  const resRva = u32(cli + 24) ?? 0;
  const resSize = u32(cli + 28) ?? 0;
  const resAt = resRva ? pe.rvaToOffset(resRva) : -1;
  base.resources = [];
  let budget = RESOURCE_ENTROPY_BUDGET;
  for (let r = 1; r <= count(0x28) && resourceData.length < MAX_RESOURCES; r++) {
    if (cell(0x28, r, 3) !== 0 || resAt < 0) continue;
    const offset = cell(0x28, r, 0) ?? -1;
    const len = offset >= 0 && offset + 4 <= resSize ? u32(resAt + offset) : null;
    if (len === null || offset + 4 + len > resSize) continue;
    const at = resAt + offset + 4;
    if (at + len > buf.length) continue;
    const name = str(cell(0x28, r, 2)) || `recurso-${r}`;
    const span = Math.min(len, budget > 0 ? budget : RESOURCE_ENTROPY_SAMPLE);
    budget -= span;
    const data = buf.subarray(at, at + span);
    resourceData.push({ name, offset: at, size: len });
    base.resources.push({
      name,
      size: len,
      entropy: data.length ? entropy(data, 0, data.length) : 0,
      content: data.length ? (detectType(data)?.id ?? null) : null,
      public: ((cell(0x28, r, 1) ?? 0) & 0x7) === 1,
    });
  }

  const names = new Set<string>();
  for (let r = 1; r <= count(0x01); r++) names.add(str(cell(0x01, r, 1)));
  for (let r = 1; r <= count(0x02); r++) names.add(str(cell(0x02, r, 1)));
  base.obfuscator = OBFUSCATORS.find(([marker]) => names.has(marker))?.[1] ?? null;

  const alerts: PeAlert[] = [];
  const nativeCalls = base.pinvoke.filter((f) => SENSITIVE_PINVOKE.has(f.name)).map((f) => f.name);
  if (nativeCalls.length) {
    alerts.push({
      level: 'medium',
      text: `Chama APIs nativas sensíveis por P/Invoke: ${[...new Set(nativeCalls)].join(', ')}.`,
    });
  }
  if (suspicious.has('Assembly.Load (carrega código da memória)')) {
    alerts.push({
      level: 'medium',
      text: 'Carrega assembly da memória (Assembly.Load): típico de carregador .NET.',
    });
  }
  if (base.obfuscator) {
    alerts.push({ level: 'medium', text: `Ofuscado com ${base.obfuscator}.` });
  } else {
    // Ofuscador sem marca: muitos nomes de tipo e metodo ilegiveis.
    const own: string[] = [];
    for (let r = 1; r <= count(0x02); r++) own.push(str(cell(0x02, r, 1)));
    for (let r = 1; r <= count(0x06); r++) own.push(str(cell(0x06, r, 3)));
    const odd = own.filter((n) => n && !/^[\w.<>`$@-]+$/.test(n)).length;
    if (own.length >= 10 && odd / own.length > 0.3) {
      alerts.push({
        level: 'medium',
        text: 'Nomes de tipos e métodos ilegíveis: provável ofuscação.',
      });
    }
  }
  return { info: base, alerts, resourceData };
}
