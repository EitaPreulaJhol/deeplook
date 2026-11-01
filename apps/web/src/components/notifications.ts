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
    case 'YARA_PACK_UPDATE':
      return `Pacotes de regras: ${n.detail ?? 'atualização'}`;
    case 'IOC_SEEN':
      return `Indicador que você segue: ${n.detail ?? 'apareceu numa amostra'}`;
    case 'SLA_WARN':
      return `Prazo em alerta: mais de ${n.detail ?? '?'} h no mesmo status`;
    case 'SLA_LATE':
      return `Amostra atrasada: mais de ${n.detail ?? '?'} h no mesmo status`;
    case 'RESOLUTION':
      return `${who} escreveu o que fazer com a sua amostra`;
    case 'CASE_MENTION':
      return `${who} mencionou você num comentário do caso`;
    case 'CASE_COMMENT':
      return `${who} comentou no caso sob sua responsabilidade`;
    case 'CASE_ENTRY_ADDED':
      return `${who} incluiu ${n.detail ?? 'amostras'} no seu caso`;
    case 'CASE_ENTRY_REMOVED':
      return `${who} retirou "${n.detail ?? 'uma amostra'}" do seu caso`;
    case 'CASE_ASSIGNED':
      return `${who} atribuiu o caso a você`;
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
  if (n.type === 'YARA_PACK_UPDATE') return 'Pacotes de regras YARA';
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
