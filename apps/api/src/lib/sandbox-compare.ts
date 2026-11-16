import { prisma } from './prisma';
import { sampleFileName } from './sandbox';
import { sampleTree, sysmonTimelineAll, TIMELINE_KINDS, type TimelineEvent } from './sysmon-store';

/**
 * Diff entre duas execucoes da mesma amostra no sandbox (plans/novas-analises, item 8): o que so
 * uma fez, o que as duas fizeram, por categoria. Cada item e normalizado antes de comparar, para a
 * diferenca nao vir de PIDs, GUIDs, nomes temporarios aleatorios ou do perfil do usuario.
 */

export const COMPARE_CATEGORIES = [
  'process',
  'dns',
  'network',
  'file',
  'registry',
  'sigma',
  'ids',
] as const;
export type CompareCategory = (typeof COMPARE_CATEGORIES)[number];

/** Itens por lista na resposta (a contagem vem inteira). */
const MAX_LISTED = 300;

/** Caminho do Windows sem o que muda de uma execucao para outra. */
export function normalizePath(path: string): string {
  return (
    path
      .toLowerCase()
      .replace(/\\\\\?\\/g, '')
      .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\local\\temp\\/, '%temp%\\')
      .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\roaming\\/, '%appdata%\\')
      .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\local\\/, '%localappdata%\\')
      .replace(/^[a-z]:\\users\\[^\\]+\\/, '%userprofile%\\')
      .replace(/^[a-z]:\\windows\\temp\\/, '%windir%\\temp\\')
      .replace(/\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/g, '<guid>')
      .replace(/s-1-5-21(?:-\d+){3,4}/g, '<sid>')
      .replace(/\b[0-9a-f]{8,}\b/g, '<hex>')
      // Nomes temporarios: tmp1A2B.tmp, ~DF3C.tmp, 3f2a.tmp.
      .replace(/\b(tmp|~df|~wr)[0-9a-f]{1,8}(?=\.)/g, '$1<x>')
      .replace(/\b[0-9a-f]{3,6}\.tmp\b/g, '<x>.tmp')
      .replace(/\d{5,}/g, '<n>')
  );
}

