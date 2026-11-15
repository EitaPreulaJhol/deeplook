import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { env, proxmoxMock, sandboxEnabled } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { log, reason } from './log';
import { prisma } from './prisma';
import {
  createVncProxy,
  ProxmoxError,
  pve,
  pveAuth,
  pveConsoleWsUrl,
  pveOrigin,
  pveRaw,
  pveVerifyTls,
} from './proxmox';
import { s3 } from './s3';
import { parseSysmon, sysmonCommand, type SysmonSummary } from './sysmon';
import { vncSnapshot } from './vnc-snapshot';

/**
 * Artefatos do sandbox (revisao de novembro, item 3.7): enquanto o ambiente isolado roda, a API
 * guarda de tempos em tempos (SANDBOX_ARTIFACT_INTERVAL_S) um print da tela da VM e a lista de
 * processos, e uma ultima coleta ao encerrar. Ficam com a amostra depois que a VM e destruida:
 * o que apareceu na tela e que processo surgiu viram evidencia para o relatorio.
 *
 *  - Print: pelo endpoint de screenshot do PVE quando ele existe e, no PVE 9 (que o tirou), pelo
 *    proprio console VNC (lib/vnc-snapshot.ts), como o noVNC faz no navegador. Guardados no MinIO,
 *    no maximo SANDBOX_ARTIFACT_MAX_SHOTS por ambiente: o primeiro e os mais recentes.
 *  - Processos: pelo qemu-guest-agent (agent/exec), que o template ja exige. No Windows, o
 *    Get-CimInstance Win32_Process (com a linha de comando); no Linux, o ps. E o que o PROPRIO
 *    guest diz: malware pode esconder processo. Sem o agente, ou sem a permissao no PVE
 *    (VM.GuestAgent.Unrestricted no PVE 9, VM.Monitor no 8), fica so o print, e o motivo aparece
 *    na tela.
 *
 *  - Sysmon (plano pos-revisao, item 5.3): num guest Windows com o Sysmon no template, os eventos
 *    desde o inicio da sessao (lib/sysmon.ts), lidos pelo mesmo agente.
 */

export type GuestProcess = { pid: number; ppid: number | null; name: string; cmd: string | null };

const MAX_PROCESSES = 500;
const EXEC_WAIT_MS = 20_000;
/**
 * Espera da leitura do Sysmon: ate 2000 eventos convertidos um a um pelo PowerShell 5.1, numa VM
 * que a amostra pode estar ocupando. Os 20 s dos outros comandos nao bastavam.
 */
const SYSMON_WAIT_MS = 90_000;
const POLL_MS = 500;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Comando que lista os processos, conforme o sistema do guest. */
const WINDOWS_COMMAND = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Csv -NoTypeInformation',
];
const LINUX_COMMAND = ['ps', '-eo', 'pid=,ppid=,comm=,args='];

/** Uma linha de CSV com aspas (o ConvertTo-Csv poe tudo entre aspas, com "" dentro). */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Saida do PowerShell (CSV com cabecalho) para a lista de processos. */
export function parseWindowsProcesses(text: string): GuestProcess[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = csvLine(lines.shift() ?? '').map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const [pid, ppid, name, cmd] = ['ProcessId', 'ParentProcessId', 'Name', 'CommandLine'].map(col);
  if (pid < 0 || name < 0) return [];
  return lines.slice(0, MAX_PROCESSES).flatMap((line) => {
    const cells = csvLine(line);
    const id = Number(cells[pid]);
    if (!Number.isInteger(id)) return [];
    return [
      {
        pid: id,
        ppid: ppid >= 0 && cells[ppid] !== '' ? Number(cells[ppid]) : null,
        name: (cells[name] ?? '').slice(0, 200),
        cmd: cmd >= 0 && cells[cmd] ? cells[cmd].slice(0, 500) : null,
      },
    ];
  });
}

/** Saida do ps (pid ppid comm args) para a lista de processos. */
export function parseLinuxProcesses(text: string): GuestProcess[] {
  return text
    .split('\n')
    .slice(0, MAX_PROCESSES)
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
      if (!m) return [];
      return [
        {
          pid: Number(m[1]),
          ppid: Number(m[2]),
          name: m[3].slice(0, 200),
          cmd: m[4].slice(0, 500) || null,
        },
      ];
    });
}

/**
 * O que surgiu desde a primeira coleta: processos cujo nome + linha de comando nao estava na
 * lista inicial (o PID muda a cada execucao; o par nome e comando, nao).
 */
export function newProcesses(first: GuestProcess[], later: GuestProcess[]): GuestProcess[] {
  const key = (p: GuestProcess) => `${p.name.toLowerCase()}\u0000${p.cmd ?? ''}`;
  const seen = new Set(first.map(key));
  return later.filter((p) => !seen.has(key(p)));
}

