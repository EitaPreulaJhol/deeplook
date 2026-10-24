import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '../api/client';

export interface TeamView {
  id: string;
  label: string;
  url: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
  /** Amostras que a visao mostra agora (null = endereco que nao vale mais). */
  count: number | null;
  /** Quem compartilhou ou admin: pode renomear e remover. */
  canEdit: boolean;
}

const KEY = ['team-views'];

/**
 * Pasta "Visoes da equipe" (item 62): visoes do Historico Global compartilhadas
 * pelos analistas, com contador (atualiza a cada minuto). As acoes lancam o
 * erro da API para a tela mostrar.
 */
export function useTeamViews(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ views: TeamView[] }>('/team-views'),
    enabled,
    refetchInterval: 60_000,
  });
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: KEY }),
    [queryClient],
  );

  const share = useCallback(
    async (label: string, url: string) => {
      await api.post('/team-views', { label, url });
      await refresh();
    },
    [refresh],
  );
  const rename = useCallback(
    async (id: string, label: string) => {
      await api.patch(`/team-views/${id}`, { label });
      await refresh();
    },
    [refresh],
  );
  const remove = useCallback(
    async (id: string) => {
      await api.del(`/team-views/${id}`);
      await refresh();
    },
    [refresh],
  );

  return { views: query.data?.views ?? [], loading: query.isLoading, share, rename, remove };
}
