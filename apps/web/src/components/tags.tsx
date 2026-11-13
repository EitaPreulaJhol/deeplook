import type { ReactNode } from 'react';

import type { EntryStatus, EntryType, Priority, Role, Verdict } from '../api/types';
import { type MessageKey, t } from '../i18n';

/**
 * Cor do marcador ao lado do texto. `none` = texto puro (sem marcador).
 * No HP Service Manager status/prioridade aparecem como texto na celula,
 * no maximo com um pequeno indicador colorido - nunca como "pilula".
 */
export type StatusTone = 'green' | 'red' | 'orange' | 'blue' | 'gray' | 'none';

export function StatusText({
  tone = 'none',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={`hpsm-status hpsm-status--${tone}`}>
      {tone !== 'none' && <span className="hpsm-status__bullet" aria-hidden="true" />}
      {children}
    </span>
  );
}

// Os rotulos vem do dicionario (src/i18n), no idioma atual; aqui so a cor.
const VERDICT_MAP: Record<Verdict, { readonly label: string; tone: StatusTone }> = {
  UNKNOWN: {
    get label() {
      return t('tag.verdict.UNKNOWN');
    },
    tone: 'gray',
  },
  CLEAN: {
    get label() {
      return t('tag.verdict.CLEAN');
    },
    tone: 'green',
  },
  SUSPICIOUS: {
    get label() {
      return t('tag.verdict.SUSPICIOUS');
    },
    tone: 'orange',
  },
  MALICIOUS: {
    get label() {
      return t('tag.verdict.MALICIOUS');
    },
    tone: 'red',
  },
};

const PRIORITY_MAP: Record<Priority, { readonly label: string; tone: StatusTone }> = {
  P1: {
    get label() {
      return t('tag.priority.P1');
    },
    tone: 'red',
  },
  P2: {
    get label() {
      return t('tag.priority.P2');
    },
    tone: 'orange',
  },
  P3: {
    get label() {
      return t('tag.priority.P3');
    },
    tone: 'blue',
  },
  P4: {
    get label() {
      return t('tag.priority.P4');
    },
    tone: 'gray',
  },
};

export function priorityLabel(priority: Priority): string {
  return PRIORITY_MAP[priority].label;
}

export function PriorityTag({ priority = 'P3' }: { priority?: Priority }) {
  const p = PRIORITY_MAP[priority];
  return <StatusText tone={p.tone}>{p.label}</StatusText>;
}

const STATUS_MAP: Record<EntryStatus, { readonly label: string; tone: StatusTone }> = {
  PENDING: {
    get label() {
      return t('tag.status.PENDING');
    },
    tone: 'gray',
  },
  IN_REVIEW: {
    get label() {
      return t('tag.status.IN_REVIEW');
    },
    tone: 'blue',
  },
  COMPLETED: {
    get label() {
      return t('tag.status.COMPLETED');
    },
    tone: 'green',
  },
};

const ROLE_KEYS = {
  USER: 'tag.role.USER',
  ANALYST: 'tag.role.ANALYST',
  ADMIN: 'tag.role.ADMIN',
} as const satisfies Record<Role, MessageKey>;

export function statusLabel(status: EntryStatus): string {
  return (STATUS_MAP[status] ?? STATUS_MAP.PENDING).label;
}

export function verdictLabel(verdict: Verdict): string {
  return (VERDICT_MAP[verdict] ?? VERDICT_MAP.UNKNOWN).label;
}

export function roleLabel(role: Role): string {
  return t(ROLE_KEYS[role] ?? ROLE_KEYS.USER);
}

export function VerdictTag({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_MAP[verdict] ?? VERDICT_MAP.UNKNOWN;
  return <StatusText tone={v.tone}>{v.label}</StatusText>;
}

export function StatusTag({ status }: { status: EntryStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.PENDING;
  return <StatusText tone={s.tone}>{s.label}</StatusText>;
}

export function TypeTag({ type }: { type: EntryType }) {
  return <StatusText>{t(type === 'FILE' ? 'tag.type.FILE' : 'tag.type.URL')}</StatusText>;
}

export function RoleTag({ role }: { role: Role }) {
  return <StatusText>{roleLabel(role)}</StatusText>;
}