/** Linha de comando sem PIDs, GUIDs, caminhos temporarios e numeros longos. */
export function normalizeCommand(cmd: string): string {
  return normalizePath(cmd.trim().replace(/\s+/g, ' '))
    .replace(/[a-z]:\\users\\[^\\"' ]+\\appdata\\local\\temp\\/g, '%temp%\\')
    .replace(/[a-z]:\\users\\[^\\"' ]+\\/g, '%userprofile%\\')
    .replace(/\b\d{3,}\b/g, '<n>');
}

/** Chave do registro sem o SID do usuario (HKU\S-1-5-21-...\ e HKCU sao a mesma coisa). */
export function normalizeRegistry(key: string): string {
  return normalizePath(key)
    .replace(/^hku\\<sid>(_classes)?\\/, (_m, classes: string | undefined) =>
      classes ? 'hkcu\\software\\classes\\' : 'hkcu\\',
    )
    .replace(/^hkey_current_user\\/, 'hkcu\\')
    .replace(/^hkey_local_machine\\/, 'hklm\\');
}

const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

/** A chave de comparacao e um exemplo legivel de um evento. */
function itemOf(
  e: TimelineEvent,
): { category: CompareCategory; key: string; example: string } | null {
  const d = e.detail;
  switch (e.kind) {
    case 'process': {
      const image = base(e.image).toLowerCase();
      const cmd = typeof d.cmd === 'string' ? d.cmd : '';
      return {
        category: 'process',
        key: `${image} ${normalizeCommand(cmd)}`,
        example: cmd || (e.image ?? ''),
      };
    }
    case 'dns':
      return d.query
        ? { category: 'dns', key: String(d.query).toLowerCase(), example: String(d.query) }
        : null;
    case 'network': {
      const where = String(d.host ?? d.ip ?? '');
      if (!where) return null;
      const dest = `${where.toLowerCase()}${d.port !== null ? `:${d.port}` : ''}`;
      return { category: 'network', key: `${d.protocol ?? ''} ${dest}`.trim(), example: dest };
    }
    case 'file':
      return d.path
        ? { category: 'file', key: normalizePath(String(d.path)), example: String(d.path) }
        : null;
    case 'registry':
      return d.key
        ? {
            category: 'registry',
            key: `${String(d.action ?? '').toLowerCase()} ${normalizeRegistry(String(d.key))}`.trim(),
            example: `${d.key}${d.details ? ` = ${d.details}` : ''}`,
          }
        : null;
  }
}

type Bag = Map<CompareCategory, Map<string, { example: string; count: number }>>;

/** Tudo o que uma execucao fez, por categoria e chave normalizada. */
async function bagOf(sessionId: string, sampleName: string, sampleOnly: boolean) {
  const tree = await sampleTree(sessionId, sampleName);
  const only = sampleOnly && tree.size > 0;
  const bag: Bag = new Map(COMPARE_CATEGORIES.map((c) => [c, new Map()]));
  const put = (category: CompareCategory, key: string, example: string) => {
    const map = bag.get(category)!;
    const found = map.get(key);
    if (found) found.count += 1;
    else map.set(key, { example, count: 1 });
  };
  const events = await sysmonTimelineAll(sessionId, {
    tree,
    sampleOnly: only,
    kinds: [...TIMELINE_KINDS],
  });
  for (const e of events) {
    const item = itemOf(e);
    if (item) put(item.category, item.key, item.example);
  }
  const hits = await prisma.sandboxSigmaHit.findMany({
    where: { sessionId },
    select: { title: true, level: true, processGuid: true },
  });
  for (const h of hits) {
    if (only && !tree.has(h.processGuid)) continue;
    put('sigma', h.title.toLowerCase(), `${h.title} (${h.level})`);
  }
  const capture = await prisma.networkCapture.findUnique({
    where: { sessionId },
    select: { idsResult: true },
  });
  const alerts =
    (capture?.idsResult as { alerts?: { signature: string }[] } | null | undefined)?.alerts ?? [];
  for (const a of alerts) put('ids', a.signature.toLowerCase(), a.signature);
  return { bag, sampleFound: tree.size > 0 };
}

export interface CompareList {
  onlyA: { key: string; example: string; count: number }[];
  onlyB: { key: string; example: string; count: number }[];
  both: { key: string; exampleA: string; exampleB: string }[];
  counts: { onlyA: number; onlyB: number; both: number };
}

/** O diff das duas execucoes, por categoria. */
export async function compareSessions(
  a: string,
  b: string,
  sampleOnly: boolean,
): Promise<{
  sample: { name: string; foundA: boolean; foundB: boolean };
  categories: Record<CompareCategory, CompareList>;
}> {
  const session = await prisma.sandboxSession.findUnique({
    where: { id: a },
    select: { entry: { select: { originalFilename: true } } },
  });
  const name = sampleFileName({ originalFilename: session?.entry.originalFilename ?? null });
  const [left, right] = await Promise.all([bagOf(a, name, sampleOnly), bagOf(b, name, sampleOnly)]);
  const sorted = <T extends { key: string }>(list: T[]) =>
    list.sort((x, y) => x.key.localeCompare(y.key)).slice(0, MAX_LISTED);
  const categories = Object.fromEntries(
    COMPARE_CATEGORIES.map((c) => {
      const la = left.bag.get(c)!;
      const lb = right.bag.get(c)!;
      const onlyA = [...la].filter(([k]) => !lb.has(k)).map(([key, v]) => ({ key, ...v }));
      const onlyB = [...lb].filter(([k]) => !la.has(k)).map(([key, v]) => ({ key, ...v }));
      const both = [...la]
        .filter(([k]) => lb.has(k))
        .map(([key, v]) => ({ key, exampleA: v.example, exampleB: lb.get(key)!.example }));
      return [
        c,
        {
          onlyA: sorted(onlyA),
          onlyB: sorted(onlyB),
          both: sorted(both),
          counts: { onlyA: onlyA.length, onlyB: onlyB.length, both: both.length },
        },
      ];
    }),
  ) as Record<CompareCategory, CompareList>;
  return { sample: { name, foundA: left.sampleFound, foundB: right.sampleFound }, categories };
}
