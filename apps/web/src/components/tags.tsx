import { Tag } from '@carbon/react';

import type { EntryStatus, EntryType, Role, Verdict } from '../api/types';

type TagType =
  | 'red'
  | 'magenta'
  | 'purple'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'green'
  | 'gray'
  | 'cool-gray'
  | 'warm-gray'
  | 'high-contrast'
  | 'outline';

const VERDICT_MAP: Record<Verdict, { label: string; type: TagType }> = {
  UNKNOWN: { label: 'Desconhecido', type: 'gray' },
  CLEAN: { label: 'Limpo', type: 'green' },
  SUSPICIOUS: { label: 'Suspeito', type: 'magenta' },
  MALICIOUS: { label: 'Malicioso', type: 'red' },
};

const STATUS_MAP: Record<EntryStatus, { label: string; type: TagType }> = {
  PENDING: { label: 'Pendente', type: 'warm-gray' },
  IN_REVIEW: { label: 'Em análise', type: 'blue' },
  COMPLETED: { label: 'Concluído', type: 'green' },
};

const ROLE_MAP: Record<Role, { label: string; type: TagType }> = {
  USER: { label: 'Usuário', type: 'cool-gray' },
  ANALYST: { label: 'Analista', type: 'purple' },
  ADMIN: { label: 'Admin', type: 'red' },
};

export function VerdictTag({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_MAP[verdict] ?? VERDICT_MAP.UNKNOWN;
  return (
    <Tag type={v.type} size="sm">
      {v.label}
    </Tag>
  );
}

export function StatusTag({ status }: { status: EntryStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.PENDING;
  return (
    <Tag type={s.type} size="sm">
      {s.label}
    </Tag>
  );
}

export function TypeTag({ type }: { type: EntryType }) {
  return (
    <Tag type={type === 'FILE' ? 'cool-gray' : 'cyan'} size="sm">
      {type === 'FILE' ? 'Arquivo' : 'Link'}
    </Tag>
  );
}

export function RoleTag({ role }: { role: Role }) {
  const r = ROLE_MAP[role] ?? ROLE_MAP.USER;
  return (
    <Tag type={r.type} size="sm">
      {r.label}
    </Tag>
  );
}
