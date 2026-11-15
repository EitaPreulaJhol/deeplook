#!/usr/bin/env node
// Teste do sandbox contra o Proxmox (e o MikroTik CHR) de verdade, na parte que nao precisa de mao
// na VM (plano pos-revisao, 5.5; o roteiro completo fica nos planos locais, fora do Git).
//
//   node scripts/sandbox-real-check.mjs               roteiro inteiro (abre e encerra um ambiente)
//   node scripts/sandbox-real-check.mjs --read-only   so a fase 0: confere o PVE e o DeepLook, sem
//                                                     criar nada
//   node scripts/sandbox-real-check.mjs --keep        nao manda a amostra de teste para a lixeira
//   node scripts/sandbox-real-check.mjs --auto-run    a amostra roda pela execucao automatica do
//                                                     DeepLook (a caixa do painel), nao pelo script
//   node scripts/sandbox-real-check.mjs --stress      a amostra ocupa todos os nucleos da VM por
//                                                     4 min antes do resto, como malware pesado (o
//                                                     agente da VM demora a responder)
//   CHECK_BOOT_WAIT_S=180 node scripts/...            quanto esperar o boot ate o agente responder
//                                                     (padrao 480 s)
//
// Le o .env da raiz (variaveis do ambiente valem mais). O DeepLook e usado pela propria API, como um
// analista (DEEPLOOK_BASE, padrao http://localhost:WEB_PORT; CHECK_EMAIL e CHECK_PASSWORD, padrao o
// ADMIN_EMAIL e o ADMIN_PASSWORD). O Proxmox e lido direto so para conferir por fora; a unica
// escrita nele e o agent/exec que roda a amostra na VM do teste.
//
// O TEMPLATE NUNCA E ALTERADO: qualquer escrita no PROXMOX_TEMPLATE_VMID (ou em VM que seja
// template) e recusada aqui, e o fim confere que a configuracao dele ficou identica (digest).
// Nenhum segredo vai para a saida.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const READ_ONLY = args.has('--read-only');
const KEEP = args.has('--keep');
/** A amostra roda pela execucao automatica do DeepLook (a caixa do painel), nao pelo script. */
const AUTO_RUN = args.has('--auto-run');
/** A amostra ocupa todos os nucleos da VM por 4 min (o agente tem de responder mesmo assim). */
const STRESS = args.has('--stress');

// ------------------------------------------------------------------ configuracao

function loadDotEnv() {
  const file = join(ROOT, '.env');
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}
const dotenv = loadDotEnv();
function cfg(name, fallback = '') {
  const file = process.env[`${name}_FILE`] ?? dotenv[`${name}_FILE`];
  if (file && existsSync(file)) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  return process.env[name] ?? dotenv[name] ?? fallback;
}

const PVE = {
  url: cfg('PROXMOX_API_URL').replace(/\/+$/, ''),
  node: cfg('PROXMOX_NODE', 'pve'),
  user: cfg('PROXMOX_USER'),
  password: cfg('PROXMOX_PASSWORD'),
  template: Number(cfg('PROXMOX_TEMPLATE_VMID', '0')),
  isoStorage: cfg('PROXMOX_ISO_STORAGE', 'local'),
  verifyTls: cfg('PROXMOX_VERIFY_TLS', 'false') === 'true',
  tag: cfg('SANDBOX_TAG', 'deeplook-sandbox'),
};
const DL = {
  base: (cfg('DEEPLOOK_BASE') || `http://localhost:${cfg('WEB_PORT', '8080')}`).replace(/\/+$/, ''),
  email: cfg('CHECK_EMAIL') || cfg('ADMIN_EMAIL'),
  password: cfg('CHECK_PASSWORD') || cfg('ADMIN_PASSWORD'),
};
const INTERVAL_S = Number(cfg('SANDBOX_ARTIFACT_INTERVAL_S', '60')) || 60;
/** Boot do Windows ate o qemu-guest-agent responder (mais uma coleta de folga). */
const BOOT_WAIT_MS = (Number(cfg('CHECK_BOOT_WAIT_S', '480')) + INTERVAL_S) * 1000;

// ------------------------------------------------------------------ relatorio

const results = [];
const started = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
function record(step, level, status, measure = '', note = '') {
  results.push({ step, level, status, measure, note });
  const mark = status === 'ok' ? 'ok    ' : status === 'pulado' ? 'pulado' : 'FALHA ';
  console.log(`${mark} ${step} [${level}] ${measure ? `(${measure}) ` : ''}${note}`);
}
const check = (step, level, cond, measure = '', note = '') =>
  record(step, level, cond ? 'ok' : 'falha', measure, note);
const skip = (step, level, note) => record(step, level, 'pulado', '', note);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs, everyMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(everyMs);
  }
}

// ------------------------------------------------------------------ Proxmox (leitura + guarda)

let ticket = null;
let testVmid = null;

