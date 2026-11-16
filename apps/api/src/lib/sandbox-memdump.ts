import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { type AnalysisService, requestAnalysis, requestFailure } from './analysis-service';
import { createFileEntry } from './entry-create';
import { CANCELLED_REASON, isQueuePaused, registerQueueWaker, startJob } from './job-control';
import { log, reason } from './log';
import { prisma } from './prisma';
import { s3 } from './s3';
import { sampleFileName } from './sandbox';
import { agentBusy, guestProcesses, guestRun } from './sandbox-artifacts';
import { sampleTree } from './sysmon-store';

/**
 * Dump de memoria dos processos da amostra no sandbox (plans/novas-analises, item 3).
 *
 * A memoria inteira da VM nao da: o usuario do PVE nao tem o monitor do QEMU (Sys.Modify em /), e a
 * API do PVE nao baixa arquivos do host. Em vez disso, dentro do clone, pelo agente (como SYSTEM):
 *
 *   1. os processos da arvore da amostra (pelo Sysmon), conferidos vivos na lista do agente;
 *   2. MiniDumpWriteDump com a memoria inteira e as informacoes das regioes, em %TEMP%, com gzip;
 *   3. o .gz lido em pedacos (Base64 na saida do agent/exec), conferido pelo SHA-256 e guardado no
 *      MinIO; o arquivo sai da VM no fim.
 *
 * Depois, o servico extract le o minidump (regioes privadas executaveis, PEs fora de imagem,
 * configuracao de familias) e os PEs achados viram amostras filhas, que passam pelo YARA, pelo capa
 * e pela extracao de configuracao como qualquer envio. O template nunca e tocado: tudo roda no clone.
 */

/** Tempos e tetos; os testes os encurtam. */
export const memdumpTiming = {
  tickMs: 10_000,
  /** Espera do dump (MiniDumpWriteDump e o gzip) e de cada pedaco. */
  dumpWaitMs: 5 * 60_000,
  chunkWaitMs: 60_000,
  serviceWaitMs: 120_000,
  retryEveryMs: 2000,
};

/**
 * Bytes por pedaco lido do guest. Medido no Proxmox real (Windows 11, qemu-ga): 1 MB por leitura
 * (1,4 MB de Base64 na saida) passa em ~3 s; 2 MB derrubam o agente ("guest agent is not running")
 * e, com ele, o resto da coleta do ambiente. 768 KB deixam folga.
 */
const CHUNK_BYTES = 768 * 1024;
const MAX_ATTEMPTS = 3;

export function memdumpEnabled(): boolean {
  return env.SANDBOX_MEMDUMP_MAX_MB > 0;
}

const extractService = (): AnalysisService => ({
  name: 'extract',
  url: env.EXTRACT_URL,
  token: env.EXTRACT_TOKEN,
  timeoutS: env.EXTRACT_REQUEST_TIMEOUT_S,
});

// ------------------------------------------------------------------ comandos do guest

const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
const psQuote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const powershell = (script: string) => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-EncodedCommand',
  encode(script),
];

/**
 * MiniDump completo de um processo, com gzip. Flags: FullMemory (0x2), HandleData (0x4),
 * UnloadedModules (0x20), FullMemoryInfo (0x800) e ThreadInfo (0x1000). Saida numa linha:
 * DUMP_OK|tamanho|tamanho do gzip|sha256 do gzip|caminho, ou o motivo.
 */
