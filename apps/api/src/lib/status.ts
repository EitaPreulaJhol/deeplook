import { HeadBucketCommand } from '@aws-sdk/client-s3';

import {
  databasePassword,
  env,
  proxmoxMock,
  PUBLIC_DB_PASSWORDS,
  PUBLIC_S3_SECRETS,
  sandboxEnabled,
} from '../env';
import type { ServiceKind } from '../generated/prisma/client';
import { aiDraftDestination, aiDraftEnabled, aiDraftModel, aiDraftProvider } from './ai-draft';
import { alertLogEnabled, writeStateAlert } from './alert-log';
import { lastAuditCheck } from './audit-check';
import { checkBackupDir } from './backup';
import { describe, readSchedule, scheduledBackupProblem } from './backup-schedule';
import { capaEnabled, capaReplicaStates } from './capa';
import { clamavAddress, clamavEnabled, clamPing, clamVersion } from './clamav';
import { pendingRekey } from './data-key-rekey';
import { createTranslator, type Lang } from './error-language';
import { ghidraEnabled } from './ghidra';
import { pausedQueues } from './job-control';
import { ldapConfig, ldapProbe } from './ldap';
import { MESSAGES_EN } from './messages-en';
import { snifferState } from './mikrotik';
import { networkCaptureEnabled } from './network-capture';
import { oletoolsEnabled } from './oletools';
import { captureEnabled } from './page-capture';
import { prisma } from './prisma';
import { pveTemplateExists, pveVersion } from './proxmox';
import { enabledServices, SERVICE_NAMES, type ServiceId } from './reputation';
import { s3 } from './s3';
import { countActive } from './sandbox';
import { serviceDef, serviceEnabled } from './services';
import { slaWhere } from './sla';
import { STATUS_EN } from './status-en';
import { suricataEnabled } from './suricata';
import { unpackEnabled } from './unpack';
import { yaraUpdateStatus } from './yara-update';

/** ok = verde, warn = laranja (lento/perto do limite), error = vermelho, off = desligado. */
export type StatusLevel = 'ok' | 'warn' | 'error' | 'off';

export interface StatusCheck {
  id:
    | 'api'
    | 'database'
    | 'storage'
    | 'sandbox'
    | 'queues'
    | 'reputation'
    | 'antivirus'
    | 'capture'
    | 'capa'
    | 'ghidra'
    | 'unpack'
    | 'ldap'
    | 'yaraPacks'
    | 'netcap'
    | 'suricata'
    | 'integrity'
    | 'audit'
    | 'oletools'
    | 'emulate'
    | 'android'
    | 'extract'
    | 'dotnet'
    | 'jar'
    | 'jsdeob'
    | 'metadata'
    | 'ai'
    | 'backup'
    | 'config';
  name: string;
  level: StatusLevel;
  summary: string;
  latencyMs?: number;
  details: { label: string; value: string }[];
}

/** Tempo-limite por verificacao: um servico travado nao trava a pagina. */
const TIMEOUT_MS = 3000;
/** Acima disso a verificacao fica laranja ("lento"). */
const SLOW_MS = 1000;
const STARTED_AT = new Date();
const VERSION = process.env.npm_package_version ?? '1.0.0';

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'conexão recusada',
  ENOTFOUND: 'endereço não encontrado',
  EAI_AGAIN: 'endereço não encontrado',
  ETIMEDOUT: 'tempo de conexão esgotado',
  ECONNRESET: 'conexão interrompida',
  EHOSTUNREACH: 'servidor inalcançável',
  CERT_HAS_EXPIRED: 'certificado TLS expirado',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificado TLS não confiável',
};

/** Codigos do Postgres (SQLSTATE) mais comuns ao conectar. */
const POSTGRES_ERRORS: Record<string, string> = {
  '28P01': 'usuário ou senha do banco recusados',
  '28000': 'acesso ao banco negado',
  '3D000': 'banco de dados inexistente',
  '57P03': 'banco iniciando ou em manutenção',
  '53300': 'limite de conexões do banco atingido',
};

/**
 * Motivo legivel de uma falha: codigo de rede (inclusive dentro de um
 * AggregateError, como o do fetch com IPv4+IPv6), codigo do Postgres (Prisma 7
 * com o driver adapter), status HTTP do S3 ou a mensagem original.
 */
