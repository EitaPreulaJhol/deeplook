import { sandboxEnabled } from '../env';
import { recordEvent } from './events';
import { log, reason } from './log';
import { prisma } from './prisma';
import { sampleFileName } from './sandbox';
import { guestIsWindows, guestRun } from './sandbox-artifacts';

/**
 * Execucao automatica da amostra no ambiente isolado. Pedida pelo analista ao abrir o ambiente
 * (uma caixa no painel): depois do boot, com o qemu-guest-agent respondendo e o Sysmon no ar, o
 * DeepLook roda a amostra NA SESSAO DO USUARIO LOGADO da VM, para ela aparecer no console e nos
 * prints, como quando o analista a roda a mao. Agiliza a analise rapida: abrir, esperar, ler.
 *
 * O agente executa como SYSTEM, na sessao 0 (sem tela). Dali, uma tarefa agendada interativa
 * (LogonType Interactive, sem senha) leva a execucao para a sessao do usuario do console; e o
 * mesmo caminho validado contra o Proxmox real (scripts/sandbox-real-check.mjs). A amostra e
 * copiada do CD para a pasta temporaria do usuario e aberta pela associacao do Windows (o .ps1 pelo
 * PowerShell e o .msi pelo msiexec: o padrao seria abrir num editor). Sem usuario logado, roda como
 * SYSTEM (nao aparece na tela, mas os artefatos e o Sysmon a veem).
 *
 * So Windows. Sem o Sysmon no template, roda depois de uma espera, e a tela avisa.
 */

/** Tempos da execucao automatica; os testes os encurtam. */
export const autoRunTiming = {
  /** De quanto em quanto tempo conferir os ambientes que esperam. */
  tickMs: 10_000,
  /** Quanto esperar o Sysmon aparecer depois que o agente responde (a tarefa do template). */
  sysmonWaitMs: 3 * 60_000,
  /** Quanto esperar o agente responder depois de ligar a VM (o boot do Windows). */
  agentWaitMs: 10 * 60_000,
};

const SYSMON_CHANNEL = 'Microsoft-Windows-Sysmon/Operational';

/** PowerShell em Base64 (UTF-16LE), como o -EncodedCommand pede: sem aspas a escapar. */
const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
const psQuote = (text: string) => `'${text.replace(/'/g, "''")}'`;

function powershell(script: string): string[] {
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encode(script),
  ];
}

/** O canal do Sysmon existe? (o marcador identifica o comando no Proxmox simulado). */
export function sysmonProbeCommand(): string[] {
  return powershell(
    [
      '# DEEPLOOK_SYSMON_PROBE',
      `if (Get-WinEvent -ListLog ${psQuote(SYSMON_CHANNEL)} -ErrorAction SilentlyContinue) { 'SYSMON_OK' } else { 'SYSMON_AUSENTE' }`,
    ].join('\n'),
  );
}

/**
 * O que roda na sessao do usuario: acha a amostra no CD, copia para %TEMP%\deeplook e a abre. Sai
 * com 3 se a amostra nao estiver no CD.
 */
export function launcherScript(fileName: string): string {
  return [
    `$name = ${psQuote(fileName)}`,
    '$src = Get-PSDrive -PSProvider FileSystem | ForEach-Object { Join-Path $_.Root $name } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
    'if (-not $src) { exit 3 }',
    "$dir = Join-Path $env:TEMP 'deeplook'",
    'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
    '$dst = Join-Path $dir $name',
    'Copy-Item -LiteralPath $src -Destination $dst -Force',
    'switch ([IO.Path]::GetExtension($dst).ToLower()) {',
    "  '.ps1' { Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('\"' + $dst + '\"') }",
    "  '.msi' { Start-Process msiexec.exe -ArgumentList '/i', ('\"' + $dst + '\"') }",
    '  default { Start-Process -FilePath $dst }',
    '}',
  ].join('\n');
}

/**
 * O comando do agente (como SYSTEM): registra uma tarefa interativa para o usuario do console,
 * dispara, espera o lancador terminar (ele so copia e abre; a amostra segue rodando) e apaga a
 * tarefa. Responde AUTORUN_OK|<usuario>, AUTORUN_SEM_AMOSTRA ou AUTORUN_FALHOU|<codigo>.
 */
export function autoRunCommand(fileName: string): string[] {
  const launcher = encode(launcherScript(fileName));
  const args = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${launcher}`;
  return powershell(
    [
      '# DEEPLOOK_AUTORUN',
      `$name = ${psQuote(fileName)}`,
      '$found = Get-PSDrive -PSProvider FileSystem | ForEach-Object { Join-Path $_.Root $name } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
      "if (-not $found) { 'AUTORUN_SEM_AMOSTRA'; exit 0 }",
      '$user = (Get-CimInstance Win32_ComputerSystem).UserName',
      'if (-not $user) {',
      `  Start-Process powershell.exe -ArgumentList ${psQuote(args)} -WindowStyle Hidden`,
      "  'AUTORUN_OK|SYSTEM'; exit 0",
      '}',
      "$task = 'DeepLookAutoRun'",
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(args)}`,
      '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
      'Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force | Out-Null',
      'Start-ScheduledTask -TaskName $task',
      'Start-Sleep -Seconds 2',
      "for ($i = 0; $i -lt 10 -and (Get-ScheduledTask -TaskName $task).State -eq 'Running'; $i++) { Start-Sleep -Seconds 1 }",
      '$code = (Get-ScheduledTaskInfo -TaskName $task).LastTaskResult',
      'Unregister-ScheduledTask -TaskName $task -Confirm:$false',
      "if ($code -ne 0) { 'AUTORUN_FALHOU|' + $code; exit 0 }",
      "'AUTORUN_OK|' + $user",
    ].join('\n'),
  );
}