export function memdumpCommand(pid: number, maxBytes: number): string[] {
  return powershell(
    [
      '# DEEPLOOK_MEMDUMP',
      "$ErrorActionPreference = 'Stop'",
      `$target = ${pid}`,
      "$dir = Join-Path $env:TEMP 'deeplook-mem'",
      'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
      '$p = Get-Process -Id $target -ErrorAction SilentlyContinue',
      "if (-not $p) { 'DUMP_SEM_PROCESSO'; exit 0 }",
      "Add-Type -TypeDefinition @'",
      'using System;',
      'using System.Runtime.InteropServices;',
      'using Microsoft.Win32.SafeHandles;',
      'public static class DeepLookDump {',
      '  [DllImport("dbghelp.dll", SetLastError = true)]',
      '  public static extern bool MiniDumpWriteDump(IntPtr process, uint pid, SafeFileHandle file, uint type, IntPtr e, IntPtr u, IntPtr c);',
      '}',
      "'@",
      '$raw = Join-Path $dir ("" + $target + ".dmp")',
      '$fs = [IO.File]::Create($raw)',
      '$ok = [DeepLookDump]::MiniDumpWriteDump($p.Handle, [uint32]$target, $fs.SafeFileHandle, 0x1826, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)',
      '$err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()',
      '$fs.Close()',
      "if (-not $ok) { Remove-Item $raw -ErrorAction SilentlyContinue; 'DUMP_FALHOU|' + $err; exit 0 }",
      '$size = (Get-Item $raw).Length',
      `if ($size -gt ${maxBytes}) { Remove-Item $raw; 'DUMP_GRANDE|' + $size; exit 0 }`,
      '$gz = $raw + ".gz"',
      '$in = [IO.File]::OpenRead($raw)',
      '$out = [IO.File]::Create($gz)',
      '$z = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)',
      '$in.CopyTo($z)',
      '$z.Close(); $in.Close(); $out.Close()',
      'Remove-Item $raw',
      '$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $gz).Hash.ToLower()',
      "'DUMP_OK|' + $size + '|' + (Get-Item $gz).Length + '|' + $hash + '|' + $gz",
    ].join('\n'),
  );
}

/** Um pedaco do arquivo em Base64 (o deslocamento e o tamanho vao tambem num comentario). */
export function memReadCommand(path: string, offset: number, length: number): string[] {
  return powershell(
    [
      `# DEEPLOOK_MEMREAD off=${offset} len=${length}`,
      `$f = [IO.File]::OpenRead(${psQuote(path)})`,
      `$f.Seek(${offset}, 'Begin') | Out-Null`,
      `$buf = New-Object byte[] ${length}`,
      '$n = 0',
      `while ($n -lt ${length}) { $r = $f.Read($buf, $n, ${length} - $n); if ($r -le 0) { break }; $n += $r }`,
      '$f.Close()',
      '[Convert]::ToBase64String($buf, 0, $n)',
    ].join('\n'),
  );
}

export function memCleanCommand(path: string): string[] {
  return powershell(
    [
      '# DEEPLOOK_MEMCLEAN',
      `Remove-Item -LiteralPath ${psQuote(path)} -ErrorAction SilentlyContinue`,
    ].join('\n'),
  );
}

/** A linha DUMP_OK|... (ou o motivo de nao ter saido). */
export function parseDumpLine(
  out: string,
):
  | { ok: true; size: number; storedSize: number; sha256: string; path: string }
  | { ok: false; error: string } {
  const line = out.trim().split(/\r?\n/).at(-1) ?? '';
  const m = /^DUMP_OK\|(\d+)\|(\d+)\|([0-9a-f]{64})\|(.+)$/.exec(line);
  if (m) {
    return { ok: true, size: Number(m[1]), storedSize: Number(m[2]), sha256: m[3], path: m[4] };
  }
  if (line === 'DUMP_SEM_PROCESSO') return { ok: false, error: 'o processo já terminou' };
  const big = /^DUMP_GRANDE\|(\d+)/.exec(line);
  if (big) {
    return {
      ok: false,
      error: `dump de ${Math.round(Number(big[1]) / 1048576)} MB, acima do teto (SANDBOX_MEMDUMP_MAX_MB)`,
    };
  }
  const failed = /^DUMP_FALHOU\|(-?\d+)/.exec(line);
  if (failed) return { ok: false, error: `o MiniDumpWriteDump falhou (erro ${failed[1]})` };
  return { ok: false, error: 'resposta inesperada da VM ao tirar o dump' };
}

