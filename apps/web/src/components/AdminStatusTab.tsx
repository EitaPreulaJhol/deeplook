import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { StatusLevel, SystemStatus } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/admin';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconRefresh } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

/** Atualizacao automatica da pagina de status. */
const REFRESH_MS = 30_000;

const LEVELS: Record<StatusLevel, { tone: StatusTone; label: string }> = localized(() => ({
  ok: { tone: 'green', label: 'OK' },
  warn: { tone: 'orange', label: t('lvWarn') },
  error: { tone: 'red', label: t('lvError') },
  off: { tone: 'gray', label: t('lvOff') },
}));

/**
 * Aba "Status do sistema" da Administracao (System Status do HPSM): API,
 * banco, armazenamento, Proxmox e filas, com a situacao de cada um. Atualiza
 * sozinha a cada 30 s.
 */
export function AdminStatusTab() {
  const query = useQuery({
    queryKey: ['admin', 'status'],
    queryFn: () => api.get<SystemStatus>('/admin/status'),
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;

  return (
    <>
      <HpsmToolbar label={t('statusActions')}>
        <HpsmToolbarButton
          label={query.isFetching ? t('checking') : t('refresh')}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
        {data && (
          <span className="hpsm-toolbar__info">
            {t('checkedAt', { time: new Date(data.checkedAt).toLocaleTimeString(intlLocale()) })}
          </span>
        )}
      </HpsmToolbar>

      {query.isLoading && <HpsmLoading text={t('checkingComponents')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('statusError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {data?.overall === 'error' && <HpsmMessage kind="error">{t('someFailed')}</HpsmMessage>}
      {data?.overall === 'warn' && <HpsmMessage kind="warning">{t('someWarn')}</HpsmMessage>}

      {data && (
        <TableContainer>
          <Table size="xs" aria-label={t('statusAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('component')}</TableHeader>
                <TableHeader scope="col">{t('situation')}</TableHeader>
                <TableHeader scope="col">{t('summary')}</TableHeader>
                <TableHeader scope="col">{t('elapsed')}</TableHeader>
                <TableHeader scope="col">{t('details')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.checks.map((check) => (
                <TableRow key={check.id} className={`dl-status-row dl-status-row--${check.level}`}>
                  <TableCell>
                    <strong>{check.name}</strong>
                  </TableCell>
                  <TableCell>
                    <StatusText tone={LEVELS[check.level].tone}>
                      {LEVELS[check.level].label}
                    </StatusText>
                  </TableCell>
                  <TableCell>{check.summary}</TableCell>
                  <TableCell>
                    {check.latencyMs !== undefined ? `${check.latencyMs} ms` : '—'}
                  </TableCell>
                  <TableCell>
                    {check.details.length ? (
                      <span className="dl-status-details">
                        {check.details.map((d, i) => (
                          <span key={d.label}>
                            {i > 0 && ' · '}
                            <span className="dl-status-details__label">{d.label}:</span> {d.value}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
