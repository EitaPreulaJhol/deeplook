/**
 * Sysmon no template (plano pos-revisao, item 5.3): o que o Sysmon registrou na VM, lido pelo agente
 * do guest (qemu-guest-agent, agent/exec) a cada coleta dos artefatos. Vira a arvore de processos,
 * as conexoes, os arquivos criados, o registro alterado, as consultas DNS e a linha do tempo.
 *
 * Leitura incremental (plans/sandbox-execucoes, fase 2): cada coleta le so os eventos a partir do
 * ultimo guardado (SandboxSysmonEvent), ate SYSMON_READ_MAX por leitura. Antes, cada leitura trazia
 * tudo desde o inicio ate 2000 eventos, e o ruido do Windows empurrava o comportamento tardio da
 * amostra para fora.
 *
 * O Sysmon e instalado no template por quem o prepara (docs/proxmox.pt-BR.md). Sem ele, ou num
 * guest Linux, ficam os prints e a lista de processos de sempre, com o motivo na tela. Como a lista
 * de processos, e o que o proprio guest diz: um malware com privilegio pode apagar o log.
 */

/** Eventos lidos: processo (1), rede (3), arquivo (11), registro (12, 13, 14), DNS (22). */
export const EVENT_IDS = [1, 3, 11, 12, 13, 14, 22];
/** Eventos por leitura (os mais antigos primeiro; o resto vem na seguinte). */
export const SYSMON_READ_MAX = 2000;
/** Eventos guardados por ambiente. */
export const SYSMON_SESSION_MAX = 20_000;
/** Itens por lista do resumo (arvore, rede, DNS, arquivos, registro). */
export const MAX_ITEMS = 500;
const MAX_TEXT = 1000;

/** Marca na saida: o canal do Sysmon nao existe (nao instalado). */
const MISSING = 'DEEPLOOK_SEM_SYSMON';
/**
 * Folga da primeira leitura, alem do tempo desde o inicio da sessao. O log ja comeca limpo a cada
 * boot (scripts/template-windows/sysmon.bat): a folga so cobre a diferenca entre o inicio gravado
 * pela API e o boot da VM.
 */
const WINDOW_MARGIN_S = 300;

/** Segundos que a primeira leitura cobre: desde o inicio da sessao, com a folga. */
export function sysmonWindowS(since: Date, now = Date.now()): number {
  return Math.max(0, Math.ceil((now - since.getTime()) / 1000)) + WINDOW_MARGIN_S;
}

/** De onde a leitura parte: os ultimos N segundos (a primeira) ou o ultimo evento guardado. */
export type SysmonFrom = { windowS: number } | { after: Date };

/** O filtro XPath do log: os tipos lidos e a janela, contada no relogio da propria VM. */
export function sysmonXPath(from: SysmonFrom): string {
  const ids = EVENT_IDS.map((id) => `EventID=${id}`).join(' or ');
  const time =
    'windowS' in from
      ? `TimeCreated[timediff(@SystemTime) <= ${Math.round(from.windowS * 1000)}]`
      : `TimeCreated[@SystemTime>="${from.after.toISOString()}"]`;
  return `*[System[(${ids}) and ${time}]]`;
}

/**
 * O comando do agente: um PowerShell em Base64 (UTF-16LE, como o -EncodedCommand pede). Le os
 * eventos do mais antigo para o mais novo (no teto, o resto vem na proxima leitura) e devolve JSON
 * compacto com a hora da VM (`now`), para a API saber a diferenca entre os relogios.
 *
 * A janela e sempre no relogio da propria VM (timediff ou a hora do ultimo evento dela), nunca pela
 * hora da API: a VM isolada nao sincroniza a hora.
 */
