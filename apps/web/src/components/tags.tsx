import type { ReactNode } from 'react';

import type { EntryStatus, EntryType, Role, Verdict } from '../api/types';

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

const VERDICT_MAP: Record<Verdict, { label: string; tone: StatusTone }> = {
  UNKNOWN: { label: 'Desconhecido', tone: 'gray' },
  CLEAN: { label: 'Limpo', tone: 'green' },
  SUSPICIOUS: { label: 'Suspeito', tone: 'orange' },
  MALICIOUS: { label: 'Malicioso', tone: 'red' },
};

const STATUS_MAP: Record<EntryStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: 'Pendente', tone: 'gray' },
  IN_REVIEW: { label: 'Em análise', tone: 'blue' },
  COMPLETED: { label: 'Concluído', tone: 'green' },
};

const ROLE_LABELS: Record<Role, string> = {
  USER: 'Usuário',
  ANALYST: 'Analista',
  ADMIN: 'Admin',
};

export function statusLabel(status: EntryStatus): string {
  return (STATUS_MAP[status] ?? STATUS_MAP.PENDING).label;
}

export function verdictLabel(verdict: Verdict): string {
  return (VERDICT_MAP[verdict] ?? VERDICT_MAP.UNKNOWN).label;
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? ROLE_LABELS.USER;
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
  return <StatusText>{type === 'FILE' ? 'Arquivo' : 'Link'}</StatusText>;
}

export function RoleTag({ role }: { role: Role }) {
  return <StatusText>{roleLabel(role)}</StatusText>;
}
