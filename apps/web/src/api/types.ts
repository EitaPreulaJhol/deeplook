export type Role = 'USER' | 'ANALYST' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type EntryType = 'FILE' | 'URL';
export type EntryStatus = 'PENDING' | 'IN_REVIEW' | 'COMPLETED';
export type Verdict = 'UNKNOWN' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  _count?: { entries: number };
}

/** Tela aberta apos o login e na raiz "/". */
export type StartPage = 'welcome' | 'dashboard' | 'history' | 'mine';

/** Preferencias de uso (GET /api/auth/me, PATCH /api/me/preferences). */
export interface Preferences {
  startPage: StartPage;
  pageSize: 25 | 50 | 100;
  restoreTabs: boolean;
  /** Painel de detalhe abaixo das listas. */
  detailPane: boolean;
}

/** Usuario da sessao atual: inclui as preferencias. */
export interface CurrentUser extends User {
  preferences: Preferences;
}

/** Analise estatica do arquivo enviado (Entry.staticInfo). */
export interface StaticInfo {
  version: 1;
  analyzedAt: string;
  size: number;
  bytesAnalyzed: number;
  detectedType: { id: string; label: string; extensions: string[]; executable: boolean } | null;
  extensionMismatch: { declared: string; expected: string[]; dangerous: boolean } | null;
  entropy: number;
  entropyLevel: 'low' | 'normal' | 'high';
  strings: {
    total: number;
    urls: string[];
    ips: string[];
    emails: string[];
    paths: string[];
    registry: string[];
    suspicious: string[];
  };
  pe: {
    machine: string;
    is64: boolean;
    isDll: boolean;
    subsystem: string;
    compiledAt: string | null;
    sections: { name: string; virtualSize: number; rawSize: number; entropy: number }[];
    imports: { dll: string; functions: number }[];
    suspiciousImports: string[];
    packer: string | null;
  } | null;
  iocCandidates: { kind: IocKind; value: string }[];
}

/** GET /api/dashboard (Painel). */
export interface DashboardData {
  scope: 'all' | 'mine';
  days: number;
  tz: string;
  /** Inicio do periodo (meia-noite do 1o dia no fuso do navegador). */
  since: string;
  sla: SlaConfig;
  byStatus: Record<EntryStatus, number>;
  byVerdict: Record<Verdict, number>;
  open: { warn: number; late: number };
  period: { submitted: number; completed: number };
  daily: { day: string; submitted: number; completed: number }[];
  workload: {
    id: string | null;
    name: string;
    pending: number;
    inReview: number;
    late: number;
    completed: number;
  }[];
}

/** Situacao de um componente: verde, laranja, vermelho ou desligado. */
export type StatusLevel = 'ok' | 'warn' | 'error' | 'off';

/** GET /api/admin/status */
export interface SystemStatus {
  checkedAt: string;
  overall: StatusLevel;
  checks: {
    id: string;
    name: string;
    level: StatusLevel;
    summary: string;
    latencyMs?: number;
    details: { label: string; value: string }[];
  }[];
}

export type AuditAction =
  | 'USER_REGISTERED'
  | 'USER_ROLE_CHANGED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'USER_PASSWORD_RESET'
  | 'USER_PASSWORD_CHANGED'
  | 'KEY_CREATED'
  | 'KEY_REVOKED'
  | 'TEMPLATE_CREATED'
  | 'TEMPLATE_UPDATED'
  | 'TEMPLATE_DELETED'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED';

/** Registro de auditoria (GET /api/admin/audit). */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  actor: { id: string; displayName: string; email: string } | null;
  targetUser: { id: string; displayName: string; email: string } | null;
  targetLabel: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

/** Modelo de relatorio (GET /api/report-templates). */
export interface ReportTemplate {
  id: string;
  name: string;
  summary: string;
  findings: string | null;
  iocs: string | null;
  verdict: Verdict;
  updatedAt: string;
}

/** Notificacao da caixa de entrada (GET /api/me/notifications). */
export interface AppNotification {
  id: string;
  type: 'ASSIGNED' | 'COMPLETED' | 'MENTION' | 'COMMENT' | 'REPORT_APPROVED' | 'REPORT_RETURNED';
  /** Veredito (COMPLETED) ou trecho da atualizacao (MENTION/COMMENT). */
  detail: string | null;
  readAt: string | null;
  createdAt: string;
  entry: { id: string; title: string };
  actor: { id: string; displayName: string } | null;
}

/** Tipos de indicador do indice de IOCs (relatorios publicados). */
export type IocKind = 'IPV4' | 'DOMAIN' | 'EMAIL' | 'MD5' | 'SHA1' | 'SHA256';

/** Onde um indicador aparece numa amostra (ficha do indicador). */
export type IocSighting =
  | { kind: 'REPORT'; reportId: string; analyst: string; createdAt: string }
  | { kind: 'FILE' }
  | { kind: 'URL_HOST' };