export function sysmonCommand(from: SysmonFrom): string[] {
  const script = [
    // Caminhos com acento: a saida do agente em UTF-8, nao na pagina de codigo do console.
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$log = 'Microsoft-Windows-Sysmon/Operational'",
    `if (-not (Get-WinEvent -ListLog $log -ErrorAction SilentlyContinue)) { '${MISSING}'; exit 0 }`,
    `$xpath = '${sysmonXPath(from)}'`,
    `$events = Get-WinEvent -LogName $log -FilterXPath $xpath -MaxEvents ${SYSMON_READ_MAX} -Oldest -ErrorAction SilentlyContinue`,
    // foreach sobre $null nao itera (sem eventos: lista vazia).
    '$list = @(foreach ($e in $events) {',
    '  $d = @{}',
    '  foreach ($n in ([xml]$e.ToXml()).Event.EventData.Data) { $d[$n.Name] = $n.InnerText }',
    "  [pscustomobject]@{ id = $e.Id; rec = $e.RecordId; time = $e.TimeCreated.ToUniversalTime().ToString('o'); data = $d }",
    '})',
    "$now = (Get-Date).ToUniversalTime().ToString('o')",
    'ConvertTo-Json -InputObject ([pscustomobject]@{ now = $now; events = $list }) -Compress -Depth 4',
  ].join('\n');
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

/** Um evento como o comando o devolve. */
export interface SysmonEvent {
  /** EventID (1, 3, 11, 12-14, 22). */
  id: number;
  /** EventRecordID. */
  rec: number;
  /** Hora do evento no relogio da VM (ISO, UTC). */
  time: string;
  data: Record<string, string | null>;
}

export type SysmonRead =
  | {
      available: true;
      /** Hora da VM no fim da leitura (null se nao veio). */
      now: string | null;
      events: SysmonEvent[];
    }
  | { available: false; reason: string };

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim() || value === '-') return null;
  return value.replaceAll('\u0000', '').slice(0, MAX_TEXT);
};
const int = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** A saida do comando. Texto que nao e JSON vira "indisponivel", com o motivo. */
export function parseSysmonRead(output: string): SysmonRead {
  // BOM e ruido antes do JSON (um aviso do PowerShell no stdout) nao derrubam a leitura.
  const trimmed = output.replace(/^\uFEFF/, '').trim();
  if (trimmed.endsWith(MISSING)) {
    return {
      available: false,
      reason:
        'Sysmon não instalado no template (canal Microsoft-Windows-Sysmon/Operational ausente)',
    };
  }
  const start = trimmed.search(/^[[{]/m);
  let raw: unknown;
  try {
    raw = JSON.parse(start > 0 ? trimmed.slice(start) : trimmed);
  } catch {
    return { available: false, reason: 'resposta do Sysmon em formato inesperado' };
  }
  const body = (raw && typeof raw === 'object' ? raw : {}) as { now?: unknown; events?: unknown };
  // O ConvertTo-Json do PowerShell 5.1 pode devolver um objeto so no lugar da lista de um.
  const list = Array.isArray(body.events) ? body.events : body.events ? [body.events] : [];
  const events: SysmonEvent[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const id = Number(item?.id);
    const rec = Number(item?.rec);
    const time = typeof item?.time === 'string' ? item.time : '';
    if (!Number.isInteger(id) || !Number.isSafeInteger(rec) || Number.isNaN(Date.parse(time))) {
      continue;
    }
    const data: Record<string, string | null> = {};
    for (const [k, v] of Object.entries((item.data ?? {}) as Record<string, unknown>)) {
      data[k.slice(0, 100)] = text(v);
    }
    events.push({ id, rec, time, data });
  }
  const now = typeof body.now === 'string' && !Number.isNaN(Date.parse(body.now)) ? body.now : null;
  return { available: true, now, events };
}

/** Um evento como fica guardado (SandboxSysmonEvent), sem a sessao. */
export interface SysmonRow {
  recordId: bigint;
  eventId: number;
  time: Date;
  image: string | null;
  processGuid: string | null;
  parentGuid: string | null;
  data: Record<string, string | null>;
}

export function sysmonRow(e: SysmonEvent): SysmonRow {
  return {
    recordId: BigInt(e.rec),
    eventId: e.id,
    time: new Date(e.time),
    image: e.data.Image ?? null,
    processGuid: e.data.ProcessGuid ?? null,
    parentGuid: e.data.ParentProcessGuid ?? null,
    data: e.data,
  };
}

export interface SysmonProcess {
  time: string;
  pid: number | null;
  ppid: number | null;
  image: string;
  cmd: string | null;
  parentImage: string | null;
  user: string | null;
  hashes: string | null;
}
export interface SysmonConnection {
  time: string;
  image: string;
  protocol: string | null;
  dstIp: string | null;
  dstPort: number | null;
  dstHost: string | null;
}
export interface SysmonFile {
  time: string;
  image: string;
  path: string;
}
export interface SysmonRegistry {
  time: string;
  image: string;
  action: string | null;
  key: string;
  details: string | null;
}
export interface SysmonDns {
  time: string;
  image: string;
  query: string;
  results: string | null;
}

export interface SysmonLists {
  processes: SysmonProcess[];
  network: SysmonConnection[];
  files: SysmonFile[];
  registry: SysmonRegistry[];
  dns: SysmonDns[];
}

export type SysmonSummary =
  | ({
      available: true;
      events: number;
      /** Bateu no teto de eventos: o resto ficou de fora. */
      truncated: boolean;
    } & SysmonLists)
  | { available: false; reason: string };

/** Um evento para o resumo: o tipo, a hora (ja no relogio da API, ISO) e os campos. */
export interface SummaryEvent {
  eventId: number;
  time: string;
  data: Record<string, unknown>;
}

/** Os eventos nas listas do resumo (arvore, rede, arquivos, registro e DNS), ate MAX_ITEMS cada. */
export function summarizeSysmon(events: SummaryEvent[]): SysmonLists {
  const lists: SysmonLists = { processes: [], network: [], files: [], registry: [], dns: [] };
  const push = <T>(list: T[], item: T) => {
    if (list.length < MAX_ITEMS) list.push(item);
  };
  for (const { eventId, time, data: d } of events) {
    const image = text(d.Image) ?? '?';
    switch (eventId) {
      case 1:
        push(lists.processes, {
          time,
          pid: int(d.ProcessId),
          ppid: int(d.ParentProcessId),
          image,
          cmd: text(d.CommandLine),
          parentImage: text(d.ParentImage),
          user: text(d.User),
          hashes: text(d.Hashes),
        });
        break;
      case 3:
        push(lists.network, {
          time,
          image,
          protocol: text(d.Protocol),
          dstIp: text(d.DestinationIp),
          dstPort: int(d.DestinationPort),
          dstHost: text(d.DestinationHostname),
        });
        break;
      case 11: {
        const path = text(d.TargetFilename);
        if (path) push(lists.files, { time, image, path });
        break;
      }
      case 12:
      case 13:
      case 14: {
        const key = text(d.TargetObject);
        if (key) {
          push(lists.registry, {
            time,
            image,
            action: text(d.EventType),
            key,
            details: text(d.Details) ?? text(d.NewName),
          });
        }
        break;
      }
      case 22: {
        const query = text(d.QueryName);
        if (query) push(lists.dns, { time, image, query, results: text(d.QueryResults) });
        break;
      }
      default:
        break;
    }
  }
  return lists;
}

/**
 * Indicadores do que a VM fez: os nomes consultados no DNS, os destinos das conexoes (nome ou IP,
 * fora das faixas privadas e do loopback). Vao para os IOCs sugeridos da amostra.
 */
/** Sufixos que nunca sao indicador: redes locais, reverso e o dominio de teste (RFC 2606/6761). */
const LOCAL_SUFFIXES = /\.(invalid|local|localhost|localdomain|internal|lan|arpa|test)$/;

/**
 * Nome que pode virar IOC: com um ponto no meio (sem `wpad` ou nome NetBIOS da propria rede), sem o
 * marcador `..localmachine` do Sysmon e fora dos sufixos locais. Visto no teste contra o Windows
 * real (plano pos-revisao, 5.5): sem este filtro, o ruido do proprio Windows ia para o relatorio.
 */
export function publicName(value: string | null | undefined): string | null {
  const name = (value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(name)) return null;
  return LOCAL_SUFFIXES.test(name) ? null : name;
}

export function sysmonIndicators(lists: {
  dns: { query: string }[];
  network: { dstHost: string | null; dstIp: string | null }[];
}): string[] {
  const privateIp =
    // Privados, loopback, link-local, multicast (IPv4 224-239, IPv6 ff00::/8) e broadcast.
    /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.|::1$|fe80:|fc|fd|ff[0-9a-f]{2}:)/i;
  const out = new Set<string>();
  for (const q of lists.dns) {
    const name = publicName(q.query);
    if (name) out.add(name);
  }
  for (const c of lists.network) {
    const host = publicName(c.dstHost);
    if (host) out.add(host);
    else if (c.dstIp && !privateIp.test(c.dstIp)) out.add(c.dstIp);
  }
  return [...out];
}