// ------------------------------------------------------------------ captura

/** Nunca despejados: o console (pode ser o do proprio agente, com o PID reaproveitado). */
const SKIP = new Set(['conhost.exe']);

/**
 * Os processos da amostra vivos agora: pela arvore do Sysmon, conferidos na lista do agente pelo
 * nome e pelo pai (o Windows reaproveita PIDs: no teste real, o PID de um conhost da amostra ja era
 * o console do proprio agente, e o dump dele derrubou o qemu-ga). O da amostra vem primeiro.
 */
async function targets(
  session: { id: string; node: string; vmid: number },
  sampleName: string,
): Promise<{ pid: number; image: string | null; processGuid: string | null }[]> {
  const live = await guestProcesses(session.node, session.vmid, true);
  const alive = new Map(live.map((p) => [p.pid, { name: p.name.toLowerCase(), ppid: p.ppid }]));
  const base = (path: string | null) => (path?.split(/[\\/]/).pop() ?? '').toLowerCase();
  const tree = await sampleTree(session.id, sampleName);
  const found: { pid: number; image: string | null; processGuid: string | null; own: boolean }[] =
    [];
  if (tree.size) {
    const rows = await prisma.sandboxSysmonEvent.findMany({
      where: { sessionId: session.id, eventId: 1, processGuid: { in: [...tree] } },
      orderBy: { time: 'asc' },
      select: { image: true, processGuid: true, data: true },
    });
    for (const r of rows) {
      const d = r.data as Record<string, string | null>;
      const pid = Number(d.ProcessId);
      const parent = Number(d.ParentProcessId);
      const now = alive.get(pid);
      const name = base(r.image);
      if (!Number.isInteger(pid) || !now || now.name !== name || SKIP.has(name)) continue;
      // O mesmo pai que o Sysmon viu (quando os dois dizem).
      if (Number.isInteger(parent) && now.ppid !== null && now.ppid !== parent) continue;
      found.push({
        pid,
        image: r.image,
        processGuid: r.processGuid,
        own: name === sampleName.toLowerCase(),
      });
    }
  } else {
    // Sem o Sysmon: o processo com o nome do arquivo da amostra.
    for (const p of live) {
      if (p.name.toLowerCase() === sampleName.toLowerCase()) {
        found.push({ pid: p.pid, image: p.name, processGuid: null, own: true });
      }
    }
  }
  const unique = [...new Map(found.map((f) => [f.pid, f])).values()].sort(
    (a, b) => Number(b.own) - Number(a.own),
  );
  return unique
    .slice(0, env.SANDBOX_MEMDUMP_MAX_PROCESSES)
    .map(({ pid, image, processGuid }) => ({ pid, image, processGuid }));
}

/** Le o arquivo do guest em pedacos e confere o SHA-256. */
async function pull(
  session: { node: string; vmid: number },
  path: string,
  size: number,
  sha256: string,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    const length = Math.min(CHUNK_BYTES, size - offset);
    const out = await guestRun(
      session.node,
      session.vmid,
      memReadCommand(path, offset, length),
      'a leitura do dump',
      { waitMs: memdumpTiming.chunkWaitMs },
    );
    const chunk = Buffer.from(out.replace(/\s+/g, ''), 'base64');
    if (chunk.length !== length) throw new Error('pedaço do dump com tamanho errado');
    parts.push(chunk);
  }
  const data = Buffer.concat(parts);
  if (createHash('sha256').update(data).digest('hex') !== sha256) {
    throw new Error('o dump chegou diferente do que a VM gravou (SHA-256)');
  }
  return data;
}

const capturing = new Set<string>();

