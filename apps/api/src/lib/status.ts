import { HeadBucketCommand } from '@aws-sdk/client-s3';

import { env, proxmoxMock, sandboxEnabled } from '../env';
import { checkBackupDir } from './backup';
import { clamavAddress, clamavEnabled, clamPing, clamVersion } from './clamav';
import { ldapConfig, ldapProbe } from './ldap';
import { captureEnabled } from './page-capture';
import { prisma } from './prisma';
import { pveTemplateExists, pveVersion } from './proxmox';
import { enabledServices, SERVICE_NAMES, type ServiceId } from './reputation';
import { s3 } from './s3';
import { countActive } from './sandbox';
import { slaWhere } from './sla';
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
    | 'ldap'
    | 'yaraPacks'
    | 'integrity'
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
async function backupCheck(): Promise<StatusCheck> {
  const last = await prisma.backup.findFirst({
    where: { status: 'READY' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  const lastDetail = {
    label: 'Último backup pronto',
    value: last?.finishedAt ? last.finishedAt.toISOString().slice(0, 16).replace('T', ' ') : '—',
  };
  if (!env.BACKUP_DIR) {
    return {
      id: 'backup',
      name: 'Pasta de backup',
      level: 'off',
      summary: 'desligada (BACKUP_DIR vazio): o ZIP fica no bucket, no mesmo disco dos dados',
      details: [lastDetail],
    };
  }
  const dir = await checkBackupDir();
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  return {
    id: 'backup',
    name: 'Pasta de backup',
    level: dir.ok ? 'ok' : 'warn',
    summary: dir.ok ? `pronta, ${gb(dir.free)} livres` : dir.error,
    details: [{ label: 'Pasta no container', value: env.BACKUP_DIR }, lastDetail],
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

/** Reputacao externa: servicos ligados (com chave) e falhas nas ultimas 24 h. */
/** Senhas padrao ainda em uso (item 97): valores publicos do compose e do .env.example. */
export function insecureDefaults(): string[] {
  let dbPassword = '';
  try {
    dbPassword = decodeURIComponent(new URL(env.DATABASE_URL).password);
  } catch {
    /* endereco em outro formato: nao da para conferir */
  }
  return [
    ['deeplook', 'change-me-db-password'].includes(dbPassword) &&
      'senha do banco (POSTGRES_PASSWORD)',
    ['deeplook123', 'change-me-minio-password'].includes(env.S3_SECRET_KEY) &&
      'senha do MinIO (S3_SECRET_KEY)',
    env.ALLOW_INSECURE_DEFAULTS === 'true' && 'ALLOW_INSECURE_DEFAULTS ligado',
    env.COOKIE_SECURE !== 'true' && 'COOKIE_SECURE desligado (ligue em produção, sob HTTPS)',
    !env.TRUSTED_NETWORK.trim() &&
      'TRUSTED_NETWORK vazio (a API aceita conexão de qualquer rede privada)',
  ].filter((item): item is string => Boolean(item));
}

function configCheck(): StatusCheck {
  const found = insecureDefaults();
  return {
    id: 'config',
    name: 'Configuração',
    level: found.length ? 'warn' : 'ok',
    summary: found.length ? `${found.length} valor(es) padrão em uso` : 'sem senhas padrão',
    details: found.map((value) => ({ label: 'Trocar', value })),
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
    reputationCheck(),
    ldapCheck(),
    yaraPacksCheck(),
    integrityCheck(),
    backupCheck(),
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
