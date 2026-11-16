import { localizeText } from './data-language';
import type { Lang } from './error-language';
import { prisma } from './prisma';
import type { SysmonStatus } from './sandbox-artifacts';
import { MAX_ITEMS, summarizeSysmon, sysmonIndicators, type SysmonSummary } from './sysmon';

/**
 * O Sysmon guardado de um ambiente (plans/sandbox-execucoes, fase 2): a situacao da leitura no
 * registro SYSMON e os eventos em SandboxSysmonEvent. Daqui saem o resumo da tela (arvore, rede,
 * DNS, arquivos e registro), os IOCs sugeridos e a linha do tempo. As horas saem no relogio da API
 * (a VM nao sincroniza a hora): o mesmo dos prints e da execucao automatica.
 */

/** Grupos do resumo: processo, rede, arquivo, registro e DNS. */
const GROUPS = [[1], [3], [11], [12, 13, 14], [22]];

/** Hora de um evento (relogio da VM) no relogio da API. */
export const apiTime = (vmTime: Date, offsetMs: number): string =>
  new Date(vmTime.getTime() - offsetMs).toISOString();

/** As listas do resumo, ate MAX_ITEMS de cada tipo, as mais antigas primeiro. */
async function sysmonLists(sessionId: string, offsetMs: number) {
  const groups = await Promise.all(
    GROUPS.map((ids) =>
      prisma.sandboxSysmonEvent.findMany({
        where: { sessionId, eventId: { in: ids } },
        orderBy: { time: 'asc' },
        take: MAX_ITEMS,
        select: { eventId: true, time: true, data: true },
      }),
    ),
  );
  return summarizeSysmon(
    groups.flat().map((r) => ({
      eventId: r.eventId,
      time: apiTime(r.time, offsetMs),
      data: r.data as Record<string, unknown>,
    })),
  );
}

/** Sessao anterior a leitura incremental: o resumo inteiro ficou no registro SYSMON. */
const legacy = (stored: unknown): stored is SysmonSummary =>
  Boolean(stored) && Array.isArray((stored as { processes?: unknown }).processes);

/** O Sysmon de um ambiente como a rota de artefatos o mostra (null sem nenhuma leitura). */
export async function sysmonView(
  sessionId: string,
  stored: unknown,
  lang: Lang,
): Promise<SysmonSummary | null> {
  if (!stored) return null;
  if (legacy(stored)) return stored;
  const status = stored as SysmonStatus;
  if (!status.available) return { available: false, reason: localizeText(status.reason, lang)! };
  return {
    available: true,
    events: status.events,
    truncated: status.truncated,
    ...(await sysmonLists(sessionId, status.offsetMs)),
  };
}

/** Diferenca de relogio guardada de um ambiente (0 sem leitura). */
export async function sysmonOffset(sessionId: string): Promise<number> {
  const row = await prisma.sandboxArtifact.findFirst({
    where: { sessionId, kind: 'SYSMON' },
    select: { sysmon: true },
  });
  const status = row?.sysmon as SysmonStatus | null | undefined;
  return status?.available && 'offsetMs' in status ? status.offsetMs : 0;
}

/** Dominios e IPs que a VM procurou ou contatou, em qualquer ambiente da amostra (IOCs sugeridos). */
export async function entrySysmonIndicators(entryId: string): Promise<string[]> {
  const [statuses, rows] = await Promise.all([
    prisma.sandboxArtifact.findMany({
      where: { kind: 'SYSMON', session: { entryId } },
      select: { sysmon: true },
    }),
    prisma.sandboxSysmonEvent.findMany({
      where: { session: { entryId }, eventId: { in: [3, 22] } },
      select: { eventId: true, data: true },
    }),
  ]);
  const dns: { query: string }[] = [];
  const network: { dstHost: string | null; dstIp: string | null }[] = [];
  for (const { sysmon } of statuses) {
    const old = legacy(sysmon) ? (sysmon as SysmonSummary) : null;
    if (old?.available) {
      dns.push(...old.dns);
      network.push(...old.network);
    }
  }
  for (const { eventId, data } of rows) {
    const d = data as Record<string, string | null>;
    if (eventId === 22 && d.QueryName) dns.push({ query: d.QueryName });
    if (eventId === 3) {
      network.push({ dstHost: d.DestinationHostname ?? null, dstIp: d.DestinationIp ?? null });
    }
  }
  return sysmonIndicators({ dns, network });
}

// ------------------------------------------------------------ linha do tempo (fase 3)