/**
 * Tira o dump dos processos da amostra de um ambiente no ar. Devolve quantos dumps comecaram (0 se
 * ja havia uma captura em andamento ou nenhum processo da amostra esta vivo). Nunca lanca: a falha
 * de cada processo fica na linha dele.
 */
export async function captureMemory(
  sessionId: string,
): Promise<{ started: number; reason?: string }> {
  if (capturing.has(sessionId)) return { started: 0, reason: 'busy' };
  capturing.add(sessionId);
  try {
    const session = await prisma.sandboxSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        node: true,
        vmid: true,
        status: true,
        entryId: true,
        entry: { select: { originalFilename: true } },
      },
    });
    if (!session?.vmid || session.status !== 'RUNNING') return { started: 0, reason: 'stopped' };
    const vm = { id: session.id, node: session.node, vmid: session.vmid };
    let list: Awaited<ReturnType<typeof targets>>;
    try {
      list = await targets(vm, sampleFileName(session.entry));
    } catch (err) {
      log.warn(`[memória] processos do ambiente ${sessionId}: ${reason(err)}`);
      return { started: 0, reason: 'agent' };
    }
    if (!list.length) return { started: 0, reason: 'none' };
    for (const t of list) {
      const row = await prisma.sandboxMemoryDump.create({
        data: { sessionId, pid: t.pid, image: t.image, processGuid: t.processGuid },
      });
      await captureOne(vm, session.entryId, row.id, t.pid).catch(async (err: unknown) => {
        await prisma.sandboxMemoryDump.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            error: (agentBusy(err)
              ? 'o agente da VM não respondeu a tempo (VM ocupada)'
              : reason(err)
            ).slice(0, 300),
            finishedAt: new Date(),
          },
        });
      });
    }
    wakeAnalysis();
    return { started: list.length };
  } finally {
    capturing.delete(sessionId);
  }
}

async function captureOne(
  vm: { node: string; vmid: number },
  entryId: string,
  id: string,
  pid: number,
): Promise<void> {
  const out = await guestRun(
    vm.node,
    vm.vmid,
    memdumpCommand(pid, env.SANDBOX_MEMDUMP_MAX_MB * 1024 * 1024),
    'o dump de memória',
    { waitMs: memdumpTiming.dumpWaitMs },
  );
  const dump = parseDumpLine(out);
  if (!dump.ok) {
    await prisma.sandboxMemoryDump.update({
      where: { id },
      data: { status: 'FAILED', error: dump.error, finishedAt: new Date() },
    });
    return;
  }
  try {
    const data = await pull(vm, dump.path, dump.storedSize, dump.sha256);
    const key = `sandbox/${entryId}/memory/${id}.dmp.gz`;
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: 'application/gzip',
      }),
    );
    await prisma.sandboxMemoryDump.update({
      where: { id },
      data: {
        status: 'STORED',
        storageKey: key,
        size: BigInt(dump.size),
        storedSize: BigInt(dump.storedSize),
        sha256: dump.sha256,
        storedAt: new Date(),
      },
    });
  } finally {
    // O .gz sai da VM mesmo se a leitura falhar (o disco do clone e pequeno).
    await guestRun(vm.node, vm.vmid, memCleanCommand(dump.path), 'a limpeza do dump').catch(
      () => undefined,
    );
  }
}

// ------------------------------------------------------------------ analise (servico extract)

