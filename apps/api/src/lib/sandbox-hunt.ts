import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { prisma, type Tx } from './prisma';
import { sampleFileName } from './sandbox';
import { apiTime, sampleTree, sysmonOffset, TIMELINE_KINDS } from './sysmon-store';

/**
 * Busca nos eventos do Sysmon de todas as execucoes (plans/caca-e-formatos, item 2): quem rodou um
 * comando, gravou um caminho, consultou um dominio ou carregou uma DLL, em qualquer execucao
 * guardada. O resultado vem agrupado por execucao (a mais recente primeiro); os eventos de uma
 * execucao vem paginados. "Da amostra" e a arvore de processos de cada execucao (sampleTree).
 */

/** Campo -> chaves do EventData onde procurar. "any" procura em todas. */
export const HUNT_FIELDS = {
  any: [],
  process: ['Image', 'OriginalFileName', 'ParentImage'],
  commandline: ['CommandLine', 'ParentCommandLine'],
  file: ['TargetFilename'],
  registry: ['TargetObject', 'Details'],
  network: ['DestinationIp', 'DestinationHostname'],
  dns: ['QueryName', 'QueryResults'],
  hash: ['Hashes'],
  imageload: ['ImageLoaded'],
  pipe: ['PipeName'],
} as const satisfies Record<string, readonly string[]>;
export type HuntField = keyof typeof HUNT_FIELDS;

/** Grupos de evento (os da linha do tempo, mais carga de DLL e pipes). */
const KIND_IDS: Record<string, number[]> = {
  process: [1],
  network: [3],
  dns: [22],
  file: [11, 23, 26],
  registry: [12, 13, 14],
  imageload: [7],
  pipe: [17, 18],
};
export const HUNT_KINDS = ['all', ...TIMELINE_KINDS, 'imageload', 'pipe'] as const;

export const HuntQuery = z.object({
  field: z.enum(Object.keys(HUNT_FIELDS) as [HuntField, ...HuntField[]]).default('any'),
  op: z.enum(['contains', 'equals', 'starts', 'ends', 'regex']).default('contains'),
  value: z.string().trim().min(2).max(300),
  kind: z.enum(HUNT_KINDS).default('all'),
  scope: z.enum(['sample', 'all']).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type HuntQuery = z.infer<typeof HuntQuery>;

/** Execucoes candidatas por busca (as mais recentes com algum evento que casa). */
export const HUNT_MAX_RUNS = 300;
/** Execucoes por pagina do resultado. */
export const HUNT_PAGE = 25;
/** Eventos por pagina de uma execucao. */
export const HUNT_EVENTS_PAGE = 50;
/** Eventos no CSV. */
export const HUNT_EXPORT_MAX = 10_000;
/** Teto de tempo de cada consulta (regex ou texto livre em muitas execucoes). */
const TIMEOUT_MS = 15_000;
/** Regex no texto livre: o tamanho maximo. */
const REGEX_MAX = 200;

export class HuntError extends Error {}

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A condicao sobre um valor de texto (uma chave do EventData). */
function valueCond(x: Prisma.Sql, q: HuntQuery): Prisma.Sql {
  const v = likeEscape(q.value);
  switch (q.op) {
    case 'contains':
      return Prisma.sql`${x} ILIKE ${`%${v}%`} ESCAPE '\\'`;
    case 'starts':
      return Prisma.sql`${x} ILIKE ${`${v}%`} ESCAPE '\\'`;
    case 'ends':
      return Prisma.sql`${x} ILIKE ${`%${v}`} ESCAPE '\\'`;
    case 'equals':
      return Prisma.sql`lower(${x}) = lower(${q.value})`;
    case 'regex':
      return Prisma.sql`${x} ~* ${q.value}`;
  }
}

/** A condicao do campo pedido, sobre o evento `e`. */
function fieldCond(q: HuntQuery): Prisma.Sql {
  const keys = HUNT_FIELDS[q.field] as readonly string[];
  // Qualquer campo: cada valor do EventData.
  const exact = keys.length
    ? Prisma.sql`(${Prisma.join(
        keys.map((k) => valueCond(Prisma.sql`e."data"->>${k}`, q)),
        ' OR ',
      )})`
    : Prisma.sql`EXISTS (SELECT 1 FROM jsonb_each_text(e."data") kv WHERE ${valueCond(
        Prisma.sql`kv.value`,
        q,
      )})`;
  if (q.op === 'regex') return exact;
  // Antes, o texto do JSON inteiro (o indice de trigramas atende), com o valor escapado como o JSON
  // escapa (a barra invertida vira duas): 500 mil eventos, 4 ms em vez de 0,25 a 2,6 s.
  const json = likeEscape(JSON.stringify(q.value).slice(1, -1));
  return Prisma.sql`(e."data"::text ILIKE ${`%${json}%`} ESCAPE '\\' AND ${exact})`;
}

/** Tudo o que nao depende da execucao: campo, tipo de evento e periodo. */
function baseCond(q: HuntQuery): Prisma.Sql {
  const parts = [fieldCond(q)];
  const ids = KIND_IDS[q.kind];
  if (ids) parts.push(Prisma.sql`e."eventId" IN (${Prisma.join(ids)})`);
  if (q.from) parts.push(Prisma.sql`s."createdAt" >= ${q.from}`);
  if (q.to) parts.push(Prisma.sql`s."createdAt" < ${q.to}`);
  return Prisma.join(parts, ' AND ');
}

/** Roda as consultas com o teto de tempo e traduz o erro do Postgres. */
async function guarded<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
        return fn(tx);
      },
      { timeout: TIMEOUT_MS + 5000 },
    );
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/2201B|invalid regular expression/i.test(text)) {
      const why = /invalid regular expression: ([^"\n]+)/i.exec(text)?.[1] ?? '';
      throw new HuntError(`Expressão regular inválida: ${why.trim()}`.trim());
    }
    if (/57014|statement timeout|canceling statement/i.test(text)) {
      throw new HuntError(
        'A busca demorou demais. Restrinja o campo, o tipo de evento ou o período.',
      );
    }
    throw err;
  }
}