/** Motivo legivel de uma falha do agente (sem agente, sem permissao). */
function agentProblem(err: unknown): string {
  const status = err instanceof ProxmoxError ? err.pveStatus : null;
  const text = reason(err);
  if (status === 403 || /permission/i.test(text)) {
    return 'sem permissão para usar o agente da VM no Proxmox (VM.GuestAgent.Unrestricted no PVE 9, VM.Monitor no 8)';
  }
  // So o "agente nao esta rodando" vira o aviso generico; o resto (ex.: erro do guest-exec) mostra
  // o detalhe do PVE, que e o que diz o que corrigir.
  if (/not running|no qemu guest agent/i.test(text)) {
    return 'o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)';
  }
  return `o agente da VM falhou: ${text.slice(0, 160)}`;
}

const agentBase = (node: string, vmid: number) => `/nodes/${node}/qemu/${vmid}/agent`;

/** O guest e Windows? (pelo agente; lanca se ele nao responder). */
export async function guestIsWindows(node: string, vmid: number): Promise<boolean> {
  const os = await pve<{ result?: { id?: string } }>(`${agentBase(node, vmid)}/get-osinfo`);
  return (os.result?.id ?? '').toLowerCase().includes('windows');
}

/** Roda um comando no guest pelo agente e devolve a saida padrao. */
export async function guestRun(
  node: string,
  vmid: number,
  command: string[],
  what: string,
  waitMs = EXEC_WAIT_MS,
): Promise<string> {
  const base = agentBase(node, vmid);
  const started = await pve<{ pid: number }>(`${base}/exec`, { method: 'POST', body: { command } });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const status = await pve<{ exited?: number | boolean; 'out-data'?: string; exitcode?: number }>(
      `${base}/exec-status?pid=${started.pid}`,
    );
    if (status.exited) return status['out-data'] ?? '';
    if (Date.now() > deadline) throw new Error(`${what} não terminou a tempo`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Lista os processos do guest pelo agente. Lanca se o agente nao responder. */
export async function guestProcesses(
  node: string,
  vmid: number,
  windows?: boolean,
): Promise<GuestProcess[]> {
  const isWindows = windows ?? (await guestIsWindows(node, vmid));
  const out = await guestRun(
    node,
    vmid,
    isWindows ? WINDOWS_COMMAND : LINUX_COMMAND,
    'a listagem de processos',
  );
  return isWindows ? parseWindowsProcesses(out) : parseLinuxProcesses(out);
}

/** O Sysmon do guest Windows desde `since` (plano pos-revisao, item 5.3). */
export async function guestSysmon(node: string, vmid: number, since: Date): Promise<SysmonSummary> {
  return parseSysmon(
    await guestRun(node, vmid, sysmonCommand(since), 'a leitura do Sysmon', SYSMON_WAIT_MS),
  );
}

/** O endpoint de screenshot do PVE existe? (o PVE 9 o tirou: responde 501). Lembrado no processo. */
let endpointMissing = false;

/**
 * Print da tela: pelo endpoint do PVE quando ele existe (PVE 8 e o modo simulado) e, sem ele, pelo
 * console VNC, como o noVNC (lib/vnc-snapshot.ts). Null se nenhum dos dois deu.
 */
async function screenshot(node: string, vmid: number): Promise<Buffer | null> {
  if (!endpointMissing) {
    const shot = await pveRaw(`/nodes/${node}/qemu/${vmid}/screenshot`, { method: 'POST' });
    if (shot.status < 400 && shot.body.subarray(0, 4).equals(PNG)) return shot.body;
    if (shot.status === 501 || shot.status === 404) endpointMissing = true;
  }
  if (proxmoxMock) return null;
  const proxy = await createVncProxy(vmid);
  const auth = await pveAuth();
  return vncSnapshot(pveConsoleWsUrl(vmid, proxy.port, proxy.ticket), {
    password: proxy.password,
    headers: { Cookie: auth.cookie, CSRFPreventionToken: auth.csrf, Origin: pveOrigin() },
    rejectUnauthorized: pveVerifyTls(),
  });
}

/** Apaga prints do meio quando passam do teto: ficam o primeiro e os mais recentes. */
async function pruneShots(sessionId: string): Promise<void> {
  const shots = await prisma.sandboxArtifact.findMany({
    where: { sessionId, kind: 'SCREENSHOT' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, storageKey: true },
  });
  const extra = shots.length - env.SANDBOX_ARTIFACT_MAX_SHOTS;
  if (extra <= 0) return;
  const drop = shots.slice(1, 1 + extra);
  for (const shot of drop) {
    if (shot.storageKey) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: shot.storageKey }))
        .catch(() => undefined);
    }
  }
  await prisma.sandboxArtifact.deleteMany({ where: { id: { in: drop.map((d) => d.id) } } });
}