const text = (max: number) => z.string().max(max);
const regionSchema = z.object({
  base: text(20),
  size: z.number().int().nonnegative(),
  protect: text(10),
  allocationProtect: text(20).optional(),
  kind: z.enum(['pe', 'code']),
  entropy: z.number(),
  head: text(64),
  sha256: text(64),
  carved: text(64).optional(),
  matches: z
    .array(z.object({ rule: text(200).nullable(), family: text(200).nullable() }))
    .max(200)
    .optional(),
  configs: z
    .array(z.object({ family: text(200), config: z.unknown() }))
    .max(50)
    .optional(),
  errors: z
    .array(z.object({ family: text(200), error: text(300).nullable() }))
    .max(50)
    .optional(),
});
export const memdumpResultSchema = z.object({
  ok: z.literal(true),
  arch: text(40).nullable().optional(),
  modules: z.number().int().nonnegative(),
  mainModule: text(300).nullable().optional(),
  regionsTotal: z.number().int().nonnegative(),
  privateScanned: z.number().int().nonnegative(),
  privateExecutable: z.number().int().nonnegative(),
  regions: z.array(regionSchema).max(200),
  carved: z
    .array(z.object({ base: text(20), sha256: text(64), size: z.number().int(), data: z.string() }))
    .max(20),
  urls: z.array(text(400)).max(300),
});
export type MemdumpResult = Omit<z.infer<typeof memdumpResultSchema>, 'carved' | 'ok'>;

let worker: Promise<void> | null = null;
/** O log do Fastify, para a criacao das amostras filhas (o mesmo do envio). */
let entryLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => entryLog,
} as unknown as FastifyBaseLogger;

function wakeAnalysis(): void {
  if (worker || !env.EXTRACT_URL || !env.EXTRACT_TOKEN) return;
  worker = drain()
    .catch((err: unknown) => log.warn(`[memória] a fila parou: ${reason(err)}`))
    .finally(() => (worker = null));
}

/** Para os testes: espera a analise dos dumps acabar. */
export async function memdumpIdle(): Promise<void> {
  while (worker) await worker;
}