type Waiting = {
  id: string;
  entryId: string;
  analystId: string;
  node: string;
  vmid: number | null;
  startedAt: Date | null;
  createdAt: Date;
  entry: { originalFilename: string | null };
};

/** Quando o agente respondeu pela primeira vez, por ambiente (conta a espera do Sysmon). */
const agentSince = new Map<string, number>();

async function fail(s: Waiting, error: string): Promise<void> {
  agentSince.delete(s.id);
  await prisma.sandboxSession.update({
    where: { id: s.id },
    data: { autoRun: 'FAILED', autoRunError: error.slice(0, 300), autoRunAt: new Date() },
  });
  log.warn(`[sandbox] execução automática do ambiente ${s.id} falhou: ${error}`);
}

/** Um ambiente esperando: confere o agente e o Sysmon e, quando der, roda a amostra. */
async function step(s: Waiting, now: number): Promise<void> {
  if (!s.vmid) return;
  const since = (s.startedAt ?? s.createdAt).getTime();

  let windows: boolean;
  try {
    windows = await guestIsWindows(s.node, s.vmid);
  } catch {
    // Ainda dando boot (ou o agente nao esta no template): espera ate o limite.
    if (now - since > autoRunTiming.agentWaitMs) {
      await fail(s, 'o agente da VM não respondeu a tempo; a amostra não foi executada');
    }
    return;
  }
  if (!windows) {
    await fail(s, 'a execução automática é só para VMs Windows');
    return;
  }
  if (!agentSince.has(s.id)) agentSince.set(s.id, now);

  const probe = await guestRun(s.node, s.vmid, sysmonProbeCommand(), 'a conferência do Sysmon')
    .then((out) => out.trim())
    .catch(() => '');
  const sysmon = probe.includes('SYSMON_OK');
  if (!sysmon && now - agentSince.get(s.id)! < autoRunTiming.sysmonWaitMs) return;

  // Uma vez so: quem marca RUNNING executa.
  const claimed = await prisma.sandboxSession.updateMany({
    where: { id: s.id, autoRun: 'PENDING', status: 'RUNNING' },
    data: { autoRun: 'RUNNING' },
  });
  if (!claimed.count) return;
  agentSince.delete(s.id);

  let out: string;
  try {
    out = await guestRun(
      s.node,
      s.vmid,
      autoRunCommand(sampleFileName(s.entry)),
      'a execução da amostra',
    );
  } catch (err) {
    await fail(s, `o agente da VM falhou: ${reason(err).slice(0, 160)}`);
    return;
  }
  const line = out.trim().split(/\r?\n/).at(-1) ?? '';
  if (line === 'AUTORUN_SEM_AMOSTRA') {
    await fail(s, 'a amostra não foi encontrada no CD da VM');
    return;
  }
  const failed = /^AUTORUN_FALHOU\|(-?\d+)/.exec(line);
  if (failed) {
    await fail(s, `a tarefa que abre a amostra terminou com o código ${failed[1]}`);
    return;
  }
  const ok = /^AUTORUN_OK\|(.+)$/.exec(line);
  if (!ok) {
    await fail(s, 'resposta inesperada da VM ao executar a amostra');
    return;
  }
  const user = ok[1].trim().slice(0, 120);
  await prisma.sandboxSession.update({
    where: { id: s.id },
    data: { autoRun: 'DONE', autoRunAt: new Date(), autoRunUser: user, autoRunSysmon: sysmon },
  });
  // No historico da amostra: quem pediu (o analista do ambiente), em que conta e se com o Sysmon.
  await recordEvent(prisma, {
    entryId: s.entryId,
    actorId: s.analystId,
    type: 'SANDBOX_AUTORUN',
    toValue: sysmon ? 'sysmon' : 'no-sysmon',
    detail: user,
  });
  log.info(
    `[sandbox] amostra executada no ambiente ${s.id} (${user}, Sysmon ${sysmon ? 'sim' : 'não'})`,
  );
}

let running = false;

/** Uma rodada: os ambientes em execucao que pediram e ainda nao rodaram. Nunca lanca. */
export async function autoRunTick(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const waiting = await prisma.sandboxSession.findMany({
      where: { status: 'RUNNING', autoRun: 'PENDING', vmid: { not: null } },
      select: {
        id: true,
        entryId: true,
        analystId: true,
        node: true,
        vmid: true,
        startedAt: true,
        createdAt: true,
        entry: { select: { originalFilename: true } },
      },
    });
    for (const s of waiting) {
      await step(s, now).catch((err: unknown) =>
        log.warn(`[sandbox] execução automática do ambiente ${s.id}: ${reason(err)}`),
      );
    }
  } finally {
    running = false;
  }
}

/** Liga a conferencia periodica (so com o sandbox ligado). Ambiente que caiu no meio volta a esperar. */
export async function startAutoRun(): Promise<void> {
  if (!sandboxEnabled) return;
  // A API caiu no meio de uma execucao: nao se sabe se a amostra rodou; melhor avisar que falhou.
  await prisma.sandboxSession.updateMany({
    where: { autoRun: 'RUNNING' },
    data: {
      autoRun: 'FAILED',
      autoRunError: 'a API reiniciou durante a execução; confira no console se a amostra rodou',
      autoRunAt: new Date(),
    },
  });
  const timer = setInterval(() => void autoRunTick(), autoRunTiming.tickMs);
  timer.unref();
}
