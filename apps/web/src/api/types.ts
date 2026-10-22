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
export type StartPage = 'welcome' | 'history' | 'mine';

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

export interface Report {
  id: string;
  entryId: string;
  analystId: string;
  analyst: { id: string; displayName: string; role: Role };
  summary: string;
  findings?: string | null;
  iocs?: string | null;
  verdict: Verdict;
  published: boolean;
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
  _count?: { reports: number };
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
  | 'COMMENT';

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