/** GET /api/iocs/:kind/:value */
export interface IocDetail {
  ioc: { kind: IocKind; value: string };
  items: { entry: Entry; sightings: IocSighting[] }[];
  total: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

/** GET /api/entries/:id/iocs: indicadores da amostra (relatorios + a propria). */
export interface EntryIoc {
  kind: IocKind | 'URL';
  value: string;
  source: 'REPORT' | 'SAMPLE';
  reportIds: string[];
}

/** Por que uma amostra aparece na aba "Relacionadas". */
export type RelatedReason =
  | { kind: 'SAME_SHA256' }
  | { kind: 'SAME_HOST'; detail: string }
  | { kind: 'SAME_BASE_DOMAIN'; detail: string }
  | { kind: 'SHARED_TAGS'; detail: string[] }
  | { kind: 'SHARED_IOCS'; detail: string[] };

/** Linha de GET /api/entries/:id/related (da mais relevante para a menos). */
export interface RelatedEntry {
  entry: Entry;
  reasons: RelatedReason[];
  score: number;
}

/** Item da pasta "Favoritos" do navegador (GET /api/me/favorites). */
export interface Favorite {
  id: string;
  /** VIEW: visao de lista salva (`url`); ENTRY: amostra fixada (`entryId`). */
  kind: 'VIEW' | 'ENTRY';
  label: string;
  url: string | null;
  entryId: string | null;
  position: number;
  createdAt: string;
  entry: { id: string; title: string; status: EntryStatus; verdict: Verdict } | null;
}

export interface TagValue {
  id: string;
  name: string;
}

export interface EntryOwner {
  id: string;
  displayName: string;
  email: string;
}

/** Rascunho -> (Em revisao ->) Publicado. */
export type ReportStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED';

export interface Report {
  id: string;
  entryId: string;
  analystId: string;
  analyst: { id: string; displayName: string; role: Role };
  summary: string;
  findings?: string | null;
  iocs?: string | null;
  verdict: Verdict;
  status: ReportStatus;
  /** Revisao (quatro olhos). */
  submittedAt?: string | null;
  reviewedBy?: { id: string; displayName: string } | null;
  reviewedAt?: string | null;
  /** Comentario de quem devolveu o relatorio. */
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  ownerId: string;
  owner: EntryOwner;
  type: EntryType;
  title: string;
  description?: string | null;
  status: EntryStatus;
  verdict: Verdict;
  originalFilename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  sha256?: string | null;
  storageKey?: string | null;
  bucket?: string | null;
  url?: string | null;
  urlDomain?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Analista responsavel (atribuicao); null = sem responsavel. */
  assignee?: { id: string; displayName: string } | null;
  tags: TagValue[];
  reports?: Report[];
  _count?: { reports: number; duplicates?: number };
  /** Analise estatica do arquivo (so na ficha; as listas nao trazem). */
  staticInfo?: StaticInfo | null;
  /** Duplicata de outra amostra (a principal). */
  duplicateOfId?: string | null;
  duplicateOf?: { id: string; title: string } | null;
  /** Duplicatas desta amostra (GET /api/entries/:id, ate 50). */
  duplicates?: { id: string; title: string; createdAt: string }[];
  /** Quando entrou no status atual (idade na fila / prazo). */
  statusChangedAt?: string;
}

/** Limites do prazo (horas no status atual), vindos da API. */
export interface SlaConfig {
  warnHours: number;
  lateHours: number;
}

export interface ActivationKey {
  id: string;
  code: string;
  role: Role;
  maxUses: number;
  usesUsed: number;
  expiresAt?: string | null;
  revoked: boolean;
  createdAt: string;
  createdBy?: { id: string; displayName: string };
  usedBy?: { id: string; displayName: string; email: string }[];
}

export type SandboxStatus =
  'REQUESTED' | 'PROVISIONING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'EXPIRED' | 'FAILED';

export interface SandboxEntryRef {
  id: string;
  title: string;
  sha256?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
  owner?: { id: string; displayName: string };
}

export interface SandboxSession {
  id: string;
  entryId: string;
  analystId: string;
  node: string;
  vmid?: number | null;
  name: string;
  status: SandboxStatus;
  phase?: string | null;
  isoVolume?: string | null;
  upid?: string | null;
  ip?: string | null;
  lastError?: string | null;
  expiresAt: string;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  analyst?: { id: string; displayName: string };
  entry?: SandboxEntryRef;
}

export interface SandboxHealth {
  enabled: boolean;
  mock: boolean;
  node: string;
  templateVmid: number;
  isoStorage: string;
  ttlMinutes: number;
  maxActive: number;
  maxPerUser: number;
  consoleEnabled: boolean;
  activeSessions: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

export type EntryEventType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'VERDICT_CHANGED'
  | 'ASSIGNED'
  | 'REPORT_CREATED'
  | 'REPORT_PUBLISHED'
  | 'SANDBOX_OPENED'
  | 'SANDBOX_CLOSED'
  | 'SANDBOX_FAILED'
  | 'COMMENT'
  | 'MARKED_DUPLICATE'
  | 'UNMARKED_DUPLICATE'
  | 'REPORT_SUBMITTED'
  | 'REPORT_APPROVED'
  | 'REPORT_RETURNED';

/** Evento do historico da amostra (GET /api/entries/:id/events). */
export interface EntryEvent {
  id: string;
  entryId: string;
  type: EntryEventType;
  fromValue?: string | null;
  toValue?: string | null;
  detail?: string | null;
  createdAt: string;
  /** null = acao do sistema (ex.: expiracao do sandbox). */
  actor: { id: string; displayName: string } | null;
}