export const TIMELINE_KINDS = ['process', 'network', 'dns', 'file', 'registry'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
const KIND_IDS: Record<TimelineKind, number[]> = {
  process: [1],
  network: [3],
  dns: [22],
  file: [11],
  registry: [12, 13, 14],
};
const kindOf = (eventId: number): TimelineKind =>
  (Object.keys(KIND_IDS) as TimelineKind[]).find((k) => KIND_IDS[k].includes(eventId)) ?? 'process';

/** Eventos por pagina da linha do tempo. */
export const TIMELINE_PAGE = 200;

/**
 * Os processos da amostra: os que tem o nome do arquivo dela na imagem ou na linha de comando (o
 * executavel copiado para %TEMP%\deeplook, o powershell -File de um .ps1) e todos os descendentes,
 * pelo ParentProcessGuid do Sysmon (o PID o Windows reaproveita; o GUID, nao).
 */
export async function sampleTree(sessionId: string, sampleName: string): Promise<Set<string>> {
  const procs = await prisma.sandboxSysmonEvent.findMany({
    where: { sessionId, eventId: 1, processGuid: { not: null } },
    orderBy: { time: 'asc' },
    select: { processGuid: true, parentGuid: true, data: true },
  });
  const needle = sampleName.toLowerCase();
  const tree = new Set<string>();
  for (const p of procs) {
    const d = p.data as Record<string, string | null>;
    const hay = `${d.Image ?? ''}\n${d.CommandLine ?? ''}`.toLowerCase();
    if (needle && hay.includes(needle)) tree.add(p.processGuid!);
  }
  // Ate parar de crescer: um filho guardado antes do pai (a mesma hora) tambem entra.
  for (let grew = tree.size > 0; grew;) {
    grew = false;
    for (const p of procs) {
      if (p.parentGuid && tree.has(p.parentGuid) && !tree.has(p.processGuid!)) {
        tree.add(p.processGuid!);
        grew = true;
      }
    }
  }
  return tree;
}

export interface TimelineEvent {
  /** Hora no relogio da API (ISO). */
  time: string;
  kind: TimelineKind;
  image: string | null;
  pid: number | null;
  /** O processo e da amostra (ou descende dela). */
  sample: boolean;
  /** O que aconteceu, por tipo: a linha de comando, o destino, a consulta, o arquivo, a chave. */
  detail: Record<string, string | number | null>;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() && v !== '-' ? v : null);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

function detailOf(eventId: number, d: Record<string, unknown>): TimelineEvent['detail'] {
  switch (kindOf(eventId)) {
    case 'process':
      return {
        cmd: str(d.CommandLine),
        parentImage: str(d.ParentImage),
        ppid: num(d.ParentProcessId),
        user: str(d.User),
      };
    case 'network':
      return {
        protocol: str(d.Protocol),
        host: str(d.DestinationHostname),
        ip: str(d.DestinationIp),
        port: num(d.DestinationPort),
      };
    case 'dns':
      return { query: str(d.QueryName), results: str(d.QueryResults) };
    case 'file':
      return { path: str(d.TargetFilename) };
    case 'registry':
      return {
        action: str(d.EventType),
        key: str(d.TargetObject),
        details: str(d.Details) ?? str(d.NewName),
      };
  }
}

/**
 * Uma pagina da linha do tempo: os eventos em ordem de tempo, so os da amostra (`sample`) ou todos,
 * dos tipos pedidos. A hora sai no relogio da API.
 */
export async function sysmonTimeline(
  sessionId: string,
  {
    tree,
    sampleOnly,
    kinds,
    page,
  }: { tree: Set<string>; sampleOnly: boolean; kinds: TimelineKind[]; page: number },
): Promise<{ total: number; events: TimelineEvent[]; next: string | null }> {
  const offsetMs = await sysmonOffset(sessionId);
  const where = {
    sessionId,
    eventId: { in: kinds.flatMap((k) => KIND_IDS[k]) },
    ...(sampleOnly && { processGuid: { in: [...tree] } }),
  };
  const [total, rows] = await Promise.all([
    prisma.sandboxSysmonEvent.count({ where }),
    prisma.sandboxSysmonEvent.findMany({
      where,
      orderBy: [{ time: 'asc' }, { recordId: 'asc' }],
      skip: (page - 1) * TIMELINE_PAGE,
      // Um a mais: o horario em que a proxima pagina comeca (as marcas do intervalo entre as duas
      // ficam nesta, e nao somem).
      take: TIMELINE_PAGE + 1,
      select: { eventId: true, time: true, image: true, processGuid: true, data: true },
    }),
  ]);
  const following = rows.length > TIMELINE_PAGE ? rows.pop() : undefined;
  return {
    total,
    next: following ? apiTime(following.time, offsetMs) : null,
    events: rows.map((r) => {
      const d = r.data as Record<string, unknown>;
      return {
        time: apiTime(r.time, offsetMs),
        kind: kindOf(r.eventId),
        image: r.image,
        pid: num(d.ProcessId),
        sample: Boolean(r.processGuid && tree.has(r.processGuid)),
        detail: detailOf(r.eventId, d),
      };
    }),
  };
}

/** Quando o primeiro processo da amostra apareceu no Sysmon (relogio da API), ou null. */
export async function sampleStart(sessionId: string, tree: Set<string>): Promise<string | null> {
  if (!tree.size) return null;
  const first = await prisma.sandboxSysmonEvent.findFirst({
    where: { sessionId, eventId: 1, processGuid: { in: [...tree] } },
    orderBy: { time: 'asc' },
    select: { time: true },
  });
  return first ? apiTime(first.time, await sysmonOffset(sessionId)) : null;
}

// ------------------------------------------------------- resumo e exportacao (ajustes, item 6)

/** O evento numa linha de texto (exportacao): a linha de comando, o destino, a consulta... */
export function describeEvent(e: TimelineEvent): string {
  const d = e.detail;
  switch (e.kind) {
    case 'process':
      return String(d.cmd ?? e.image ?? '');
    case 'network':
      return `${d.protocol ?? ''} ${d.host ?? d.ip ?? '?'}${d.port !== null ? `:${d.port}` : ''}`.trim();
    case 'dns':
      return d.results
        ? `${d.query} -> ${String(d.results).replace(/;$/, '')}`
        : String(d.query ?? '');
    case 'file':
      return String(d.path ?? '');
    case 'registry':
      return `${d.action ?? ''} ${d.key ?? ''}${d.details ? ` = ${d.details}` : ''}`.trim();
  }
}

/** Todos os eventos da linha do tempo com os filtros (exportacao), ate o teto do ambiente. */
export async function sysmonTimelineAll(
  sessionId: string,
  opts: { tree: Set<string>; sampleOnly: boolean; kinds: TimelineKind[] },
): Promise<TimelineEvent[]> {
  const all: TimelineEvent[] = [];
  for (let page = 1; ; page++) {
    const { events } = await sysmonTimeline(sessionId, { ...opts, page });
    all.push(...events);
    if (events.length < TIMELINE_PAGE) return all;
  }
}

/** Itens de cada lista do resumo da execucao. */
const SUMMARY_ITEMS = 100;

export interface RunSummaryLists {
  processes: {
    time: string;
    image: string | null;
    pid: number | null;
    ppid: number | null;
    cmd: string | null;
  }[];
  dns: { query: string; results: string | null }[];
  network: { destination: string; protocol: string | null }[];
  files: string[];
  registry: { key: string; action: string | null; details: string | null }[];
}

/**
 * O que a amostra fez numa execucao (ficha impressa, Markdown): os processos da arvore dela e, sem
 * repetir, as consultas DNS, os destinos, os arquivos e as chaves desses processos.
 */
export async function sampleRunLists(
  sessionId: string,
  tree: Set<string>,
): Promise<RunSummaryLists> {
  const lists: RunSummaryLists = { processes: [], dns: [], network: [], files: [], registry: [] };
  if (!tree.size) return lists;
  const events = await sysmonTimelineAll(sessionId, {
    tree,
    sampleOnly: true,
    kinds: [...TIMELINE_KINDS],
  });
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  for (const e of events) {
    const d = e.detail;
    if (e.kind === 'process' && lists.processes.length < SUMMARY_ITEMS) {
      lists.processes.push({
        time: e.time,
        image: e.image,
        pid: e.pid,
        ppid: typeof d.ppid === 'number' ? d.ppid : null,
        cmd: (d.cmd as string | null) ?? null,
      });
    } else if (e.kind === 'dns' && d.query && lists.dns.length < SUMMARY_ITEMS) {
      if (once(`dns:${d.query}`)) {
        lists.dns.push({ query: String(d.query), results: (d.results as string | null) ?? null });
      }
    } else if (e.kind === 'network' && lists.network.length < SUMMARY_ITEMS) {
      const destination = `${d.host ?? d.ip ?? '?'}${d.port !== null ? `:${d.port}` : ''}`;
      if (once(`net:${destination}`)) {
        lists.network.push({ destination, protocol: (d.protocol as string | null) ?? null });
      }
    } else if (e.kind === 'file' && d.path && lists.files.length < SUMMARY_ITEMS) {
      if (once(`file:${d.path}`)) lists.files.push(String(d.path));
    } else if (e.kind === 'registry' && d.key && lists.registry.length < SUMMARY_ITEMS) {
      if (once(`reg:${d.key}`)) {
        lists.registry.push({
          key: String(d.key),
          action: (d.action as string | null) ?? null,
          details: (d.details as string | null) ?? null,
        });
      }
    }
  }
  return lists;
}