export function describeError(err: unknown): string {
  const e = err as {
    code?: string;
    errors?: { code?: string }[];
    cause?: { code?: string };
    message?: string;
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = e?.code ?? e?.cause?.code ?? e?.errors?.find((x) => x?.code)?.code;
  if (code && NETWORK_ERRORS[code]) return NETWORK_ERRORS[code];
  // Prisma 7 (driver adapter): "Raw query failed. Code: `28P01`. Message: `...`".
  const raw = /Raw query failed\. Code: `([^`]*)`\. Message: `([^`]*)`/.exec(e?.message ?? '');
  if (raw)
    return (
      POSTGRES_ERRORS[raw[1]] ?? (/can't reach/i.test(raw[2]) ? 'servidor inalcançável' : raw[2])
    );
  const status = e?.$metadata?.httpStatusCode;
  if (status === 403) return 'acesso negado (confira as credenciais)';
  if (status === 404) return 'não encontrado (bucket inexistente?)';
  if (status) return `HTTP ${status}`;
  return e?.message || e?.name || String(err);
}

/** Mede a chamada; devolve o valor ou o erro (sem lancar). */
async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const start = Date.now();
  try {
    const value = await withTimeout(fn());
    return { ms: Date.now() - start, value };
  } catch (err) {
    return { ms: Date.now() - start, error: describeError(err) };
  }
}

function uptime(): string {
  const minutes = Math.floor(process.uptime() / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

const fmt = (d: Date) => d.toISOString();

async function apiCheck(): Promise<StatusCheck> {
  return {
    id: 'api',
    name: 'API',
    level: 'ok',
    summary: `versão ${VERSION} · no ar há ${uptime()}`,
    details: [
      { label: 'Iniciada em', value: fmt(STARTED_AT) },
      { label: 'Node.js', value: process.version },
      { label: 'Ambiente', value: env.NODE_ENV },
    ],
  };
}

async function databaseCheck(): Promise<StatusCheck> {
  const probe = await timed(() => prisma.$queryRaw`SELECT 1`);
  if (probe.error) {
    return {
      id: 'database',
      name: 'Banco de dados',
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details: [],
    };
  }
  const [users, entries, sessions] = await Promise.all([
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.entry.count(),
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
  ]);
  return {
    id: 'database',
    name: 'Banco de dados',
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.ms > SLOW_MS ? 'respondendo devagar' : 'respondendo',
    latencyMs: probe.ms,
    details: [
      { label: 'Usuários ativos', value: String(users) },
      { label: 'Amostras', value: String(entries) },
      { label: 'Sessões abertas', value: String(sessions) },
    ],
  };
}

async function storageCheck(): Promise<StatusCheck> {
  const probe = await timed(() => s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET })));
  // So o host do endpoint: nada de credenciais na tela.
  let host = env.S3_ENDPOINT;
  try {
    host = new URL(env.S3_ENDPOINT).host;
  } catch {
    /* endpoint sem esquema: mostra como esta */
  }
  const [purged, trashed] = await Promise.all([
    prisma.entry.count({ where: { filePurgedAt: { not: null } } }),
    prisma.entry.count({ where: { deletedAt: { not: null } } }),
  ]);
  const details = [
    { label: 'Bucket', value: env.S3_BUCKET },
    { label: 'Endereço', value: host },
    {
      label: 'Retenção',
      value: env.RETENTION_DAYS
        ? `${env.RETENTION_DAYS} dias após a conclusão · ${purged} arquivo(s) expurgado(s)`
        : 'desligada (RETENTION_DAYS=0)',
    },
    { label: 'Lixeira', value: `${trashed} amostra(s)` },
  ];
  if (probe.error) {
    return {
      id: 'storage',
      name: 'Armazenamento (MinIO)',
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  return {
    id: 'storage',
    name: 'Armazenamento (MinIO)',
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.ms > SLOW_MS ? 'bucket acessível, mas lento' : 'bucket acessível',
    latencyMs: probe.ms,
    details,
  };
}

async function sandboxCheck(): Promise<StatusCheck> {
  const name = 'Ambiente isolado (Proxmox)';
  if (!sandboxEnabled) {
    return {
      id: 'sandbox',
      name,
      level: 'off',
      summary: 'desligado (SANDBOX_ENABLED=false)',
      details: [],
    };
  }
  const { total } = await countActive();
  const usage = `${total} de ${env.SANDBOX_MAX_ACTIVE}`;
  const details = [
    { label: 'Nó', value: env.PROXMOX_NODE },
    { label: 'VMs ativas', value: usage },
  ];
  if (proxmoxMock) details.push({ label: 'Modo', value: 'simulado (PROXMOX_MOCK)' });

  const version = await timed(() => pveVersion());
  if (version.error) {
    return {
      id: 'sandbox',
      name,
      level: 'error',
      summary: `Proxmox inacessível: ${version.error}`,
      latencyMs: version.ms,
      details,
    };
  }
  details.unshift({ label: 'Versão', value: String(version.value) });
  const template = await timed(() => pveTemplateExists(env.PROXMOX_TEMPLATE_VMID));
  if (template.error || !template.value) {
    details.push({ label: 'Template', value: `VMID ${env.PROXMOX_TEMPLATE_VMID} não encontrado` });
    return {
      id: 'sandbox',
      name,
      level: 'error',
      summary: 'template das VMs não encontrado',
      latencyMs: version.ms,
      details,
    };
  }
  details.push({ label: 'Template', value: `VMID ${env.PROXMOX_TEMPLATE_VMID}` });
  const full = total >= env.SANDBOX_MAX_ACTIVE;
  const slow = version.ms > SLOW_MS;
  return {
    id: 'sandbox',
    name,
    level: full || slow ? 'warn' : 'ok',
    summary: full
      ? `limite de VMs atingido (${usage})`
      : slow
        ? 'respondendo devagar'
        : `${usage} VMs em uso`,
    latencyMs: version.ms,
    details,
  };
}

async function queuesCheck(): Promise<StatusCheck> {
  const [pending, review, late] = await Promise.all([
    prisma.entry.count({ where: { status: 'PENDING' } }),
    prisma.entry.count({ where: { status: 'IN_REVIEW' } }),
    prisma.entry.count({
      where: slaWhere('late'),
    }),
  ]);
  // Fila de analise pausada no Monitoramento (plans/monitoramento, item 3): laranja, para ninguem
  // esquecer.
  const paused = pausedQueues();
  return {
    id: 'queues',
    name: 'Filas',
    level: late > 0 || paused.length ? 'warn' : 'ok',
    summary:
      late > 0
        ? `${late} amostra${late > 1 ? 's' : ''} atrasada${late > 1 ? 's' : ''}`
        : paused.length
          ? `análise pausada: ${paused.join(', ')}`
          : 'nenhuma amostra atrasada',
    details: [
      { label: 'Pendentes', value: String(pending) },
      { label: 'Em análise', value: String(review) },
      { label: `Atrasadas (+${env.SLA_LATE_HOURS} h)`, value: String(late) },
      ...(paused.length ? [{ label: 'Análises pausadas', value: paused.join(', ') }] : []),
    ],
  };
}

/**
 * Integridade dos arquivos (item 4.2): amostras cujo arquivo guardado nao confere com o
 * SHA-256 da ficha, ou sumiu. Laranja e nao vermelho: pede atencao (uma evidencia pode estar
 * perdida), mas o servico segue de pe, e o vermelho de um monitor e para o que esta fora do ar.
 */
async function integrityCheck(): Promise<StatusCheck> {
  const stored = {
    type: 'FILE' as const,
    storageKey: { not: null },
    sha256: { not: null },
    filePurgedAt: null,
  };
  const [failed, total, unchecked, last] = await Promise.all([
    prisma.entry.count({ where: { ...stored, integrityFailedAt: { not: null } } }),
    prisma.entry.count({ where: stored }),
    prisma.entry.count({ where: { ...stored, integrityCheckedAt: null } }),
    prisma.entry.aggregate({ where: stored, _max: { integrityCheckedAt: true } }),
  ]);
  const minutes = env.INTEGRITY_SCRUB_INTERVAL_MINUTES;
  return {
    id: 'integrity',
    name: 'Integridade dos arquivos',
    level: failed > 0 ? 'warn' : 'ok',
    summary:
      failed > 0
        ? `${failed} amostra${failed > 1 ? 's' : ''} com arquivo divergente ou ausente`
        : 'nenhuma divergência encontrada',
    details: [
      { label: 'Com divergência', value: String(failed) },
      { label: 'Arquivos guardados', value: String(total) },
      { label: 'Ainda não conferidos', value: String(unchecked) },
      {
        label: 'Última conferência',
        value: last._max.integrityCheckedAt
          ? last._max.integrityCheckedAt.toISOString().slice(0, 16).replace('T', ' ')
          : '—',
      },
      {
        label: 'Conferência periódica',
        value: minutes
          ? `a cada ${minutes} min, até ${env.INTEGRITY_SCRUB_MAX_MB} MB por rodada`
          : 'desligada',
      },
    ],
  };
}

/**
 * Pasta de backup (item 6.13): sem BACKUP_DIR o ZIP fica no bucket, no mesmo disco dos dados
 * ("desligada"); com ela, a pasta precisa existir, ter a marca de quem configurou e aceitar
 * escrita. O ultimo backup pronto vale nos dois casos.
 */
export async function backupCheck(now = new Date()): Promise<StatusCheck> {
  const last = await prisma.backup.findFirst({
    where: { status: 'READY' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  const lastDetail = {
    label: 'Último backup pronto',
    value: last?.finishedAt ? last.finishedAt.toISOString().slice(0, 16).replace('T', ' ') : '—',
  };
  const schedule = await readSchedule();
  const scheduleDetail = {
    label: 'Agendamento',
    value: schedule?.enabled
      ? `${describe(schedule)}; próximo: ${schedule.nextRunAt?.slice(0, 16).replace('T', ' ') ?? '—'} UTC`
      : 'desligado',
  };
  // Agendamento ligado e backup que nao sai e erro, nao alerta: e o que um monitor com o token
  // de status (?strict=1, 503) precisa ver para avisar alguem.
  const problem = await scheduledBackupProblem(now);
  if (!env.BACKUP_DIR) {
    return {
      id: 'backup',
      name: 'Backup',
      level: problem ? 'error' : 'off',
      summary:
        problem ??
        'pasta desligada (BACKUP_DIR vazio): o ZIP fica no bucket, no mesmo disco dos dados',
      details: [lastDetail, scheduleDetail],
    };
  }
  const dir = await checkBackupDir();
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  return {
    id: 'backup',
    name: 'Backup',
    level: problem ? 'error' : dir.ok ? 'ok' : 'warn',
    summary: problem ?? (dir.ok ? `pasta pronta, ${gb(dir.free)} livres` : dir.error),
    details: [{ label: 'Pasta no container', value: env.BACKUP_DIR }, lastDetail, scheduleDetail],
  };
}

const ORDER: StatusLevel[] = ['ok', 'off', 'warn', 'error'];

/** Todas as verificacoes em paralelo + a situacao geral (a pior, ignorando "off"). */
/** Base de assinaturas mais velha que isso fica em alerta (o freshclam atualiza varias vezes ao dia). */
const AV_DB_MAX_AGE_MS = 2 * 24 * 3600 * 1000;

/** Antivirus: clamd respondendo, versao, idade da base e varreduras em 24 h. */
async function antivirusCheck(): Promise<StatusCheck> {
  const name = 'Antivírus (ClamAV)';
  if (!clamavEnabled()) {
    return {
      id: 'antivirus',
      name,
      level: 'off',
      summary: 'desligado (CLAMAV_HOST vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: clamavAddress() }];
  const probe = await timed(async () => {
    if (!(await clamPing())) throw new Error('o clamd não respondeu ao PING');
    return clamVersion();
  });
  if (probe.error || !probe.value) {
    return {
      id: 'antivirus',
      name,
      level: 'error',
      summary: probe.error ?? 'sem resposta',
      latencyMs: probe.ms,
      details,
    };
  }
  const v = probe.value;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [scans, infected, failed] = await Promise.all([
    prisma.antivirusScan.count({ where: { scannedAt: { gt: since }, status: { not: 'PENDING' } } }),
    prisma.antivirusScan.count({ where: { scannedAt: { gt: since }, status: 'INFECTED' } }),
    prisma.antivirusScan.count({ where: { scannedAt: { gt: since }, status: 'ERROR' } }),
  ]);
  const stale = v.dbDate ? Date.now() - v.dbDate.getTime() > AV_DB_MAX_AGE_MS : true;
  details.push(
    { label: 'Motor', value: v.engine },
    {
      label: 'Base de assinaturas',
      value: `${v.dbVersion ?? '?'} · ${v.dbDate ? v.dbDate.toLocaleString('pt-BR', { timeZone: 'UTC' }) + ' UTC' : 'data desconhecida'}`,
    },
    {
      label: 'Varreduras em 24 h',
      value: `${scans} · ${infected} infectada(s) · ${failed} falha(s)`,
    },
  );
  return {
    id: 'antivirus',
    name,
    level: stale || probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: stale ? 'respondendo, mas a base de assinaturas está desatualizada' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/** Captura de pagina (item 80): servico do navegador isolado e capturas em 24 h. */
async function captureCheck(): Promise<StatusCheck> {
  const name = 'Captura de página';
  if (!captureEnabled()) {
    return {
      id: 'capture',
      name,
      level: 'off',
      summary: 'desligada (CAPTURE_URL vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: env.CAPTURE_URL }];
  const probe = await timed(async () => {
    const res = await fetch(`${env.CAPTURE_URL.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
  });
  if (probe.error) {
    return {
      id: 'capture',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [done, failed] = await Promise.all([
    prisma.pageCapture.count({ where: { createdAt: { gt: since }, status: 'DONE' } }),
    prisma.pageCapture.count({ where: { createdAt: { gt: since }, status: 'FAILED' } }),
  ]);
  details.push({ label: 'Capturas em 24 h', value: `${done} · ${failed} falha(s)` });
  return {
    id: 'capture',
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/**
 * Espera do mais antigo da fila do capa acima disto: aviso (plans/ajustes-usabilidade, item 8). A
 * fila pega o mais antigo depois de 30 min; uma hora parado e sinal de replicas presas ou poucas.
 */
const CAPA_QUEUE_WARN_MS = 60 * 60 * 1000;

/** Analise de funcoes (item 7.2): servico capa, replicas, fila e analises em 24 h. */
async function capaCheck(): Promise<StatusCheck> {
  const name = 'Análise de funções (capa)';
  if (!capaEnabled()) {
    return { id: 'capa', name, level: 'off', summary: 'desligada (CAPA_URL vazio)', details: [] };
  }
  const details = [{ label: 'Endereço', value: env.CAPA_URL }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${env.CAPA_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as {
        state?: string;
        capa?: string;
        floss?: string;
        rules?: string;
      };
    });
  let probe = await health();
  // Um container por analise: na troca, o servico fica fora por um ou dois segundos. Uma nova
  // tentativa evita que o monitor externo (strict=1) dispare por isso.
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return { id: 'capa', name, level: 'error', summary: probe.error, latencyMs: probe.ms, details };
  }
  const v = probe.value ?? {};
  details.push({
    label: 'Versões',
    value: `capa ${v.capa ?? '?'} · FLOSS ${v.floss ?? '?'} · regras ${v.rules ?? '?'}`,
  });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [states, waiting, running, oldest, done, failed] = await Promise.all([
    capaReplicaStates(),
    prisma.capaAnalysis.count({ where: { status: 'PENDING' } }),
    prisma.capaAnalysis.count({ where: { status: 'RUNNING' } }),
    prisma.capaAnalysis.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.capaAnalysis.count({ where: { finishedAt: { gt: since }, status: 'DONE' } }),
    prisma.capaAnalysis.count({ where: { finishedAt: { gt: since }, status: 'FAILED' } }),
  ]);
  // Replicas (CAPA_WORKERS containers): quantas livres, ocupadas e sem resposta.
  const free = states.filter((s) => s.state === 'livre').length;
  const busy = states.filter((s) => s.state === 'ocupada').length;
  const silent = states.length - free - busy;
  details.push({
    label: 'Réplicas',
    value: silent
      ? `${states.length} · ${free} livre(s), ${busy} ocupada(s), ${silent} sem resposta`
      : `${states.length} · ${free} livre(s), ${busy} ocupada(s)`,
  });
  details.push({ label: 'Na fila', value: `${waiting} esperando · ${running} analisando` });
  const waitMs = oldest ? Date.now() - oldest.createdAt.getTime() : 0;
  if (oldest) {
    details.push({ label: 'Espera do mais antigo', value: `${Math.round(waitMs / 60_000)} min` });
  }
  details.push({ label: 'Análises em 24 h', value: `${done} · ${failed} falha(s)` });
  let level: StatusCheck['level'] = probe.ms > SLOW_MS ? 'warn' : 'ok';
  let summary = v.state === 'analisando' ? 'respondendo (analisando)' : 'respondendo';
  if (silent) {
    level = 'warn';
    summary = `respondendo; ${silent} réplica(s) sem resposta`;
  } else if (waitMs > CAPA_QUEUE_WARN_MS) {
    level = 'warn';
    summary = `fila lenta: o mais antigo espera há ${Math.round(waitMs / 60_000)} min`;
  }
  return { id: 'capa', name, level, summary, latencyMs: probe.ms, details };
}

/** Office e PDF mais fundo (item 7.14): servico oletools, fila e analises em 24 h. */
async function oletoolsCheck(): Promise<StatusCheck> {
  const name = 'Documentos (oletools)';
  if (!oletoolsEnabled()) {
    return {
      id: 'oletools',
      name,
      level: 'off',
      summary: 'desligado (OLETOOLS_URL vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: env.OLETOOLS_URL }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${env.OLETOOLS_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as { state?: string; oletools?: string };
    });
  let probe = await health();
  // Um container por analise: na troca o servico some por um instante (como no capa).
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return {
      id: 'oletools',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  details.push({ label: 'Versão', value: `oletools ${probe.value?.oletools ?? '?'}` });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, done, failed] = await Promise.all([
    prisma.officeAnalysis.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.officeAnalysis.count({ where: { finishedAt: { gt: since }, status: 'DONE' } }),
    prisma.officeAnalysis.count({ where: { finishedAt: { gt: since }, status: 'FAILED' } }),
  ]);
  details.push({ label: 'Na fila', value: String(queued) });
  details.push({ label: 'Análises em 24 h', value: `${done} · ${failed} falha(s)` });
  return {
    id: 'oletools',
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.value?.state === 'analisando' ? 'respondendo (analisando)' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/**
 * Rascunho por IA (plans/novas-analises, item 7): sem chamada ao provedor (custaria a cada
 * abertura do status); mostra o que esta configurado e para onde as evidencias vao.
 */
function aiCheck(): StatusCheck {
  const name = 'Rascunho por IA';
  if (!aiDraftProvider()) {
    return { id: 'ai', name, level: 'off', summary: 'desligado (LLM_PROVIDER vazio)', details: [] };
  }
  if (!aiDraftEnabled()) {
    return {
      id: 'ai',
      name,
      level: 'warn',
      summary: 'incompleto (falta LLM_API_KEY, LLM_URL ou LLM_MODEL)',
      details: [],
    };
  }
  return {
    id: 'ai',
    name,
    level: 'ok',
    summary: 'ligado: as evidências das análises saem para o provedor',
    details: [
      { label: 'Provedor', value: aiDraftProvider()! },
      { label: 'Modelo', value: aiDraftModel() },
      { label: 'Destino', value: aiDraftDestination() ?? '?' },
      { label: 'Limite por analista', value: `${env.LLM_DAILY_LIMIT} em 24 h` },
    ],
  };
}

/**
 * Servicos novos (plans/novas-analises): emulacao (emulate), APK (android) e configuracao de
 * familias (extract). O mesmo desenho do oletools: /health, a fila e as analises em 24 h.
 */
const SERVICE_CHECKS = {
  EMULATION: {
    id: 'emulate',
    name: 'Emulação (Speakeasy)',
    summary: 'desligada (EMULATE_URL vazio)',
  },
  ANDROID: {
    id: 'android',
    name: 'APK/Android (androguard)',
    summary: 'desligado (ANDROID_URL vazio)',
  },
  CONFIG: {
    id: 'extract',
    name: 'Configuração e memória (CAPE)',
    summary: 'desligado (EXTRACT_URL vazio)',
  },
  // Descompilacao de .NET (plans/caca-e-formatos, item 3).
  DOTNET: {
    id: 'dotnet',
    name: 'Descompilação de .NET (ILSpy)',
    summary: 'desligada (DOTNET_URL vazio)',
  },
  // Descompilacao de Java (JAR e .class).
  JAR: {
    id: 'jar',
    name: 'Descompilação de Java (CFR)',
    summary: 'desligada (JAR_URL vazio)',
  },
  // Desofuscacao de JavaScript (item 20).
  JSDEOB: {
    id: 'jsdeob',
    name: 'Desofuscação de JavaScript (webcrack)',
    summary: 'desligada (JSDEOB_URL vazio)',
  },
  // Metadados com o ExifTool (item 19), no servico oletools.
  METADATA: {
    id: 'metadata',
    name: 'Metadados (ExifTool)',
    summary: 'desligada (OLETOOLS_URL vazio)',
  },
} as const satisfies Record<ServiceKind, { id: StatusCheck['id']; name: string; summary: string }>;

async function serviceCheck(kind: ServiceKind): Promise<StatusCheck> {
  const def = serviceDef(kind)!;
  const { id, name, summary: off } = SERVICE_CHECKS[kind];
  if (!serviceEnabled(kind)) return { id, name, level: 'off', summary: off, details: [] };
  const url = def.url().replace(/\/$/, '');
  const details = [{ label: 'Endereço', value: def.url() }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as { state?: string; version?: string | null };
    });
  let probe = await health();
  // Um container por analise: na troca o servico some por um instante (como no capa).
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return { id, name, level: 'error', summary: probe.error, latencyMs: probe.ms, details };
  }
  details.push({ label: 'Versão', value: probe.value?.version ?? '?' });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, done, failed] = await Promise.all([
    prisma.serviceAnalysis.count({ where: { kind, status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.serviceAnalysis.count({ where: { kind, finishedAt: { gt: since }, status: 'DONE' } }),
    prisma.serviceAnalysis.count({ where: { kind, finishedAt: { gt: since }, status: 'FAILED' } }),
  ]);
  details.push({ label: 'Na fila', value: String(queued) });
  details.push({ label: 'Análises em 24 h', value: `${done} · ${failed} falha(s)` });
  return {
    id,
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.value?.state === 'analisando' ? 'respondendo (analisando)' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/**
 * Captura de rede do sandbox (plano pos-revisao, item 5.4): o servico netcap, o sniffer do
 * MikroTik (pela API REST) e as capturas em andamento.
 */
async function networkCaptureCheck(): Promise<StatusCheck> {
  const name = 'Captura de rede (MikroTik)';
  if (!networkCaptureEnabled()) {
    return {
      id: 'netcap',
      name,
      level: 'off',
      summary: 'desligada (MIKROTIK_URL, NETCAP_URL ou NETCAP_STREAM_TARGET vazio)',
      details: [],
    };
  }
  const details = [
    { label: 'Endereço', value: env.NETCAP_URL },
    { label: 'Destino do TZSP', value: env.NETCAP_STREAM_TARGET },
  ];
  const probe = await timed(async () => {
    const res = await fetch(`${env.NETCAP_URL.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
    return (await res.json()) as { lastPacketAt?: string | null; rejected?: number };
  });
  if (probe.error) {
    return {
      id: 'netcap',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  const router = await timed(() => snifferState());
  if (router.error) {
    return {
      id: 'netcap',
      name,
      level: 'error',
      summary: `sniffer do MikroTik: ${router.error}`,
      latencyMs: router.ms,
      details,
    };
  }
  const capturing = await prisma.networkCapture.count({ where: { status: 'CAPTURING' } });
  details.push({ label: 'RouterOS', value: router.value?.version ?? '?' });
  details.push({ label: 'Capturas em andamento', value: String(capturing) });
  details.push({
    label: 'Último pacote',
    value: probe.value?.lastPacketAt ?? 'nenhum desde a subida do netcap',
  });
  // Com captura em andamento, o sniffer precisa estar ligado.
  const stopped = capturing > 0 && !router.value?.running;
  return {
    id: 'netcap',
    name,
    level: stopped ? 'warn' : probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: stopped ? 'sniffer do MikroTik parado com captura em andamento' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/** Suricata (plano pos-revisao, item 5.4): servico, regras ET Open e analises em 24 h. */
async function suricataCheck(): Promise<StatusCheck> {
  const name = 'Suricata (tráfego do sandbox)';
  if (!suricataEnabled()) {
    return {
      id: 'suricata',
      name,
      level: 'off',
      summary: 'desligado (SURICATA_URL vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: env.SURICATA_URL }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${env.SURICATA_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as {
        state?: string;
        suricata?: string;
        rules?: { count?: number; updatedAt?: string | null; lastError?: string | null };
      };
    });
  let probe = await health();
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return {
      id: 'suricata',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  const rules = probe.value?.rules;
  details.push({ label: 'Versão', value: `Suricata ${probe.value?.suricata ?? '?'}` });
  details.push({
    label: 'Regras ET Open',
    value: rules?.count ? `${rules.count} · ${rules.updatedAt ?? '?'}` : 'ainda não baixadas',
  });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, done, failed] = await Promise.all([
    prisma.networkCapture.count({ where: { idsStatus: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.networkCapture.count({ where: { idsFinishedAt: { gt: since }, idsStatus: 'DONE' } }),
    prisma.networkCapture.count({ where: { idsFinishedAt: { gt: since }, idsStatus: 'FAILED' } }),
  ]);
  details.push({ label: 'Na fila', value: String(queued) });
  details.push({ label: 'Análises em 24 h', value: `${done} · ${failed} falha(s)` });
  // Sem regras (ou com a atualizacao falhando) o Suricata so ve a regra de teste.
  const noRules = !rules?.count || Boolean(rules.lastError);
  return {
    id: 'suricata',
    name,
    level: noRules ? 'warn' : probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: !rules?.count
      ? 'respondendo, sem as regras ET Open (só a regra de teste)'
      : rules.lastError
        ? `respondendo; a atualização das regras falhou: ${rules.lastError}`
        : probe.value?.state === 'analisando'
          ? 'respondendo (analisando)'
          : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/** Analise com o Ghidra (item 7.3): servico ghidra, fila e analises em 24 h. */
async function ghidraCheck(): Promise<StatusCheck> {
  const name = 'Análise com o Ghidra';
  if (!ghidraEnabled()) {
    return {
      id: 'ghidra',
      name,
      level: 'off',
      summary: 'desligada (GHIDRA_URL vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: env.GHIDRA_URL }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${env.GHIDRA_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as { state?: string; ghidra?: string };
    });
  let probe = await health();
  // Um container por analise: na troca, o servico fica fora por alguns segundos (ver o do capa).
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return {
      id: 'ghidra',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  details.push({ label: 'Versão', value: `Ghidra ${probe.value?.ghidra ?? '?'}` });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, done, failed] = await Promise.all([
    prisma.ghidraAnalysis.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.ghidraAnalysis.count({ where: { finishedAt: { gt: since }, status: 'DONE' } }),
    prisma.ghidraAnalysis.count({ where: { finishedAt: { gt: since }, status: 'FAILED' } }),
  ]);
  details.push({ label: 'Na fila', value: String(queued) });
  details.push({ label: 'Análises em 24 h', value: `${done} · ${failed} falha(s)` });
  return {
    id: 'ghidra',
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.value?.state === 'analisando' ? 'respondendo (analisando)' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/** Desempacotar e extrair (item 7.8): servico unpack, fila e trabalhos em 24 h. */
async function unpackCheck(): Promise<StatusCheck> {
  const name = 'Identificar e desempacotar';
  if (!unpackEnabled()) {
    return {
      id: 'unpack',
      name,
      level: 'off',
      summary: 'desligado (UNPACK_URL vazio)',
      details: [],
    };
  }
  const details = [{ label: 'Endereço', value: env.UNPACK_URL }];
  const health = () =>
    timed(async () => {
      const res = await fetch(`${env.UNPACK_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`o serviço respondeu ${res.status}`);
      return (await res.json()) as { state?: string; unpackers?: string[]; die?: string | null };
    });
  let probe = await health();
  // Um container por trabalho: na troca, o servico fica fora por alguns segundos (ver o do capa).
  if (probe.error) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await health();
  }
  if (probe.error) {
    return {
      id: 'unpack',
      name,
      level: 'error',
      summary: probe.error,
      latencyMs: probe.ms,
      details,
    };
  }
  details.push({ label: 'Detect It Easy', value: probe.value?.die ?? 'não encontrado' });
  details.push({
    label: 'Desempacotadores',
    value: (probe.value?.unpackers ?? []).join(', ') || '—',
  });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [queued, done, failed] = await Promise.all([
    prisma.unpackJob.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.unpackJob.count({ where: { finishedAt: { gt: since }, status: 'DONE' } }),
    prisma.unpackJob.count({ where: { finishedAt: { gt: since }, status: 'FAILED' } }),
  ]);
  details.push({ label: 'Na fila', value: String(queued) });
  details.push({ label: 'Trabalhos em 24 h', value: `${done} · ${failed} falha(s)` });
  return {
    id: 'unpack',
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.value?.state === 'analisando' ? 'respondendo (trabalhando)' : 'respondendo',
    latencyMs: probe.ms,
    details,
  };
}

/** Reputacao externa: servicos ligados (com chave) e falhas nas ultimas 24 h. */
/** Senhas padrao ainda em uso (item 97): valores publicos do compose e do .env.example. */
export function insecureDefaults(): string[] {
  // Em producao a API nem sobe com estas duas (env.ts); o aviso fica para a demonstracao e o
  // desenvolvimento.
  return [
    PUBLIC_DB_PASSWORDS.includes(databasePassword()) && 'senha do banco (POSTGRES_PASSWORD)',
    PUBLIC_S3_SECRETS.includes(env.S3_SECRET_KEY) && 'senha do MinIO (S3_SECRET_KEY)',
    env.ALLOW_INSECURE_DEFAULTS === 'true' && 'ALLOW_INSECURE_DEFAULTS ligado',
    env.COOKIE_SECURE !== 'true' && 'COOKIE_SECURE desligado (ligue em produção, sob HTTPS)',
    !env.TRUSTED_NETWORK.trim() &&
      'TRUSTED_NETWORK vazio (a API aceita conexão de qualquer rede privada)',
  ].filter((item): item is string => Boolean(item));
}

/** Cadeia da auditoria (lib/audit.ts): o resultado da ultima conferencia periodica. */
export function auditCheck(): StatusCheck {
  const name = 'Auditoria';
  const state = lastAuditCheck();
  if (!state) {
    return { id: 'audit', name, level: 'ok', summary: 'cadeia ainda não conferida', details: [] };
  }
  const details = [
    { label: 'Eventos na cadeia', value: String(state.events) },
    {
      label: 'Ponta',
      value: state.head ? `#${state.head.seq} ${state.head.hash.slice(0, 16)}…` : '—',
    },
    { label: 'Última conferência', value: state.checkedAt.slice(0, 16).replace('T', ' ') },
    ...(state.unchained ? [{ label: 'Histórico a encadear', value: String(state.unchained) }] : []),
  ];
  if (!state.ok) {
    return {
      id: 'audit',
      name,
      level: 'error',
      summary: `cadeia quebrada: ${state.problem?.reason ?? 'motivo desconhecido'}`,
      details,
    };
  }
  return { id: 'audit', name, level: 'ok', summary: 'cadeia íntegra', details };
}

/** Chave de dados (lib/data-key.ts): o que falta para o 2FA nao depender do SESSION_SECRET. */
export async function dataKeyNotes(): Promise<string[]> {
  if (!env.DATA_KEY) {
    const using = await prisma.user.count({ where: { twoFactorSecret: { not: null } } });
    return using
      ? [
          `DATA_KEY vazio: o 2FA de ${using} conta(s) depende do SESSION_SECRET (trocá-lo quebra o 2FA)`,
        ]
      : [];
  }
  const pending = await pendingRekey();
  return [
    pending > 0 &&
      `${pending} segredo(s) do 2FA fora do DATA_KEY atual (reinicie a API; se continuar, a chave que os cifrou não está no .env)`,
    env.DATA_KEY_PREVIOUS !== '' &&
      pending === 0 &&
      'DATA_KEY_PREVIOUS ainda definido: a troca terminou, pode sair do .env',
  ].filter((item): item is string => Boolean(item));
}

async function configCheck(): Promise<StatusCheck> {
  const found = insecureDefaults();
  const keys = await dataKeyNotes().catch(() => []);
  const parts = [
    found.length && `${found.length} valor(es) padrão em uso`,
    keys.length && 'chave de dados a rever',
  ].filter(Boolean);
  return {
    id: 'config',
    name: 'Configuração',
    level: parts.length ? 'warn' : 'ok',
    summary: parts.length ? parts.join('; ') : 'sem senhas padrão',
    details: [
      ...found.map((value) => ({ label: 'Trocar', value })),
      ...keys.map((value) => ({ label: 'Chave de dados', value })),
    ],
  };
}

/** AD/LDAP (item 94): conecta com TLS e faz o bind da conta de servico. */
async function ldapCheck(): Promise<StatusCheck> {
  const name = 'AD/LDAP';
  const c = ldapConfig();
  if (!c) {
    return { id: 'ldap', name, level: 'off', summary: 'desligado (LDAP_URL vazio)', details: [] };
  }
  const details = [
    { label: 'Servidor', value: c.url + (c.startTls ? ' (StartTLS)' : '') },
    { label: 'Base', value: c.baseDn || '—' },
    {
      label: 'Grupos',
      value: `analistas: ${c.analystGroup ?? '—'} · admins: ${c.adminGroup ?? '—'}`,
    },
  ];
  const accounts = await prisma.user.count({ where: { authSource: 'LDAP' } });
  details.push({ label: 'Contas do AD', value: String(accounts) });
  const probe = await timed(() => ldapProbe());
  if (probe.error) {
    return { id: 'ldap', name, level: 'error', summary: probe.error, latencyMs: probe.ms, details };
  }
  return {
    id: 'ldap',
    name,
    level: probe.ms > SLOW_MS ? 'warn' : 'ok',
    summary: probe.ms > SLOW_MS ? 'lento' : 'conectado (TLS verificado)',
    latencyMs: probe.ms,
    details,
  };
}

async function reputationCheck(): Promise<StatusCheck> {
  const enabled = enabledServices();
  const all = Object.keys(SERVICE_NAMES) as ServiceId[];
  const details = all.map((s) => ({
    label: SERVICE_NAMES[s],
    value: enabled.includes(s) ? 'ligado' : 'sem chave',
  }));
  if (enabled.length === 0) {
    return {
      id: 'reputation',
      name: 'Reputação externa',
      level: 'off',
      summary: 'desligada (nenhuma chave configurada)',
      details,
    };
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [lookups, errors] = await Promise.all([
    prisma.reputationResult.count({ where: { checkedAt: { gt: since } } }),
    prisma.reputationResult.findMany({
      where: { status: 'ERROR', checkedAt: { gt: since } },
      select: { service: true, summary: true },
      distinct: ['service'],
    }),
  ]);
  for (const e of errors) {
    const d = details.find((x) => x.label === SERVICE_NAMES[e.service as ServiceId]);
    if (d) d.value = `ligado · falhou: ${e.summary}`;
  }
  return {
    id: 'reputation',
    name: 'Reputação externa',
    level: errors.length ? 'warn' : 'ok',
    summary: `${enabled.length} serviço(s) ligado(s) · ${lookups} consulta(s) em 24 h${
      errors.length ? ` · ${errors.length} com falha` : ''
    }`,
    details,
  };
}

/** Atualizacao dos pacotes YARA (item 150): falha e atualizacao esperando um admin. */
async function yaraPacksCheck(): Promise<StatusCheck> {
  const status = await yaraUpdateStatus();
  const name = 'Pacotes YARA';
  const failing = status.packs.filter((p) => p.lastError);
  const held = status.releases.filter((r) => r.status === 'HELD').length;
  const parts = [
    status.autoUpdate ? 'atualização automática ligada' : 'atualização automática desligada',
    ...(held ? [`${held} retida(s) para aprovação`] : []),
    ...(failing.length ? [`${failing.length} com falha na última verificação`] : []),
  ];
  return {
    id: 'yaraPacks',
    name,
    level: held || failing.length ? 'warn' : status.autoUpdate ? 'ok' : 'off',
    summary: parts.join(' · '),
    details: status.packs.map((p) => ({
      label: p.name,
      value: `versão de ${p.commitDate}${p.lastError ? ` · falhou: ${p.lastError}` : ''}`,
    })),
  };
}

export async function systemStatus() {
  const checks = await Promise.all([
    apiCheck(),
    databaseCheck(),
    storageCheck(),
    sandboxCheck(),
    queuesCheck(),
    antivirusCheck(),
    captureCheck(),
    capaCheck(),
    ghidraCheck(),
    unpackCheck(),
    oletoolsCheck(),
    serviceCheck('EMULATION'),
    serviceCheck('ANDROID'),
    serviceCheck('CONFIG'),
    serviceCheck('DOTNET'),
    serviceCheck('JAR'),
    serviceCheck('JSDEOB'),
    serviceCheck('METADATA'),
    aiCheck(),
    networkCaptureCheck(),
    suricataCheck(),
    reputationCheck(),
    ldapCheck(),
    yaraPacksCheck(),
    integrityCheck(),
    backupCheck(),
    auditCheck(),
    configCheck(),
  ]);
  const overall = checks
    .map((c) => (c.level === 'off' ? 'ok' : c.level))
    .reduce<StatusLevel>(
      (worst, level) => (ORDER.indexOf(level) > ORDER.indexOf(worst) ? level : worst),
      'ok',
    );
  return { checkedAt: new Date(), overall, checks };
}

/** Quanto tempo uma leitura do status serve a quem consulta de novo (monitor externo). */
const STATUS_CACHE_MS = 10_000;
let statusCache: { at: number; value: ReturnType<typeof systemStatus> } | null = null;

/**
 * `systemStatus` com cache curto e uma consulta so em andamento (item 3.2): um monitor que
 * pergunta de segundos em segundos, ou varios ao mesmo tempo, nao vira uma enxurrada de
 * consultas ao banco, ao MinIO, ao ClamAV, ao LDAP e ao Proxmox. `checkedAt` mostra a idade.
 * Falha nao e guardada.
 */
export function cachedSystemStatus(): ReturnType<typeof systemStatus> {
  const now = Date.now();
  if (!statusCache || now - statusCache.at > STATUS_CACHE_MS) {
    const value = systemStatus();
    statusCache = { at: now, value };
    value.catch(() => {
      if (statusCache?.value === value) statusCache = null;
    });
  }
  return statusCache.value;
}

/** Para os testes: esquece o cache. */
export function resetStatusCache(): void {
  statusCache = null;
}

// Os erros conhecidos (messages-en.ts) tambem: o motivo de uma falha aparece dentro do status.
const toEnglish = createTranslator([...STATUS_EN, ...MESSAGES_EN]);

/** Um texto do status (resumo de uma checagem) na lingua de quem pede (Monitoramento). */
export const localizeStatusText = (text: string, lang: Lang): string =>
  lang === 'en' ? toEnglish(text) : text;

/**
 * O status no idioma de quem pede (plano pos-revisao, item 1.4): nome, resumo e detalhes de cada
 * verificacao. Os ids, niveis e numeros nao mudam; sem `en`, sai como foi montado.
 */
export function localizeStatus<T extends { checks: StatusCheck[] }>(status: T, lang: Lang): T {
  if (lang !== 'en') return status;
  return {
    ...status,
    checks: status.checks.map((check) => ({
      ...check,
      name: toEnglish(check.name),
      summary: toEnglish(check.summary),
      details: check.details.map((d) => ({ label: toEnglish(d.label), value: toEnglish(d.value) })),
    })),
  };
}

/** Intervalo do monitor de alertas do status (plano pos-revisao, item 5.2). */
const STATUS_ALERT_EVERY_MS = 5 * 60 * 1000;

/** Confere o status e grava no log de alertas o componente que caiu ou voltou. */
export async function checkStatusAlerts(): Promise<void> {
  const { checks } = await systemStatus();
  for (const check of checks) {
    const down = check.level === 'error';
    await writeStateAlert(`status:${check.id}`, down ? 'down' : 'up', !down, () =>
      down
        ? ['error', 'status.down', `${check.name}: ${check.summary}`, { component: check.id }]
        : ['info', 'status.recovered', `${check.name} voltou ao normal`, { component: check.id }],
    );
  }
}

/** Monitor do status para o log de alertas: so roda com o log ligado. */
export function startStatusAlerts(logger: { error: (o: object, m: string) => void }): void {
  if (!alertLogEnabled()) return;
  const run = () =>
    void checkStatusAlerts().catch((err: unknown) =>
      logger.error({ err }, '[alertas] falha ao conferir o status'),
    );
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, STATUS_ALERT_EVERY_MS).unref();
}