/** Uma coleta: print e processos. Nunca lanca; o motivo de falha do agente fica na sessao. */
export async function collectArtifacts(
  sessionId: string,
  { final = false }: { final?: boolean } = {},
): Promise<{ shot: boolean; processes: boolean; sysmon: boolean }> {
  const result = { shot: false, processes: false, sysmon: false };
  const session = await prisma.sandboxSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      node: true,
      vmid: true,
      entryId: true,
      artifactsNote: true,
      startedAt: true,
      createdAt: true,
    },
  });
  if (!session?.vmid) return result;
  const { node, vmid } = session;

  try {
    const png = await screenshot(node, vmid);
    if (png) {
      const key = `sandbox/${session.entryId}/${session.id}/${Date.now()}.png`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: png,
          ContentType: 'image/png',
        }),
      );
      await prisma.sandboxArtifact.create({
        data: { sessionId, kind: 'SCREENSHOT', storageKey: key },
      });
      await pruneShots(sessionId);
      result.shot = true;
    }
  } catch (err) {
    log.warn(`[sandbox] print da VM ${vmid} falhou: ${reason(err)}`);
  }

  let note: string | null = null;
  let windows = false;
  try {
    windows = await guestIsWindows(node, vmid);
    const processes = await guestProcesses(node, vmid, windows);
    await prisma.sandboxArtifact.create({
      data: {
        sessionId,
        kind: 'PROCESSES',
        processes: processes as unknown as Prisma.InputJsonValue,
      },
    });
    result.processes = true;
  } catch (err) {
    note = agentProblem(err);
  }

  // Sysmon (plano pos-revisao, item 5.3): so no Windows, e so com o agente respondendo. Os eventos
  // sao desde o inicio da sessao, entao fica so a leitura mais recente.
  if (result.processes && windows) {
    let sysmon: SysmonSummary;
    try {
      sysmon = await guestSysmon(node, vmid, session.startedAt ?? session.createdAt);
    } catch (err) {
      sysmon = { available: false, reason: agentProblem(err) };
    }
    // Uma leitura que falhou nunca apaga uma boa: a ultima coleta (com a VM ja desligando) ou uma
    // leitura lenta tirava da amostra todos os eventos lidos durante a sessao.
    const kept = sysmon.available
      ? null
      : await prisma.sandboxArtifact.findFirst({
          where: { sessionId, kind: 'SYSMON', sysmon: { path: ['available'], equals: true } },
          select: { id: true },
        });
    if (kept && !sysmon.available) {
      log.warn(`[sandbox] leitura do Sysmon do ambiente ${sessionId} falhou: ${sysmon.reason}`);
    } else {
      await prisma.$transaction([
        prisma.sandboxArtifact.deleteMany({ where: { sessionId, kind: 'SYSMON' } }),
        prisma.sandboxArtifact.create({
          data: { sessionId, kind: 'SYSMON', sysmon: sysmon as unknown as Prisma.InputJsonValue },
        }),
      ]);
    }
    result.sysmon = sysmon.available;
  }
  // A ultima coleta (ao encerrar) e de cortesia: o agente as vezes nao responde com a VM ja
  // desligando (visto no teste real, 5.5). Se o ambiente ja tem listas de processos, a falha dela
  // fica no log da API e nao vira aviso na tela de uma sessao que correu bem.
  if (final && note && !result.processes) {
    const earlier = await prisma.sandboxArtifact.count({ where: { sessionId, kind: 'PROCESSES' } });
    if (earlier > 0) {
      log.warn(`[sandbox] última coleta do ambiente ${sessionId} sem o agente: ${note}`);
      return result;
    }
  }
  if (note !== session.artifactsNote) {
    await prisma.sandboxSession.update({ where: { id: sessionId }, data: { artifactsNote: note } });
  }
  return result;
}

let running = false;

/** Uma rodada: todos os ambientes em execucao, um de cada vez. */
export async function collectRunning(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const sessions = await prisma.sandboxSession.findMany({
      where: { status: 'RUNNING', vmid: { not: null } },
      select: { id: true },
    });
    for (const s of sessions) await collectArtifacts(s.id);
    return sessions.length;
  } finally {
    running = false;
  }
}

/** Liga o coletor (SANDBOX_ARTIFACT_INTERVAL_S = 0 desliga). */
export function startArtifactCollector(): void {
  const seconds = env.SANDBOX_ARTIFACT_INTERVAL_S;
  if (!sandboxEnabled || !seconds) return;
  const timer = setInterval(() => {
    void collectRunning().catch((err: unknown) =>
      log.warn(`[sandbox] coleta de artefatos falhou: ${reason(err)}`),
    );
  }, seconds * 1000);
  timer.unref();
}

/** Chaves dos prints de uma amostra (a lixeira apaga junto). */
export async function artifactKeysOf(entryId: string): Promise<string[]> {
  const rows = await prisma.sandboxArtifact.findMany({
    where: { session: { entryId }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey!);
}
