import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '../api/client';
import type { AppNotification, NotificationType, Verdict } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/shell';
import { verdictLabel } from './tags';

const COUNT_KEY = ['notifications', 'count'];

/** Contador de nao lidas (sininho e navegador): atualiza a cada minuto. */
export function useNotificationCount(enabled = true) {
  const query = useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => api.get<{ unread: number }>('/me/notifications/count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
  return query.data?.unread ?? 0;
}

/** Lista da caixa de entrada (as mais recentes primeiro). */
export function useNotifications(limit: number, onlyUnread = false, enabled = true) {
  return useQuery({
    queryKey: ['notifications', 'list', limit, onlyUnread],
    queryFn: () =>
      api.get<{ items: AppNotification[]; unread: number }>(
        `/me/notifications?limit=${limit}${onlyUnread ? '&unread=1' : ''}`,
      ),
    enabled,
  });
}

/** Marca como lidas (sem `ids`: todas) e atualiza contador e listas. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useCallback(
    async (ids?: string[]) => {
      const res = await api.post<{ unread: number }>('/me/notifications/read', ids ? { ids } : {});
      queryClient.setQueryData(COUNT_KEY, res);
      await queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
    [queryClient],
  );
}

/** Nome de cada tipo de aviso em Minha Conta > Notificações (item 164). */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = localized(() => ({
  ASSIGNED: t('ntlAssigned'),
  COMPLETED: t('ntlCompleted'),
  MENTION: t('ntlMention'),
  COMMENT: t('ntlComment'),
  REPORT_APPROVED: t('ntlApproved'),
  REPORT_RETURNED: t('ntlReturned'),
  IOC_SEEN: t('ntlIocSeen'),
  SLA_WARN: t('ntlSlaWarn'),
  SLA_LATE: t('ntlSlaLate'),
  RESOLUTION: t('ntlResolution'),
  CASE_MENTION: t('ntlCaseMention'),
  CASE_COMMENT: t('ntlCaseComment'),
  CASE_ENTRY_ADDED: t('ntlCaseAdded'),
  CASE_ENTRY_REMOVED: t('ntlCaseRemoved'),
  CASE_ASSIGNED: t('ntlCaseAssigned'),
  YARA_PACK_UPDATE: t('ntlPacks'),
}));

/** Frase da notificacao ("Bruno Lima atribuiu a amostra a você"). */
export function notificationText(n: AppNotification): string {
  const who = n.actor?.displayName ?? t('ntSystem');
  switch (n.type) {
    case 'ASSIGNED':
      return t('ntAssigned', { who });
    case 'COMPLETED':
      return (
        t('ntCompleted', { who }) +
        (n.detail ? ` ${t('ntVerdictParen', { verdict: verdictLabel(n.detail as Verdict) })}` : '')
      );
    case 'MENTION':
      return t('ntMention', { who });
    case 'COMMENT':
      return t('ntComment', { who });
    case 'REPORT_APPROVED':
      return t('ntApproved', { who });
    case 'REPORT_RETURNED':
      return t('ntReturned', { who });
    case 'YARA_PACK_UPDATE':
      return t('ntPacks', { detail: n.detail ?? t('ntUpdate') });
    case 'IOC_SEEN':
      return t('ntIocSeen', { detail: n.detail ?? t('ntAppeared') });
    case 'SLA_WARN':
      return t('ntSlaWarn', { h: n.detail ?? '?' });
    case 'SLA_LATE':
      return t('ntSlaLate', { h: n.detail ?? '?' });
    case 'RESOLUTION':
      return t('ntResolution', { who });
    case 'CASE_MENTION':
      return t('ntCaseMention', { who });
    case 'CASE_COMMENT':
      return t('ntCaseComment', { who });
    case 'CASE_ENTRY_ADDED':
      return t('ntCaseAdded', { who, what: n.detail ?? t('ntSamples') });
    case 'CASE_ENTRY_REMOVED':
      return t('ntCaseRemoved', { who, what: n.detail ?? t('ntASample') });
    case 'CASE_ASSIGNED':
      return t('ntCaseAssigned', { who });
  }
}

/**
 * Resolucao para quem enviou (item 87) mostrada no aviso: a escrita (RESOLUTION)
 * ou a atual da amostra no aviso de concluida.
 */
export function notificationResolution(n: AppNotification): string | null {
  if (n.type === 'RESOLUTION') return n.detail;
  if (n.type === 'COMPLETED') return n.entry?.resolution ?? null;
  return null;
}

/** Trecho citado abaixo da frase (atualizacoes, comentarios e devolucao). */
export function notificationQuote(n: AppNotification): string | null {
  const quoted: AppNotification['type'][] = [
    'MENTION',
    'COMMENT',
    'REPORT_RETURNED',
    'CASE_MENTION',
    'CASE_COMMENT',
  ];
  return quoted.includes(n.type) ? n.detail : null;
}

/** Do que se trata: o titulo da amostra ou "CASO-0001 · titulo" (item 89). */
export function notificationTarget(n: AppNotification): string {
  if (n.case) return `${n.case.code} · ${n.case.title}`;
  if (n.type === 'YARA_PACK_UPDATE') return t('ntPacksTarget');
  return n.entry?.title ?? '—';
}

/** Para onde a notificacao leva (atualizacoes abrem a aba Historico). */
export function notificationHref(n: AppNotification): string {
  const tab =
    n.type === 'MENTION' || n.type === 'COMMENT'
      ? '?tab=historico'
      : n.type === 'REPORT_APPROVED' ||
          n.type === 'REPORT_RETURNED' ||
          (n.type === 'IOC_SEEN' && n.detail?.endsWith('relatório publicado'))
        ? '?tab=relatorios'
        : '';
  // Avisos de casos abrem o caso (item 89).
  if (n.case) return `/casos/${n.case.id}`;
  if (n.type === 'YARA_PACK_UPDATE') return '/admin?tab=settings';
  return `/entries/${n.entry?.id}${tab}`;
}
