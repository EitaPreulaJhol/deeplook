import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '../api/client';
import type { Favorite } from '../api/types';

const KEY = ['favorites'];

/** Caminho do favorito no app (visao salva ou ficha da amostra). */
export function favoriteHref(favorite: Favorite): string {
  return favorite.kind === 'ENTRY' ? `/entries/${favorite.entryId}` : (favorite.url ?? '/');
}

/**
 * Nome sugerido para uma visao salva: os filtros ativos ("Pendentes · Malicioso ·
 * "phishing"") ou, sem filtros, o nome da lista. Cabe no limite de 60 caracteres.
 */
export function suggestViewName(
  base: string,
  parts: (string | false | null | undefined)[],
): string {
  const name = parts.filter(Boolean).join(' · ') || base;
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/** Endereco da lista atual sem a pagina: a visao salva sempre abre na pagina 1. */
export function currentViewUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('offset');
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Pasta "Favoritos" do navegador: visoes salvas e amostras fixadas do usuario.
 * As acoes lancam o erro da API (ex.: limite de 30, visao repetida) para a tela
 * mostrar na barra de mensagens.
 */
export function useFavorites() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ favorites: Favorite[] }>('/me/favorites'),
    staleTime: 60_000,
  });
  const favorites = query.data?.favorites ?? [];

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: KEY }),
    [queryClient],
  );

  const addView = useCallback(
    async (label: string, url: string) => {
      await api.post('/me/favorites', { kind: 'VIEW', label, url });
      await refresh();
    },
    [refresh],
  );

  const pinEntry = useCallback(
    async (entryId: string) => {
      await api.post('/me/favorites', { kind: 'ENTRY', entryId });
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, label: string) => {
      await api.patch(`/me/favorites/${id}`, { label });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/me/favorites/${id}`);
      await refresh();
    },
    [refresh],
  );

  /** Move o favorito uma posicao para cima (-1) ou para baixo (+1). */
  const move = useCallback(
    async (id: string, delta: -1 | 1) => {
      const current = queryClient.getQueryData<{ favorites: Favorite[] }>(KEY)?.favorites ?? [];
      const ids = current.map((f) => f.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      // Reordena na hora (a arvore nao "pula") e confirma com a API.
      queryClient.setQueryData<{ favorites: Favorite[] }>(KEY, (current) =>
        current
          ? { favorites: ids.map((fid) => current.favorites.find((f) => f.id === fid)!) }
          : current,
      );
      try {
        await api.put('/me/favorites/order', { ids });
      } finally {
        await refresh();
      }
    },
    [queryClient, refresh],
  );

  return { favorites, loading: query.isLoading, addView, pinEntry, rename, remove, move };
}
