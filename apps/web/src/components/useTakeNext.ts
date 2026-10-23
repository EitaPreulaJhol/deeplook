import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';

/**
 * "Pegar a proxima" (Next in queue): atribui ao analista a amostra pendente
 * sem responsavel mais antiga, poe Em analise e abre a ficha. Sem nada na fila,
 * devolve o aviso para a barra de mensagens.
 */
export function useTakeNext() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [taking, setTaking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const take = async () => {
    setNotice(null);
    setTaking(true);
    try {
      const res = await api.post<{ entry: { id: string; title: string } }>('/entries/next', {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
        queryClient.invalidateQueries({ queryKey: ['entry', res.entry.id] }),
      ]);
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      const empty = err instanceof ApiError && err.status === 404;
      setNotice({ kind: empty ? 'info' : 'error', text: (err as Error).message });
    } finally {
      setTaking(false);
    }
  };

  return { take, taking, notice };
}