/** A unica escrita permitida: o agent/exec na VM do teste. Nunca no template. */
function guard(method, path) {
  if (method === 'GET') return;
  if (path === '/access/ticket') return;
  const vm = /\/qemu\/(\d+)(\/[^?]*)?/.exec(path);
  const vmid = vm ? Number(vm[1]) : null;
  if (vmid === PVE.template) throw new Error(`guarda: escrita no template (${method} ${path})`);
  const allowed =
    vmid !== null && vmid === testVmid && /^\/agent\/exec$/.test(vm[2] ?? '') && method === 'POST';
  if (!allowed) throw new Error(`guarda: escrita não prevista no PVE (${method} ${path})`);
}

function pveRequest(method, path, form) {
  guard(method, path);
  return new Promise((resolve, reject) => {
    const url = new URL(`${PVE.url}/api2/json${path}`);
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const headers = { Accept: 'application/json' };
    if (ticket) headers.Cookie = `PVEAuthCookie=${ticket.ticket}`;
    if (ticket && method !== 'GET') headers.CSRFPreventionToken = ticket.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method, headers, rejectUnauthorized: PVE.verifyTls, timeout: 30_000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* corpo que nao e JSON */
          }
          if (res.statusCode >= 400) {
            const err = new Error(`PVE ${res.statusCode} em ${method} ${path}`);
            err.status = res.statusCode;
            err.pveMessage = `PVE ${res.statusCode}: ${json?.message ?? text.slice(0, 200)}`.trim();
            reject(err);
          } else resolve(json?.data ?? null);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`PVE sem resposta em ${method} ${path}`)));
    req.on('error', reject);
    req.end(body);
  });
}
const pveGet = (path) => pveRequest('GET', path);

async function pveLogin() {
  const data = await pveRequest('POST', '/access/ticket', {
    username: PVE.user,
    password: PVE.password,
  });
  ticket = { ticket: data.ticket, csrf: data.CSRFPreventionToken };
}

async function templateState() {
  const config = await pveGet(`/nodes/${PVE.node}/qemu/${PVE.template}/config`);
  return {
    digest: config?.digest ?? null,
    template: String(config?.template ?? '0') === '1',
    config,
  };
}

async function agentRun(vmid, command, timeoutMs = 120_000) {
  // O PVE recebe o comando como `command` repetido no formulario (um item por argumento).
  const params = new URLSearchParams();
  for (const part of command) params.append('command', part);
  const pid = await pveRawForm('POST', `/nodes/${PVE.node}/qemu/${vmid}/agent/exec`, params);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await pveGet(`/nodes/${PVE.node}/qemu/${vmid}/agent/exec-status?pid=${pid.pid}`);
    if (status?.exited) return status;
    if (Date.now() > deadline) throw new Error('a execução na VM não terminou a tempo');
    await sleep(1000);
  }
}

