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

import { api } from '../api/client';
import { intlLocale } from '../i18n';
import { t } from '../i18n/account';
import { useConfirm } from './HpsmConfirm';
import { HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconLogout } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface SessionRow {
  handle: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Minha Conta > Sessoes (item 61): navegadores onde a conta esta logada, com IP
 * e ultimo acesso; encerrar uma sessao ou todas as outras (ex.: computador
 * emprestado, celular perdido).
 */
export function SessionsTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () => api.get<{ sessions: SessionRow[] }>('/me/sessions'),
  });
  const sessions = query.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
      setNotice({ ok: true, text });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: SessionRow) => {
    const ok = await confirm({
      title: t('endSession'),
      message: t('endSessionConfirm', { device: s.device, ip: s.ip ? ` (${s.ip})` : '' }),
      confirmLabel: t('end'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/me/sessions/${s.handle}`);
      return t('sessionEnded', { device: s.device });
    });
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: t('endOthers'),
      message: t('endOthersConfirm', { n: others }),
      confirmLabel: t('end'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const res = await api.post<{ revoked: number }>('/me/sessions/revoke-others', {});
      return t('sessionsEnded', { n: res.revoked });
    });
  };

  return (
    <>
      <HpsmToolbar label={t('sessionActions')}>
        <HpsmToolbarButton
          label={t('endOthers')}
          icon={IconLogout}
          disabled={busy || others === 0}
          title={others === 0 ? t('noOthers') : undefined}
          onClick={() => void revokeOthers()}
        />
      </HpsmToolbar>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text={t('loadingSessions')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      <HpsmSection title={t('openSessionsN', { n: sessions.length })}>
        <p className="dl-static-empty">{t('sessionsHint')}</p>
        {sessions.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label={t('openSessions')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('browser')}</TableHeader>
                  <TableHeader scope="col">IP</TableHeader>
                  <TableHeader scope="col">{t('signedInAt')}</TableHeader>
                  <TableHeader scope="col">{t('lastAccess')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.handle}>
                    <TableCell>
                      <span title={s.userAgent ?? undefined}>{s.device}</span>
                      {s.current && (
                        <>
                          {' '}
                          <StatusText tone="green">{t('thisSession')}</StatusText>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="dl-mono">{s.ip ?? '—'}</span>
                    </TableCell>
                    <TableCell>{fmtDate(s.createdAt)}</TableCell>
                    <TableCell>{fmtDate(s.lastSeenAt)}</TableCell>
                    <TableCell>
                      {s.current ? (
                        '—'
                      ) : (
                        <button
                          type="button"
                          className="dl-link-button dl-link-button--danger"
                          disabled={busy}
                          onClick={() => void revoke(s)}
                        >
                          {t('endEllipsis')}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