export function checkHunt(q: HuntQuery): void {
  if (q.op === 'regex' && q.value.length > REGEX_MAX) {
    throw new HuntError(`Expressão regular com mais de ${REGEX_MAX} caracteres.`);
  }
}

type Candidate = {
  sessionId: string;
  n: number;
  createdAt: Date;
  startedAt: Date | null;
  entryId: string;
  title: string;
  originalFilename: string | null;
};

/** As execucoes com algum evento que casa, as mais recentes primeiro (ate HUNT_MAX_RUNS). */
function candidates(tx: Tx, q: HuntQuery): Promise<Candidate[]> {
  return tx.$queryRaw<Candidate[]>`
    SELECT e."sessionId", count(*)::int AS n, s."createdAt", s."startedAt",
           en."id" AS "entryId", en."title", en."originalFilename"
    FROM "SandboxSysmonEvent" e
    JOIN "SandboxSession" s ON s."id" = e."sessionId"
    JOIN "Entry" en ON en."id" = s."entryId"
    WHERE ${baseCond(q)}
    GROUP BY e."sessionId", s."createdAt", s."startedAt", en."id", en."title", en."originalFilename"
    ORDER BY s."createdAt" DESC
    LIMIT ${HUNT_MAX_RUNS}`;
}

const treeOf = (c: Pick<Candidate, 'sessionId' | 'originalFilename'>) =>
  sampleTree(c.sessionId, sampleFileName({ originalFilename: c.originalFilename }));

type EventRow = {
  id: string;
  eventId: number;
  time: Date;
  image: string | null;
  processGuid: string | null;
  data: Record<string, string | null>;
};

