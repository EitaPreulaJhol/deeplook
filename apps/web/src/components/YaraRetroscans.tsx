import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Verdict } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/detection';
import { HpsmSection } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusTag, StatusText, VerdictTag } from './tags';

type RetroStatus = 'RUNNING' | 'DONE' | 'CANCELLED' | 'FAILED';

export interface Retroscan {
  id: string;
  ruleId: string | null;
  ruleName: string;
  status: RetroStatus;
  total: number;
  scanned: number;
  matched: number;
  failed: number;
  skipped: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  startedBy: { id: string; displayName: string } | null;
}

interface RetroscanDetail extends Retroscan {
  hits: {
    identifiers: string[];
    entry: { id: string; title: string; verdict: Verdict; status: EntryStatus };
  }[];
}

const STATUS: Record<RetroStatus, { label: string; tone: StatusTone }> = localized(() => ({
  RUNNING: { label: t('retroRunningSt'), tone: 'blue' },
  DONE: { label: t('retroDone'), tone: 'green' },
  CANCELLED: { label: t('retroCancelled'), tone: 'gray' },
  FAILED: { label: t('retroFailed'), tone: 'red' },
}));

const fmt = (n: number) => n.toLocaleString(intlLocale());

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** "1.240 de 3.000 (41%)" com a barrinha. */
function Progress({ r }: { r: Retroscan }) {
  const pct = r.total ? Math.floor((r.scanned / r.total) * 100) : 100;
  return (
    <span className="dl-retro-progress">
      <span className="dl-retro-progress__track" aria-hidden="true">
        <span className="dl-retro-progress__bar" style={{ width: `${pct}%` }} />
      </span>
      {t('progressOf', { n: fmt(r.scanned), total: fmt(r.total), pct })}
    </span>
  );
}

/** Lista das ultimas varreduras retroativas; atualiza sozinha enquanto alguma roda. */
export function useRetroscans() {
  return useQuery({
    queryKey: ['yara-retroscans'],
    queryFn: () => api.get<{ items: Retroscan[] }>('/yara/retroscans'),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'RUNNING') ? 2000 : false,
  });
}

/**
 * Secao "Varreduras retroativas" da tela Regras YARA (item 67): progresso,
 * cancelar e a lista das amostras que casaram.
 */
export function YaraRetroscans({
  onNotice,
}: {
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const query = useRetroscans();
  const items = query.data?.items ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = items.find((r) => r.id === openId);
  const detail = useQuery({
    queryKey: ['yara-retroscan', openId],
    queryFn: () => api.get<{ retroscan: RetroscanDetail }>(`/yara/retroscans/${openId}`),
    enabled: Boolean(openId),
    refetchInterval: openItem?.status === 'RUNNING' ? 2000 : false,
  });

  const cancel = async (r: Retroscan) => {
    try {
      await api.post(`/yara/retroscans/${r.id}/cancel`, {});
      onNotice({ ok: true, text: t('cancellingScan', { name: r.ruleName }) });
      await queryClient.invalidateQueries({ queryKey: ['yara-retroscans'] });
    } catch (err) {
      onNotice({ ok: false, text: (err as Error).message });
    }
  };

  if (!items.length) return null;
  const d = detail.data?.retroscan;
  return (
    <HpsmSection title={t('retroTitle')} className="dl-mt-lg">
      <TableContainer>
        <Table size="xs" aria-label={t('retroTitle')}>
          <TableHead>
            <TableRow>
              <TableHeader scope="col">{t('rule')}</TableHeader>
              <TableHeader scope="col">{t('situation')}</TableHeader>
              <TableHeader scope="col">{t('progress')}</TableHeader>
              <TableHeader scope="col">{t('matchedCol')}</TableHeader>
              <TableHeader scope="col">{t('started')}</TableHeader>
              <TableHeader scope="col">{t('actions')}</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id} className={openId === r.id ? 'is-selected' : undefined}>
                <TableCell>{r.ruleName}</TableCell>
                <TableCell>
                  <StatusText tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusText>
                  {r.error && <span className="dl-retro-note"> · {r.error}</span>}
                </TableCell>
                <TableCell>
                  <Progress r={r} />
                  {(r.failed > 0 || r.skipped > 0) && (
                    <span className="dl-retro-note">
                      {r.failed > 0 && ` · ${t('unreadableN', { n: fmt(r.failed) })}`}
                      {r.skipped > 0 && ` · ${t('over100N', { n: fmt(r.skipped) })}`}
                    </span>
                  )}
                </TableCell>
                <TableCell>{fmt(r.matched)}</TableCell>
                <TableCell>
                  {fmtDate(r.startedAt)}
                  {r.startedBy ? ` por ${r.startedBy.displayName}` : ''}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="dl-link-button"
                    aria-expanded={openId === r.id}
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    {openId === r.id ? t('hideHits') : t('viewHits', { n: fmt(r.matched) })}
                  </button>
                  {r.status === 'RUNNING' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="dl-link-button dl-link-button--danger"
                        onClick={() => void cancel(r)}
                      >
                        {t('cancel')}
                      </button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {openId && (
        <div className="dl-retro-hits" aria-live="polite">
          <h3 className="dl-retro-hits__head">
            {t('matchedSamples', { name: openItem?.ruleName })}
          </h3>
          {detail.isLoading && <p className="dl-static-empty">{t('loadingDots')}</p>}
          {d && d.hits.length === 0 && (
            <p className="dl-static-empty">
              {d.status === 'RUNNING' ? t('noneYet') : t('noneMatched')}
            </p>
          )}
          {d && d.hits.length > 0 && (
            <ul>
              {d.hits.map((h) => (
                <li key={h.entry.id}>
                  <Link className="dl-link" to={`/entries/${h.entry.id}`}>
                    {h.entry.title}
                  </Link>{' '}
                  <VerdictTag verdict={h.entry.verdict} /> <StatusTag status={h.entry.status} />{' '}
                  <span className="dl-mono dl-retro-note">{h.identifiers.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </HpsmSection>
  );
}