/** POST com formulario ja montado (para repetir `command`). */
function pveRawForm(method, path, params) {
  guard(method, path);
  return new Promise((resolve, reject) => {
    const url = new URL(`${PVE.url}/api2/json${path}`);
    const body = params.toString();
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          Cookie: `PVEAuthCookie=${ticket.ticket}`,
          CSRFPreventionToken: ticket.csrf,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        rejectUnauthorized: PVE.verifyTls,
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400)
            reject(new Error(`PVE ${res.statusCode} em ${method} ${path}`));
          else resolve(JSON.parse(text).data);
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ------------------------------------------------------------------ DeepLook (como analista)

let cookie = '';
async function dl(method, path, body) {
  const headers = { cookie, 'accept-language': 'pt-BR' };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${DL.base}/api${path}`, { method, headers, body: payload });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* nao JSON */
  }
  return { status: res.status, json };
}

const STRESS_LINES = `# --stress: dois processos por nucleo girando por 4 min, como malware pesado.
1..([Environment]::ProcessorCount * 2) | ForEach-Object { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', '$s = [Diagnostics.Stopwatch]::StartNew(); while ($s.Elapsed.TotalSeconds -lt 240) { }' }
`;
const SAMPLE = `# Amostra inofensiva do teste real do DeepLook (scripts/sandbox-real-check.mjs).
${STRESS ? STRESS_LINES : ''}nslookup deeplook-teste.invalid 2>$null | Out-Null
Resolve-DnsName deeplook-teste.invalid -ErrorAction SilentlyContinue | Out-Null
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 http://testmynids.org/uid/index.html | Out-Null } catch {}
Set-Content -Path "$env:PUBLIC\\deeplook-teste.txt" -Value 'teste do DeepLook'
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
if (-not (Test-Path $run)) { New-Item -Path $run -Force | Out-Null }
New-ItemProperty -Path $run -Name DeepLookTeste -Value 'notepad.exe' -Force | Out-Null
Start-Process notepad.exe
`;

/**
 * Estado do Microsoft Defender na VM e as deteccoes (eventos 1116 e 1117 do log dele) da ultima
 * hora, em JSON. So leitura.
 */
const DEFENDER_COMMAND = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(
    [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$s = Get-MpComputerStatus -ErrorAction SilentlyContinue',
      "$e = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; Id = 1116,1117; StartTime = (Get-Date).AddHours(-1) } -MaxEvents 10 -ErrorAction SilentlyContinue",
      '$d = @(foreach ($x in $e) { [pscustomobject]@{ id = $x.Id; text = (($x.Message -split "`n" | Where-Object { $_ -match "Nome:|Name:|Caminho:|Path:|Ação|Action:" }) -join " ").Trim() } })',
      'ConvertTo-Json -Compress -Depth 3 -InputObject ([pscustomobject]@{ realTime = $(if ($s) { $s.RealTimeProtectionEnabled } else { $null }); signatures = $(if ($s -and $s.AntivirusSignatureLastUpdated) { $s.AntivirusSignatureLastUpdated.ToString("yyyy-MM-dd HH:mm") } else { $null }); detections = $d })',
    ].join('\n'),
    'utf16le',
  ).toString('base64'),
];

/**
 * Acha a amostra no CD-ROM e a roda NA SESSAO DO USUARIO LOGADO, para ela aparecer na tela (e nos
 * prints), como quando o analista a roda pelo console. O agente executa como SYSTEM, na sessao 0,
 * sem area de trabalho: dali, uma tarefa agendada interativa (LogonType Interactive, sem senha)
 * leva a execucao para a sessao do usuario do console. Sem usuario logado, roda como SYSTEM.
 */
const RUN_SAMPLE_SCRIPT = [
  "$f = Get-PSDrive -PSProvider FileSystem | ForEach-Object { Join-Path $_.Root 'deeplook-teste.ps1' } | Where-Object { Test-Path $_ } | Select-Object -First 1",
  "if (-not $f) { 'SEM_AMOSTRA'; exit 3 }",
  '$user = (Get-CimInstance Win32_ComputerSystem).UserName',
  "if (-not $user) { & $f; 'AMOSTRA_OK como SYSTEM (nenhum usuario logado)'; exit 0 }",
  "$name = 'DeepLookAmostraTeste'",
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File \"' + $f + '\"')",
  '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
  'Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Force | Out-Null',
  'Start-ScheduledTask -TaskName $name',
  'Start-Sleep -Seconds 3',
  "for ($i = 0; $i -lt 60 -and (Get-ScheduledTask -TaskName $name).State -eq 'Running'; $i++) { Start-Sleep -Seconds 1 }",
  '$result = (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult',
  'Unregister-ScheduledTask -TaskName $name -Confirm:$false',
  "if ($result -ne 0) { 'AMOSTRA_FALHOU na sessao de ' + $user + ' (codigo ' + $result + ')'; exit 4 }",
  "'AMOSTRA_OK na sessao de ' + $user",
].join('; ');
const RUN_SAMPLE = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  RUN_SAMPLE_SCRIPT,
];

// ------------------------------------------------------------------ roteiro

let sessionId = null;
let entryId = null;
let templateBefore = null;
let role = null;
/** O ambiente chegou a rodar (so entao a VM, os artefatos e a limpeza dela sao cobrados). */
let reachedRunning = false;
/** VMID que o DeepLook reservou para o ambiente (mesmo se o clone falhou). */
let reservedVmid = null;
/** A lista de processos chegou a ser coletada (o 6.4 so a cobra entao). */
let gotProcesses = false;