/** Os eventos que casam numa execucao (com a arvore da amostra, quando o escopo pede). */
function sessionCond(q: HuntQuery, sessionId: string, tree: Set<string> | null): Prisma.Sql {
  const parts = [Prisma.sql`e."sessionId" = ${sessionId}`, baseCond(q)];
  if (tree) {
    parts.push(
      tree.size ? Prisma.sql`e."processGuid" IN (${Prisma.join([...tree])})` : Prisma.sql`FALSE`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

const SUMMARY_KEYS = [
  'CommandLine',
  'TargetFilename',
  'TargetObject',
  'QueryName',
  'DestinationHostname',
  'DestinationIp',
  'ImageLoaded',
  'PipeName',
];
/** O que aconteceu, numa linha (a lista mostra; o evento inteiro vem junto). */
export const summaryOf = (d: Record<string, string | null>) => {
  for (const k of SUMMARY_KEYS) {
    const v = d[k];
    if (v && v !== '-')
      return k === 'DestinationIp' && d.DestinationPort ? `${v}:${d.DestinationPort}` : v;
  }
  return null;
};

function eventView(row: EventRow, offsetMs: number, tree: Set<string>) {
  const pid = Number(row.data.ProcessId ?? row.data.SourceProcessId);
  return {
    time: apiTime(row.time, offsetMs),
    eventId: row.eventId,
    image: row.image,
    pid: Number.isInteger(pid) ? pid : null,
    sample: Boolean(row.processGuid && tree.has(row.processGuid)),
    summary: summaryOf(row.data),
    data: row.data,
  };
}

export interface HuntRun {
  sessionId: string;
  entryId: string;
  entryTitle: string;
  startedAt: string;
  matched: number;
  first: ReturnType<typeof eventView>[];
}

/**
 * Uma pagina de execucoes. No escopo da amostra, a arvore de cada candidata e montada na ordem e
 * as sem nenhum evento da amostra saem antes de cortar a pagina; o total nao e conhecido de
 * antemao, entao a resposta diz so se ha mais (nextOffset).
 */
export async function huntRuns(q: HuntQuery): Promise<{
  runs: HuntRun[];
  total: number | null;
  nextOffset: number | null;
  capped: boolean;
}> {
  checkHunt(q);
  return guarded(async (tx) => {
    const found = await candidates(tx, q);
    const runs: HuntRun[] = [];
    let i = q.offset;
    for (; i < found.length && runs.length < HUNT_PAGE; i++) {
      const c = found[i];
      const tree = await treeOf(c);
      const cond = sessionCond(q, c.sessionId, q.scope === 'sample' ? tree : null);
      let matched = c.n;
      if (q.scope === 'sample') {
        const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "SandboxSysmonEvent" e
          JOIN "SandboxSession" s ON s."id" = e."sessionId" WHERE ${cond}`;
        if (!n) continue;
        matched = n;
      }
      const [first, offsetMs] = await Promise.all([
        tx.$queryRaw<EventRow[]>`
          SELECT e."id", e."eventId", e."time", e."image", e."processGuid", e."data"
          FROM "SandboxSysmonEvent" e JOIN "SandboxSession" s ON s."id" = e."sessionId"
          WHERE ${cond} ORDER BY e."time", e."recordId" LIMIT 3`,
        sysmonOffset(c.sessionId),
      ]);
      runs.push({
        sessionId: c.sessionId,
        entryId: c.entryId,
        entryTitle: c.title,
        startedAt: (c.startedAt ?? c.createdAt).toISOString(),
        matched,
        first: first.map((r) => eventView(r, offsetMs, tree)),
      });
    }
    return {
      runs,
      total: q.scope === 'all' ? found.length : null,
      nextOffset: i < found.length ? i : null,
      capped: found.length >= HUNT_MAX_RUNS,
    };
  });
}

/** Os eventos que casam numa execucao, paginados. */
export async function huntEvents(
  sessionId: string,
  q: HuntQuery,
  page: number,
): Promise<{
  total: number;
  page: number;
  pageSize: number;
  events: ReturnType<typeof eventView>[];
}> {
  checkHunt(q);
  const session = await prisma.sandboxSession.findUnique({
    where: { id: sessionId },
    select: { id: true, entry: { select: { originalFilename: true } } },
  });
  if (!session) throw new HuntError('Execução não encontrada.');
  // (A rota ja confere; aqui so para quem chamar direto.)
  const tree = await treeOf({ sessionId, originalFilename: session.entry.originalFilename });
  const offsetMs = await sysmonOffset(sessionId);
  return guarded(async (tx) => {
    const cond = sessionCond(q, sessionId, q.scope === 'sample' ? tree : null);
    const [[{ n }], rows] = await Promise.all([
      tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "SandboxSysmonEvent" e
        JOIN "SandboxSession" s ON s."id" = e."sessionId" WHERE ${cond}`,
      tx.$queryRaw<EventRow[]>`
        SELECT e."id", e."eventId", e."time", e."image", e."processGuid", e."data"
        FROM "SandboxSysmonEvent" e JOIN "SandboxSession" s ON s."id" = e."sessionId"
        WHERE ${cond} ORDER BY e."time", e."recordId"
        LIMIT ${HUNT_EVENTS_PAGE} OFFSET ${(page - 1) * HUNT_EVENTS_PAGE}`,
    ]);
    return {
      total: n,
      page,
      pageSize: HUNT_EVENTS_PAGE,
      events: rows.map((r) => eventView(r, offsetMs, tree)),
    };
  });
}

/** Todos os eventos que casam, execucao por execucao, ate HUNT_EXPORT_MAX (o CSV). */
export async function huntExport(q: HuntQuery): Promise<{
  rows: (HuntRun & { event: ReturnType<typeof eventView> })[];
  truncated: boolean;
}> {
  checkHunt(q);
  return guarded(async (tx) => {
    const found = await candidates(tx, q);
    const rows: (HuntRun & { event: ReturnType<typeof eventView> })[] = [];
    for (const c of found) {
      if (rows.length >= HUNT_EXPORT_MAX) return { rows, truncated: true };
      const tree = await treeOf(c);
      const cond = sessionCond(q, c.sessionId, q.scope === 'sample' ? tree : null);
      const [events, offsetMs] = await Promise.all([
        tx.$queryRaw<EventRow[]>`
          SELECT e."id", e."eventId", e."time", e."image", e."processGuid", e."data"
          FROM "SandboxSysmonEvent" e JOIN "SandboxSession" s ON s."id" = e."sessionId"
          WHERE ${cond} ORDER BY e."time", e."recordId"
          LIMIT ${HUNT_EXPORT_MAX - rows.length + 1}`,
        sysmonOffset(c.sessionId),
      ]);
      const run = {
        sessionId: c.sessionId,
        entryId: c.entryId,
        entryTitle: c.title,
        startedAt: (c.startedAt ?? c.createdAt).toISOString(),
        matched: events.length,
        first: [],
      };
      for (const e of events) {
        if (rows.length >= HUNT_EXPORT_MAX) return { rows, truncated: true };
        rows.push({ ...run, event: eventView(e, offsetMs, tree) });
      }
    }
    return { rows, truncated: found.length >= HUNT_MAX_RUNS };
  });
}