async function drain(): Promise<void> {
  for (;;) {
    // Fila pausada pelo Monitoramento: o que esta em andamento termina, nada novo comeca.
    if (isQueuePaused('memdump')) return;
    const next = await prisma.sandboxMemoryDump.findFirst({
      where: { status: 'STORED', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return;
    const taken = await prisma.sandboxMemoryDump.updateMany({
      where: { id: next.id, status: 'STORED' },
      data: { status: 'ANALYZING', attempts: { increment: 1 } },
    });
    if (!taken.count) continue;
    const run = startJob('memdump', next.id);
    await analyze(next.id, run.signal)
      .catch(async (err: unknown) => {
        log.warn(`[memória] análise do dump ${next.id}: ${reason(err)}`);
        await prisma.sandboxMemoryDump.update({
          where: { id: next.id },
          data: { status: 'FAILED', error: 'falha interna na análise', finishedAt: new Date() },
        });
      })
      .finally(() => run.done());
  }
}

async function analyze(id: string, signal: AbortSignal): Promise<void> {
  const dump = await prisma.sandboxMemoryDump.findUniqueOrThrow({
    where: { id },
    select: {
      storageKey: true,
      attempts: true,
      image: true,
      pid: true,
      session: { select: { entryId: true, entry: { select: { ownerId: true, title: true } } } },
    },
  });
  const fail = (error: string) =>
    prisma.sandboxMemoryDump.update({
      where: { id },
      data: { status: 'FAILED', error: error.slice(0, 300), finishedAt: new Date() },
    });
  const obj = await s3
    .send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: dump.storageKey! }))
    .catch(() => null);
  if (!obj?.Body) return void (await fail('o dump não está mais no armazenamento'));
  const data = await obj.Body.transformToByteArray();
  const service = extractService();
  let res: Response;
  try {
    res = await requestAnalysis(service, data, {
      signal,
      waitMs: memdumpTiming.serviceWaitMs,
      retryEveryMs: memdumpTiming.retryEveryMs,
      path: '/memdump',
    });
  } catch (err) {
    if (signal.aborted) return void (await fail(CANCELLED_REASON));
    const why = requestFailure(service, err);
    if (dump.attempts < MAX_ATTEMPTS) {
      await prisma.sandboxMemoryDump.update({
        where: { id },
        data: { status: 'STORED', error: why },
      });
    } else await fail(why);
    return;
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || body.ok !== true) {
    const error =
      body && typeof body.error === 'string' ? body.error : `o serviço respondeu ${res.status}`;
    return void (await fail(error));
  }
  const parsed = memdumpResultSchema.safeParse(body);
  if (!parsed.success) return void (await fail('resposta do serviço em formato inesperado'));
  const { carved, ok: _ok, ...result } = parsed.data;

  // Os PEs achados viram amostras filhas (mesmo caminho do desempacotador): YARA, capa,
  // emulacao e configuracao rodam neles sozinhos.
  const children: { entryId: string; sha256: string; base: string }[] = [];
  const name = dump.image?.split(/[\\/]/).pop() ?? `pid-${dump.pid}`;
  for (const pe of carved) {
    const buffer = Buffer.from(pe.data, 'base64');
    if (createHash('sha256').update(buffer).digest('hex') !== pe.sha256) continue;
    try {
      const { entry } = await createFileEntry(
        { log: entryLog },
        dump.session.entry.ownerId,
        {
          buffer,
          filename: `${name}-${pe.base}.bin`,
          mimetype: 'application/octet-stream',
          title: `${name} (memória, ${pe.base})`,
          description: `PE achado na memória do processo ${name} (PID ${dump.pid}), região ${pe.base}, no sandbox de "${dump.session.entry.title}".`,
          tags: [],
          parentEntryId: dump.session.entryId,
        },
        { remaining: null },
        1,
      );
      children.push({ entryId: entry.id, sha256: pe.sha256, base: pe.base });
    } catch (err) {
      log.warn(`[memória] amostra filha do dump ${id}: ${reason(err)}`);
    }
  }
  await prisma.sandboxMemoryDump.update({
    where: { id },
    data: {
      status: 'DONE',
      error: null,
      result: result as unknown as Prisma.InputJsonValue,
      children: children as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

// ------------------------------------------------------------------ agendamento

let timer: NodeJS.Timeout | null = null;

/** Uma rodada: as capturas agendadas (depois da execucao automatica) e a fila de analise. */
export async function memdumpTick(now = new Date()): Promise<void> {
  const due = await prisma.sandboxSession.findMany({
    where: { status: 'RUNNING', memoryDumpAt: { lte: now }, memoryDumps: { none: {} } },
    select: { id: true },
  });
  for (const s of due) {
    // Uma vez so: a data sai antes de capturar (sem processo vivo, nao tenta de novo sozinha).
    await prisma.sandboxSession.update({ where: { id: s.id }, data: { memoryDumpAt: null } });
    const r = await captureMemory(s.id);
    if (!r.started) log.info(`[memória] ambiente ${s.id}: nada capturado (${r.reason})`);
  }
  wakeAnalysis();
}

/** Liga o agendamento. Captura interrompida falha; analise interrompida volta para a fila. */
export async function startMemdump(appLog?: FastifyBaseLogger): Promise<void> {
  if (appLog) entryLog = appLog;
  await prisma.sandboxMemoryDump.updateMany({
    where: { status: 'CAPTURING' },
    data: { status: 'FAILED', error: 'interrompida (a API reiniciou)', finishedAt: new Date() },
  });
  await prisma.sandboxMemoryDump.updateMany({
    where: { status: 'ANALYZING' },
    data: { status: 'STORED' },
  });
  if (!timer) {
    timer = setInterval(
      () => void memdumpTick().catch((err: unknown) => log.warn(`[memória] ${reason(err)}`)),
      memdumpTiming.tickMs,
    );
    timer.unref();
  }
  registerQueueWaker('memdump', wakeAnalysis);
  wakeAnalysis();
}

/** Chaves dos dumps de uma amostra (a lixeira apaga junto). */
export async function memdumpKeysOf(entryId: string): Promise<string[]> {
  const rows = await prisma.sandboxMemoryDump.findMany({
    where: { session: { entryId }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  return rows.map((r) => r.storageKey!);
}
