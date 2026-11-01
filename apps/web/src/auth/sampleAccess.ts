import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';

/**
 * Usuario comum restrito ao que enviou (item 140). So decide o que a tela mostra:
 * quem garante a regra e a API; enquanto nao carrega, vale o menu completo.
 */
export function useOwnSamplesOnly(): boolean {
  const query = useQuery({
    queryKey: ['me', 'sample-access'],
    queryFn: () => api.get<{ ownOnly: boolean }>('/me/sample-access'),
    staleTime: 60_000,
  });
  return query.data?.ownOnly ?? false;
}