async function phase0() {
  if (!PVE.url || !PVE.user || !PVE.password || !PVE.template) {
    throw new Error(
      'PROXMOX_API_URL, PROXMOX_USER, PROXMOX_PASSWORD e PROXMOX_TEMPLATE_VMID são necessários',
    );
  }
  await pveLogin();
  const version = await pveGet('/version');
  check('0.1 PVE acessível', 'O', Boolean(version?.version), `PVE ${version?.version}`);

  templateBefore = await templateState();
  check(
    '0.1 template existe e é template',
    'O',
    templateBefore.template,
    `VM ${PVE.template}`,
    `tags: ${templateBefore.config?.tags ?? '(nenhuma)'}`,
  );
  const disks = Object.keys(templateBefore.config ?? {}).filter((k) =>
    /^(scsi|virtio|sata|ide)\d+$/.test(k),
  );
  const nets = Object.keys(templateBefore.config ?? {}).filter((k) => /^net\d+$/.test(k));
  check(
    '0.1 template com disco e placa de rede',
    'O',
    disks.length > 0 && nets.length > 0,
    `${disks.join(',')} · ${nets.join(',')}`,
  );
  check(
    '0.1 template com o agente ligado na configuração',
    'O',
    /(^|,)\s*(enabled=)?1/.test(String(templateBefore.config?.agent ?? '')),
    `agent: ${templateBefore.config?.agent ?? '(ausente)'}`,
  );

  const perms = (await pveGet('/access/permissions?path=/vms').catch(() => null)) ?? {};
  const vms = perms['/vms'] ?? {};
  const agentPerm =
    Number(String(version?.version).split('.')[0]) >= 9
      ? 'VM.GuestAgent.Unrestricted'
      : 'VM.Monitor';
  const needed = [
    'VM.Clone',
    'VM.Allocate',
    'VM.Config.CDROM',
    'VM.PowerMgmt',
    'VM.Console',
    agentPerm,
  ];
  const missing = needed.filter((p) => !vms[p]);
  check(
    '0.2 permissões efetivas em /vms',
    'O',
    missing.length === 0,
    '',
    missing.length ? `faltam: ${missing.join(', ')}` : needed.join(', '),
  );

  const storage = await pveGet(`/nodes/${PVE.node}/storage/${PVE.isoStorage}/status`).catch(
    () => null,
  );
  check(
    '0.1 storage da ISO aceita iso',
    'O',
    String(storage?.content ?? '')
      .split(',')
      .includes('iso'),
    PVE.isoStorage,
  );

  const list = (await pveGet(`/nodes/${PVE.node}/qemu`)) ?? [];
  const tagged = list.filter(
    (vm) =>
      vm.vmid !== PVE.template &&
      !vm.template &&
      ((vm.tags ?? '').split(';').includes(PVE.tag) || (vm.name ?? '').startsWith(`${PVE.tag}-`)),
  );
  check(
    '0.5 nenhuma VM com a etiqueta do sandbox (além do template)',
    'D',
    tagged.length === 0,
    '',
    // A limpeza da subida so apaga as que tem a marca da instancia (etiqueta dl-<id>); as de outra
    // instancia no mesmo Proxmox podem ser um ambiente dela em uso.
    tagged.length
      ? `já no Proxmox (de alguma instância): ${tagged.map((v) => `${v.vmid} ${v.name} [${v.tags ?? ''}]`).join('; ')}`
      : '',
  );
  const isos = (
    (await pveGet(`/nodes/${PVE.node}/storage/${PVE.isoStorage}/content?content=iso`).catch(
      () => [],
    )) ?? []
  ).filter((i) => /\/deeplook-/.test(i.volid));
  check(
    '0.5 nenhuma ISO deeplook-* esquecida',
    'D',
    isos.length === 0,
    '',
    isos.map((i) => i.volid).join(', '),
  );

  // DeepLook.
  const login = await dl('POST', '/auth/login', { email: DL.email, password: DL.password }).catch(
    (e) => ({ status: 0, json: { error: String(e) } }),
  );
  const user = login.json?.user;
  check(
    '0.0 login no DeepLook',
    'O',
    login.status === 200 && user && !user.mustChangePassword,
    DL.base,
    login.status === 200
      ? user?.mustChangePassword
        ? 'a conta precisa trocar a senha'
        : `papel ${user?.role}`
      : `HTTP ${login.status}: ${login.json?.error ?? ''}`,
  );
  if (login.status !== 200 || !user || user.mustChangePassword) return false;
  role = user.role;
  if (user.role === 'ADMIN') {
    const health = await dl('GET', '/sandbox/health');
    const bad = (health.json?.checks ?? []).filter((c) => !c.ok && c.name !== 'modo-mock');
    check(
      '0.1 /api/sandbox/health',
      'O',
      health.status === 200 && bad.length === 0,
      '',
      bad.map((c) => `${c.name}: ${c.detail}`).join('; '),
    );
    const status = await dl('GET', '/admin/status');
    // So o que o sandbox usa: os outros servicos (capa, Ghidra...) podem estar desligados.
    const SANDBOX_CHECKS = ['api', 'database', 'storage', 'sandbox', 'netcap', 'suricata'];
    const errors = (status.json?.checks ?? []).filter(
      (c) => c.level === 'error' && SANDBOX_CHECKS.includes(c.id),
    );
    check(
      '0.3 status do sistema sem erro',
      'O',
      status.status === 200 && errors.length === 0,
      '',
      errors.map((c) => `${c.name}: ${c.summary}`).join('; '),
    );
  } else {
    skip('0.1 /api/sandbox/health', 'O', 'precisa de um admin (CHECK_EMAIL)');
  }
  return true;
}

