import { HeadBucketCommand } from '@aws-sdk/client-s3';

import { env, proxmoxMock, sandboxEnabled } from '../env';
import { prisma } from './prisma';
import { pveTemplateExists, pveVersion } from './proxmox';
import { s3 } from './s3';
import { countActive } from './sandbox';
import { slaCutoff } from './sla';

/** ok = verde, warn = laranja (lento/perto do limite), error = vermelho, off = desligado. */
export type StatusLevel = 'ok' | 'warn' | 'error' | 'off';

export interface StatusCheck {
  id: 'api' | 'database' | 'storage' | 'sandbox' | 'queues';
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

/**
 * Motivo legivel de uma falha: codigo de rede (inclusive dentro de um
 * AggregateError, como o do fetch com IPv4+IPv6), status HTTP do S3 ou a
 * mensagem original.
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
      where: { status: { not: 'COMPLETED' }, statusChangedAt: { lt: slaCutoff('late') } },
    }),
  ]);
  return {
    id: 'queues',
    name: 'Filas',
    level: late > 0 ? 'warn' : 'ok',
    summary:
      late > 0
        ? `${late} amostra${late > 1 ? 's' : ''} atrasada${late > 1 ? 's' : ''}`
        : 'nenhuma amostra atrasada',
    details: [
      { label: 'Pendentes', value: String(pending) },
      { label: 'Em análise', value: String(review) },
      { label: `Atrasadas (+${env.SLA_LATE_HOURS} h)`, value: String(late) },
    ],
  };
}

const ORDER: StatusLevel[] = ['ok', 'off', 'warn', 'error'];

/** Todas as verificacoes em paralelo + a situacao geral (a pior, ignorando "off"). */
export async function systemStatus() {
  const checks = await Promise.all([
    apiCheck(),
    databaseCheck(),
    storageCheck(),
    sandboxCheck(),
    queuesCheck(),
  ]);
  const overall = checks
    .map((c) => (c.level === 'off' ? 'ok' : c.level))
    .reduce<StatusLevel>(
      (worst, level) => (ORDER.indexOf(level) > ORDER.indexOf(worst) ? level : worst),
      'ok',
    );
  return { checkedAt: new Date(), overall, checks };
}
