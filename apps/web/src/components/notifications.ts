import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '../api/client';
import type { AppNotification, Verdict } from '../api/types';
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

/** Frase da notificacao ("Bruno Lima atribuiu a amostra a você"). */
export function notificationText(n: AppNotification): string {
  const who = n.actor?.displayName ?? 'O sistema';
  switch (n.type) {
    case 'ASSIGNED':
      return `${who} atribuiu a amostra a você`;
    case 'COMPLETED':
      return `${who} concluiu a sua amostra${
        n.detail ? ` (veredito: ${verdictLabel(n.detail as Verdict)})` : ''
      }`;
    case 'MENTION':
      return `${who} mencionou você numa atualização`;
    case 'COMMENT':
      return `${who} escreveu uma atualização`;
    case 'REPORT_APPROVED':
      return `${who} aprovou o seu relatório (publicado)`;
    case 'REPORT_RETURNED':
      return `${who} devolveu o seu relatório para ajustes`;
  }
}

/** Para onde a notificacao leva (atualizacoes abrem a aba Historico). */
export function notificationHref(n: AppNotification): string {
  const tab =
    n.type === 'MENTION' || n.type === 'COMMENT'
      ? '?tab=historico'
      : n.type === 'REPORT_APPROVED' || n.type === 'REPORT_RETURNED'
        ? '?tab=relatorios'
        : '';
  return `/entries/${n.entry.id}${tab}`;
}