async function runEnvironment() {
  // Amostra de teste.
  const form = new FormData();
  form.append('file', new Blob([SAMPLE], { type: 'text/plain' }), 'deeplook-teste.ps1');
  form.append('title', `Teste do sandbox real ${new Date().toISOString().slice(0, 16)}`);
  form.append('tags', 'teste-sandbox');
  const up = await dl('POST', '/entries/file', form);
  entryId = up.json?.entry?.id;
  check(
    '1.0 amostra de teste enviada',
    'O',
    up.status === 201 && entryId,
    '',
    up.status === 201 ? '' : `HTTP ${up.status}: ${up.json?.error ?? ''}`,
  );
  if (!entryId) return;

  // 1. Provisionamento.
  const t0 = Date.now();
  const open = await dl('POST', `/entries/${entryId}/sandbox`, { autoRun: AUTO_RUN });
  sessionId = open.json?.session?.id;
  if (!sessionId) {
    check('1.1 ambiente aberto', 'O', false, '', `HTTP ${open.status}: ${open.json?.error ?? ''}`);
    return;
  }
  const phases = [];
  const running = await until(
    async () => {
      const d = await dl('GET', `/sandbox/${sessionId}`);
      const s = d.json?.session;
      if (s?.phase && phases.at(-1) !== s.phase) phases.push(s.phase);
      if (s?.status === 'FAILED') return { failed: s.lastError ?? 'falhou' };
      return s?.status === 'RUNNING' ? s : null;
    },
    20 * 60_000,
    2000,
  );
  check(
    '1.1 ambiente em execução',
    'O',
    running && !running.failed,
    secs(Date.now() - t0),
    running?.failed ?? phases.join(' → '),
  );
  reservedVmid = (await dl('GET', `/sandbox/${sessionId}`)).json?.session?.vmid ?? null;
  if (!running || running.failed) return;
  testVmid = running.vmid;
  reachedRunning = true;

  const config = await pveGet(`/nodes/${PVE.node}/qemu/${testVmid}/config`);
  const disk = Object.entries(config).find(([k]) => /^(scsi|virtio|sata)\d+$/.test(k));
  check(
    '1.3 linked clone',
    'D',
    disk && String(disk[1]).includes(`base-${PVE.template}-`),
    String(disk?.[1] ?? '').split(',')[0],
  );
  check(
    '1.4 ISO como CD-ROM',
    'O',
    /deeplook-.*\.iso.*media=cdrom/.test(String(config.ide2 ?? '')),
    String(config.ide2 ?? '(sem ide2)'),
  );
  check(
    '1.5a VM com a etiqueta desta instância (a limpeza só apaga as dela)',
    'O',
    /(^|;)dl-[a-f0-9]{8}(;|$)/.test(String(config.tags ?? '')) &&
      /deeplook-[a-f0-9]{8}-/.test(String(config.ide2 ?? '')),
    String(config.tags ?? '(sem etiquetas)'),
  );
  check(
    '1.x a VM do teste não é o template',
    'O',
    testVmid !== PVE.template && String(config.template ?? '0') !== '1',
    `VM ${testVmid}`,
  );

  const first = await dl('GET', `/sandbox/${sessionId}/artifacts`);
  if (first.json?.captureEnabled) {
    check(
      '1.5 captura aberta antes de ligar',
      'O',
      first.json.network?.status === 'CAPTURING',
      '',
      first.json.network?.error ?? '',
    );
  } else skip('1.5 captura aberta antes de ligar', 'O', 'captura de rede não configurada');

  // 2. Console.
  const consoleRes = await dl('GET', `/sandbox/${sessionId}/console`);
  if (consoleRes.status === 200) {
    const ws = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'ws-console-check.mjs'), sessionId, cookie],
      {
        env: { ...process.env, DEEPLOOK_BASE: DL.base },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    check(
      '2.2 console: handshake RFB e senha VNC',
      'D',
      ws.status === 0,
      '',
      `${ws.stdout ?? ''}\n${ws.stderr ?? ''}`
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-3)
        .join(' / ')
        .slice(0, 400),
    );
  } else skip('2.2 console', 'D', `HTTP ${consoleRes.status}: ${consoleRes.json?.error ?? ''}`);

  // 2.3 / 3.1 Artefatos.
  const t1 = Date.now();
  const arts = await until(
    async () => {
      const a = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
      // O agente so responde depois do boot do Windows: espera a lista de processos (o aviso do
      // agente durante o boot nao e falha).
      return a?.screenshots?.length && a.processes ? a : null;
    },
    BOOT_WAIT_MS,
    5000,
  );
  gotProcesses = Boolean(arts?.processes);
  // Sem o agente ate o fim da espera: o print e o motivo vem do estado atual.
  const current = arts ?? (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
  if (!arts) {
    // O que o proprio PVE diz do agente (so leitura): a mensagem crua, sem o resumo do DeepLook.
    for (const probe of ['agent/info', 'agent/get-osinfo']) {
      const answer = await pveGet(`/nodes/${PVE.node}/qemu/${testVmid}/${probe}`).then(
        (d) => `ok: ${JSON.stringify(d).slice(0, 160)}`,
        (e) => String(e.pveMessage ?? e.message).slice(0, 240),
      );
      record(`3.0 diagnóstico ${probe}`, 'D', 'pulado', '', answer);
    }
  }
  check(
    '2.3 print da tela',
    'O',
    current?.screenshots?.length > 0,
    secs(Date.now() - t1),
    `${current?.screenshots?.length ?? 0} print(s)`,
  );
  check(
    '3.1 lista de processos pelo agente',
    'O',
    Boolean(arts?.processes),
    `${current?.processes?.current?.length ?? 0} processo(s)`,
    arts ? '' : (current?.note ?? 'o agente não respondeu na espera do boot'),
  );
  if (!arts?.processes) return;

  // 4.0 O Sysmon no ar antes da amostra: no template ele e instalado a cada boot por uma tarefa
  // agendada (scripts/template-windows/sysmon.bat, 30 s depois do boot), e o que a amostra fizer
  // antes disso nao fica no log. Ausente depois de tres coletas: o template nao tem o Sysmon.
  const t3 = Date.now();
  const sysmonUp = await until(
    async () => {
      const a = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
      return a?.sysmon?.available ? a : null;
    },
    (INTERVAL_S * 3 + 30) * 1000,
    5000,
  );
  if (sysmonUp) record('4.0 Sysmon no ar antes da amostra', 'D', 'ok', secs(Date.now() - t3));
  else skip('4.0 Sysmon no ar antes da amostra', 'D', 'o Sysmon não apareceu em três coletas');

  // 3.2 / 4. Amostra rodando (pelo agent/exec do PVE, como SYSTEM).
  if (AUTO_RUN) {
    // O DeepLook roda a amostra sozinho (depois do agente e do Sysmon): o script so espera.
    const t4 = Date.now();
    const done = await until(
      async () => {
        const s = (await dl('GET', `/sandbox/${sessionId}`)).json?.session;
        return ['DONE', 'FAILED'].includes(s?.autoRun) ? s : null;
      },
      BOOT_WAIT_MS + 4 * 60_000,
      5000,
    );
    check(
      '3.2a amostra executada automaticamente pelo DeepLook',
      'O',
      done?.autoRun === 'DONE',
      secs(Date.now() - t4),
      done?.autoRun === 'DONE'
        ? `na sessão de ${done.autoRunUser}, Sysmon ${done.autoRunSysmon ? 'no ar' : 'fora'}`
        : (done?.autoRunError ?? 'não terminou a tempo'),
    );
    check(
      '3.2b na sessão do usuário (visível no console)',
      'D',
      done?.autoRunUser && done.autoRunUser !== 'SYSTEM',
      '',
      done?.autoRunUser ?? '',
    );
  } else {
    let ran = null;
    try {
      ran = await agentRun(testVmid, RUN_SAMPLE);
    } catch (err) {
      ran = { error: String(err.message ?? err) };
    }
    const out = Buffer.from(ran?.['out-data'] ?? '', 'utf8')
      .toString()
      .trim();
    check(
      '3.2a amostra executada na VM',
      'O',
      !ran?.error && out.includes('AMOSTRA_OK'),
      '',
      ran?.error ?? out.slice(-120),
    );
  }

  const t2 = Date.now();
  // Avisos do agente durante a espera (com --stress, a VM ocupada): cada um e uma coleta perdida.
  const notes = new Set();
  const after = await until(
    async () => {
      const a = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
      if (a?.note) notes.add(a.note);
      const appeared = (a?.processes?.appeared ?? []).map((p) => p.name.toLowerCase());
      // Com o Sysmon no ar, espera a leitura que ja traz a consulta da amostra.
      const sysmonReady =
        !sysmonUp ||
        (a?.sysmon?.available &&
          a.sysmon.dns?.some((d) => d.query.toLowerCase() === 'deeplook-teste.invalid'));
      return appeared.includes('notepad.exe') && sysmonReady ? a : null;
    },
    (INTERVAL_S * 4 + 30) * 1000,
    5000,
  );
  check('3.2 notepad.exe em "processos que surgiram"', 'O', Boolean(after), secs(Date.now() - t2));
  check(
    `3.3 o agente respondeu em todas as coletas${STRESS ? ' (VM com todos os núcleos ocupados)' : ''}`,
    'D',
    notes.size === 0,
    '',
    [...notes].join(' | ').slice(0, 300),
  );
  const final = after ?? (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
  const sm = final?.sysmon;
  if (!sm) {
    check('4.1 Sysmon lido', 'O', false, '', 'nenhuma leitura do Sysmon (guest não é Windows?)');
  } else if (!sm.available && /não instalado/.test(sm.reason)) {
    // O Sysmon e opcional (docs/proxmox.pt-BR.md, 2.1): sem ele, a fase 4 nao se aplica. Ainda assim
    // o comando rodou no Windows e achou a falta do canal, o que ja confere a leitura.
    skip('4.1 Sysmon lido', 'O', `${sm.reason} (opcional; a leitura rodou e detectou a falta)`);
  } else if (!sm.available) {
    check('4.1 Sysmon lido', 'O', false, '', sm.reason);
  } else {
    check('4.1 Sysmon lido', 'O', true, `${sm.events} evento(s)`);
    const ps = sm.processes.filter((p) => /powershell\.exe$/i.test(p.image));
    const tree = sm.processes.some(
      (p) => /notepad\.exe$/i.test(p.image) && ps.some((q) => q.pid === p.ppid),
    );
    check('4.2 árvore: powershell.exe → notepad.exe', 'O', tree);
    const names = sm.dns.map((d) => d.query.toLowerCase());
    check(
      '4.3 DNS deeplook-teste.invalid',
      'O',
      names.includes('deeplook-teste.invalid'),
      '',
      names.slice(0, 8).join(', '),
    );
    check('4.3 DNS testmynids.org', 'D', names.includes('testmynids.org'));
    check(
      '4.4 conexão para o testmynids.org',
      'D',
      sm.network.some((c) => c.dstPort === 80 && /testmynids/i.test(c.dstHost ?? '')) ||
        sm.network.some((c) => c.dstPort === 80),
    );
    check(
      '4.4 arquivo criado',
      'D',
      sm.files.some((f) => /deeplook-teste\.txt$/i.test(f.path)),
    );
    check(
      '4.4 chave Run',
      'D',
      sm.registry.some((r) => /\\Run\\DeepLookTeste$/i.test(r.key)),
    );
    const ind = (await dl('GET', `/entries/${entryId}/sandbox`)).json?.sysmonIndicators ?? [];
    check('4.6 IOCs sugeridos do Sysmon', 'O', ind.length > 0, '', ind.slice(0, 6).join(', '));
  }

  // 4.8 Linha do tempo (plans/sandbox-execucoes, fase 3): por padrao so a amostra e o que ela
  // abriu (pela arvore de processos do Sysmon), sem o ruido do Windows.
  const tl = (await dl('GET', `/sandbox/${sessionId}/timeline`)).json;
  const tlEvents = tl?.events ?? [];
  const tlAll = (await dl('GET', `/sandbox/${sessionId}/timeline?scope=all`)).json;
  check(
    '4.8 linha do tempo: só a amostra, com o notepad e a consulta DNS dela',
    'O',
    tl?.scope === 'sample' &&
      tl.sample?.found &&
      tlEvents.some((e) => e.kind === 'process' && /notepad\.exe$/i.test(e.image ?? '')) &&
      tlEvents.some((e) => e.kind === 'dns' && e.detail?.query === 'deeplook-teste.invalid') &&
      (tlAll?.total ?? 0) > (tl.total ?? 0),
    `${tl?.total ?? 0} de ${tlAll?.total ?? 0} evento(s)`,
    `amostra ${tl?.sample?.name ?? '?'}: ${tl?.sample?.processes ?? 0} processo(s)`,
  );
  const runs = (await dl('GET', `/entries/${entryId}/sandbox/sessions`)).json?.sessions ?? [];
  check(
    '4.9 histórico de execuções da amostra',
    'O',
    runs.some((r) => r.id === sessionId),
    `${runs.length} execução(ões)`,
  );

  // 4.7 Antivirus da VM (diagnostico, so leitura pelo agente): o Defender ligado no template barra
  // a amostra (o script abre e morre, sem nenhum efeito no Sysmon) e, com malware de verdade, a
  // analise inteira. Mostra o estado e as deteccoes do log do Defender desde o inicio do ambiente.
  try {
    const out = await agentRun(testVmid, DEFENDER_COMMAND);
    const info = JSON.parse(String(out['out-data'] ?? '').trim() || '{}');
    const found = (info.detections ?? []).map((d) => `${d.id} ${d.text}`);
    check(
      '4.7 antivírus da VM não barrou a amostra',
      'D',
      !found.length,
      info.realTime === true ? 'Defender ligado' : info.realTime === false ? 'Defender desligado' : 'Defender ausente',
      found.length
        ? found.join(' | ').slice(0, 400)
        : typeof info.signatures === 'string'
          ? `assinaturas de ${info.signatures}`
          : '',
    );
  } catch (err) {
    skip('4.7 antivírus da VM não barrou a amostra', 'D', `leitura falhou: ${err.message}`);
  }

  // 5.1 Captura durante o ambiente.
  if (final?.captureEnabled) {
    const st = (await dl('GET', '/admin/status')).json?.checks?.find((c) => c.id === 'netcap');
    check(
      '5.1 captura recebendo pacotes',
      'O',
      st && st.level !== 'error',
      '',
      st?.summary ?? 'sem permissão de admin',
    );
  } else skip('5.1 captura recebendo pacotes', 'O', 'captura de rede não configurada');
}

async function closeEnvironment() {
  if (!sessionId) return;
  const t = Date.now();
  await dl('DELETE', `/sandbox/${sessionId}`);
  const stopped = await until(
    async () => {
      const s = (await dl('GET', `/sandbox/${sessionId}`)).json?.session;
      return ['STOPPED', 'EXPIRED', 'FAILED'].includes(s?.status) ? s : null;
    },
    5 * 60_000,
    3000,
  );
  check(
    '6.0 ambiente encerrado',
    'O',
    reachedRunning ? stopped?.status === 'STOPPED' : Boolean(stopped),
    secs(Date.now() - t),
    stopped?.status ?? 'não encerrou',
  );
  if (!reachedRunning && reservedVmid && reservedVmid !== PVE.template) {
    // Provisionamento com falha: a VM reservada nao pode ter ficado no PVE.
    const leftover = await pveGet(`/nodes/${PVE.node}/qemu/${reservedVmid}/status/current`).then(
      () => true,
      () => false,
    );
    check('6.1 nenhuma VM sobrou do ambiente com falha', 'O', !leftover, `VM ${reservedVmid}`);
  }
  if (testVmid) {
    const gone = await until(
      () =>
        pveGet(`/nodes/${PVE.node}/qemu/${testVmid}/status/current`).then(
          () => null,
          (e) => (e.status ? true : null),
        ),
      120_000,
    );
    check('6.1 VM do teste destruída', 'O', Boolean(gone), `VM ${testVmid}`);
  }
  const isos =
    (await pveGet(`/nodes/${PVE.node}/storage/${PVE.isoStorage}/content?content=iso`).catch(
      () => [],
    )) ?? [];
  check('6.1 ISO do ambiente removida', 'O', !isos.some((i) => i.volid.includes(sessionId)));
  const arts = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
  if (reachedRunning) {
    check(
      '6.4 artefatos ficam depois do fim',
      'O',
      arts?.screenshots?.length > 0 && (!gotProcesses || Boolean(arts?.processes)),
      '',
      gotProcesses ? 'prints e processos' : 'só os prints (o agente não respondeu)',
    );
  } else skip('6.4 artefatos ficam depois do fim', 'O', 'o ambiente não chegou a rodar');

  if (arts?.captureEnabled && reachedRunning) {
    const net = await until(async () => {
      const a = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json;
      return a?.network && a.network.status !== 'CAPTURING' ? a.network : null;
    }, 120_000);
    check(
      '5.2 pcap guardado',
      'O',
      net?.status === 'STORED' && net.packets > 0,
      `${net?.packets ?? 0} pacote(s)`,
      net?.error ?? '',
    );
    const ids = await until(
      async () => {
        const n = (await dl('GET', `/sandbox/${sessionId}/artifacts`)).json?.network?.ids;
        return n && ['DONE', 'FAILED'].includes(n.status) ? n : null;
      },
      15 * 60_000,
      5000,
    );
    const sids = (ids?.result?.alerts ?? []).map((a) => a.sid);
    check(
      '5.4 Suricata: alerta da regra de teste',
      'O',
      ids?.status === 'DONE' && sids.includes(9900001),
      ids?.ms ? secs(ids.ms) : '',
      ids?.error ?? '',
    );
    check(
      '5.4 Suricata: alerta ET do testmynids.org',
      'D',
      sids.some((s) => s !== 9900001),
    );
  } else {
    skip('5.2 pcap guardado', 'O', 'captura de rede não configurada');
    skip('6.2 sniffer sem o MAC', 'O', 'captura de rede não configurada');
  }
}

async function finish() {
  // O template ficou exatamente igual.
  if (ticket && templateBefore) {
    const now = await templateState().catch(() => null);
    check(
      '9.9 template intacto (mesmo digest da configuração)',
      'O',
      now && now.template && now.digest === templateBefore.digest,
      `VM ${PVE.template}`,
    );
  }
  if (entryId && !KEEP && role !== 'ADMIN') {
    skip(
      '9.0 amostra de teste para a lixeira',
      'D',
      'a lixeira é só de admin: mande a amostra "Teste do sandbox real" para a lixeira pela tela',
    );
  } else if (entryId && !KEEP) {
    const trashed = await dl('POST', `/entries/${entryId}/trash`, {});
    check(
      '9.0 amostra de teste para a lixeira',
      'D',
      trashed.status < 300,
      '',
      trashed.status < 300 ? '' : `HTTP ${trashed.status}`,
    );
  }
}

// ------------------------------------------------------------------ principal

let ok = false;
try {
  console.log(
    `Teste do sandbox real · ${new Date().toISOString()} · ${READ_ONLY ? 'só leitura' : 'roteiro inteiro'}\n`,
  );
  ok = await phase0();
  if (!READ_ONLY && ok) await runEnvironment();
} catch (err) {
  record('erro', 'O', 'falha', '', String(err?.message ?? err));
} finally {
  if (!READ_ONLY) {
    try {
      await closeEnvironment();
    } catch (err) {
      record('6.0 encerramento', 'O', 'falha', '', String(err?.message ?? err));
    }
  }
  try {
    await finish();
  } catch (err) {
    record('9.9 conferência final', 'O', 'falha', '', String(err?.message ?? err));
  }
}

const failedRequired = results.filter((r) => r.level === 'O' && r.status === 'falha');
console.log(`\n| Passo | O/D | Resultado | Tempo / medida | Observação |\n|---|---|---|---|---|`);
for (const r of results) {
  console.log(
    `| ${r.step} | ${r.level} | ${r.status} | ${r.measure} | ${String(r.note).replace(/\|/g, '/')} |`,
  );
}
console.log(
  `\n${failedRequired.length ? `${failedRequired.length} passo(s) obrigatório(s) com falha` : 'obrigatórios ok'} · ${secs(Date.now() - started)}`,
);
process.exit(failedRequired.length ? 1 : 0);
