/**
 * Sysmon no template (plano pos-revisao, item 5.3): o que o Sysmon registrou na VM desde o inicio da
 * sessao, lido pelo agente do guest (qemu-guest-agent, agent/exec) a cada coleta dos artefatos. Vira
 * a arvore de processos, as conexoes, os arquivos criados, o registro alterado e as consultas DNS.
 *
 * O Sysmon e instalado no template por quem o prepara (docs/proxmox.pt-BR.md). Sem ele, ou num
 * guest Linux, ficam os prints e a lista de processos de sempre, com o motivo na tela. Como a lista
 * de processos, e o que o proprio guest diz: um malware com privilegio pode apagar o log.
 */

/** Eventos lidos: processo (1), rede (3), arquivo (11), registro (12, 13, 14), DNS (22). */
const EVENT_IDS = [1, 3, 11, 12, 13, 14, 22];
/** Teto de eventos por leitura e de itens por lista guardada. */
export const SYSMON_MAX_EVENTS = 2000;
const MAX_ITEMS = 500;
const MAX_TEXT = 1000;

/** Marca na saida: o canal do Sysmon nao existe (nao instalado). */
const MISSING = 'DEEPLOOK_SEM_SYSMON';

/**
 * O comando do agente: um PowerShell em Base64 (UTF-16LE, como o -EncodedCommand pede), sem aspas
 * a escapar. Le os eventos desde `since`, do mais antigo para o mais novo (no teto, o comeco da
 * execucao fica, que e o que mais conta), e devolve JSON compacto (uma lista, mesmo com um evento).
 */
export function sysmonCommand(since: Date): string[] {
  const script = [
    // Caminhos com acento: a saida do agente em UTF-8, nao na pagina de codigo do console.
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$log = 'Microsoft-Windows-Sysmon/Operational'",
    `if (-not (Get-WinEvent -ListLog $log -ErrorAction SilentlyContinue)) { '${MISSING}'; exit 0 }`,
    `$since = [datetime]::Parse('${since.toISOString()}').ToUniversalTime()`,
    `$events = Get-WinEvent -FilterHashtable @{ LogName = $log; StartTime = $since.ToLocalTime(); Id = ${EVENT_IDS.join(',')} } -MaxEvents ${SYSMON_MAX_EVENTS} -Oldest -ErrorAction SilentlyContinue`,
    // foreach sobre $null nao itera (sem eventos: lista vazia, "[]").
    '$list = @(foreach ($e in $events) {',
    '  $d = @{}',
    '  foreach ($n in ([xml]$e.ToXml()).Event.EventData.Data) { $d[$n.Name] = $n.InnerText }',
    "  [pscustomobject]@{ id = $e.Id; time = $e.TimeCreated.ToUniversalTime().ToString('o'); data = $d }",
    '})',
    'ConvertTo-Json -InputObject $list -Compress -Depth 4',
  ].join('\n');
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
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

export type SysmonSummary =
  | {
      available: true;
      events: number;
      /** Bateu no teto de eventos: o resto ficou de fora. */
      truncated: boolean;
      processes: SysmonProcess[];
      network: SysmonConnection[];
      files: SysmonFile[];
      registry: SysmonRegistry[];
      dns: SysmonDns[];
    }
  | { available: false; reason: string };

type RawEvent = { id?: number; time?: string; data?: Record<string, string | null> };

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim() || value === '-') return null;
  return value.replaceAll('\u0000', '').slice(0, MAX_TEXT);
};
const int = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** A saida do comando para o resumo. Texto que nao e JSON vira "indisponivel", com o motivo. */
export function parseSysmon(output: string): SysmonSummary {
  // BOM e ruido antes do JSON (um aviso do PowerShell no stdout) nao derrubam a leitura.
  const trimmed = output.replace(/^\uFEFF/, '').trim();
  if (trimmed.endsWith(MISSING)) {
    return {
      available: false,
      reason:
        'Sysmon não instalado no template (canal Microsoft-Windows-Sysmon/Operational ausente)',
    };
  }
  let raw: unknown;
  const start = trimmed.search(/^[[{]/m);
  try {
    raw = trimmed ? JSON.parse(start > 0 ? trimmed.slice(start) : trimmed) : [];
  } catch {
    return { available: false, reason: 'resposta do Sysmon em formato inesperado' };
  }
  const events = (Array.isArray(raw) ? raw : [raw]) as RawEvent[];
  const summary = {
    available: true as const,
    events: events.length,
    truncated: events.length >= SYSMON_MAX_EVENTS,
    processes: [] as SysmonProcess[],
    network: [] as SysmonConnection[],
    files: [] as SysmonFile[],
    registry: [] as SysmonRegistry[],
    dns: [] as SysmonDns[],
  };
  const push = <T>(list: T[], item: T) => {
    if (list.length < MAX_ITEMS) list.push(item);
  };
  for (const event of events) {
    const d = event?.data ?? {};
    const time = typeof event?.time === 'string' ? event.time : '';
    const image = text(d.Image) ?? '?';
    switch (event?.id) {
      case 1:
        push(summary.processes, {
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
        push(summary.network, {
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
        if (path) push(summary.files, { time, image, path });
        break;
      }
      case 12:
      case 13:
      case 14: {
        const key = text(d.TargetObject);
        if (key) {
          push(summary.registry, {
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
        if (query) push(summary.dns, { time, image, query, results: text(d.QueryResults) });
        break;
      }
      default:
        break;
    }
  }
  return summary;
}

/**
 * Indicadores do que a VM fez: os nomes consultados no DNS, os destinos das conexoes (nome ou IP,
 * fora das faixas privadas e do loopback). Vao para os IOCs sugeridos da amostra.
 */
export function sysmonIndicators(summary: SysmonSummary): string[] {
  if (!summary.available) return [];
  const privateIp =
    /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fe80:|fc|fd)/i;
  const out = new Set<string>();
  for (const q of summary.dns) out.add(q.query.toLowerCase());
  for (const c of summary.network) {
    if (c.dstHost) out.add(c.dstHost.toLowerCase());
    else if (c.dstIp && !privateIp.test(c.dstIp)) out.add(c.dstIp);
  }
  return [...out];
}
