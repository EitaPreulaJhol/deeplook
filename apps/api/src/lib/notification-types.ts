import type { NotificationType, Role } from '../generated/prisma/client';

/**
 * Tipos de aviso (item 164): quem pode receber e se a pessoa pode silenciar. O Record
 * obriga a classificar todo tipo novo. Nao se silencia o que pede acao de alguem.
 */
export const NOTIFICATION_TYPES: Record<
  NotificationType,
  { audience: 'all' | 'analyst' | 'admin'; locked: boolean }
> = {
  ASSIGNED: { audience: 'analyst', locked: true },
  COMPLETED: { audience: 'all', locked: false },
  MENTION: { audience: 'all', locked: false },
  COMMENT: { audience: 'all', locked: false },
  REPORT_APPROVED: { audience: 'analyst', locked: false },
  REPORT_RETURNED: { audience: 'analyst', locked: true },
  IOC_SEEN: { audience: 'all', locked: false },
  SLA_WARN: { audience: 'analyst', locked: false },
  SLA_LATE: { audience: 'analyst', locked: true },
  RESOLUTION: { audience: 'all', locked: true },
  CASE_MENTION: { audience: 'analyst', locked: false },
  CASE_COMMENT: { audience: 'analyst', locked: false },
  CASE_ENTRY_ADDED: { audience: 'analyst', locked: false },
  CASE_ENTRY_REMOVED: { audience: 'analyst', locked: false },
  CASE_ASSIGNED: { audience: 'analyst', locked: true },
  YARA_PACK_UPDATE: { audience: 'admin', locked: true },
  // O ambiente da pessoa sumiu da tela: ela precisa saber por que (plans/monitoramento).
  SANDBOX_STOPPED_BY_ADMIN: { audience: 'analyst', locked: true },
};

/** Pode ser silenciado: tipo conhecido e nao travado. */
export function isMutable(type: string): type is NotificationType {
  return (
    Object.hasOwn(NOTIFICATION_TYPES, type) && !NOTIFICATION_TYPES[type as NotificationType].locked
  );
}

/** Tipos que a pessoa pode receber, pelo papel, na ordem do Record. */
export function notificationTypesFor(role: Role) {
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[])
    .filter((type) => {
      const { audience } = NOTIFICATION_TYPES[type];
      return (
        audience === 'all' || role === 'ADMIN' || (audience === 'analyst' && role === 'ANALYST')
      );
    })
    .map((type) => ({ type, locked: NOTIFICATION_TYPES[type].locked }));
}
