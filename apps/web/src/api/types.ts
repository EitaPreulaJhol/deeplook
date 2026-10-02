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
  tags: TagValue[];
  reports?: Report[];
  _count?: { reports: number };
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
  | 'REQUESTED'
  | 'PROVISIONING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'EXPIRED'
  | 'FAILED';

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
