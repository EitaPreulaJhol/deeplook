import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { intlLocale } from '../i18n';
import { t } from '../i18n/frame';

export interface Broadcast {
  id: string;
  text: string;
  level: 'INFO' | 'WARNING';
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
  case: { id: string; number: number; title: string; code: string } | null;
}

/** Avisos ativos ainda nao dispensados (faixa e Pagina Inicial dividem o cache). */
export function useActiveBroadcasts() {
  return useQuery({
    queryKey: ['broadcasts', 'active'],
    queryFn: () => api.get<{ items: Broadcast[] }>('/broadcasts/active'),
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });
}

/** "ate 30/10, 18:00". */
function until(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Faixa de avisos gerais (item 88) no topo da area de trabalho: texto puro,
 * quem publicou, ate quando e o caso ligado. "Dispensar" esconde so para a
 * pessoa.
 */
export function BroadcastBanner() {
  const queryClient = useQueryClient();
  const query = useActiveBroadcasts();
  const items = query.data?.items ?? [];
  if (!items.length) return null;

  const dismiss = async (id: string) => {
    await api.post(`/broadcasts/${id}/dismiss`);
    await queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
  };

  return (
    <div className="dl-broadcasts" role="region" aria-label={t('banner.aria')}>
      {items.map((b) => (
        <div
          key={b.id}
          className={`dl-broadcast dl-broadcast--${b.level.toLowerCase()}`}
          role="status"
        >
          <span className="dl-broadcast__icon" aria-hidden="true">
            {b.level === 'WARNING' ? '⚠' : 'ℹ'}
          </span>
          <span className="dl-broadcast__text">
            <strong>{b.level === 'WARNING' ? t('banner.warning') : t('banner.notice')} </strong>
            {b.text}
            {b.case && (
              <>
                {' '}
                <Link className="dl-link" to={`/casos/${b.case.id}`}>
                  ({b.case.code})
                </Link>
              </>
            )}
          </span>
          <span className="dl-broadcast__meta">
            {b.createdBy?.displayName ?? t('banner.team')} ·{' '}
            {t('banner.until', { date: until(b.expiresAt) })}
          </span>
          <button
            type="button"
            className="dl-broadcast__close"
            aria-label={t('banner.dismiss', { text: b.text })}
            title={t('banner.dismissHint')}
            onClick={() => void dismiss(b.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
