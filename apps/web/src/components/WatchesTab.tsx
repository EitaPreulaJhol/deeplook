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
import type { IocKind } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';
import { HpsmSection } from './HpsmForm';
import { IocImportDialog } from './IocImportDialog';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { HpsmLoading, HpsmMessage } from './messages';

interface Watch {
  kind: IocKind;
  value: string;
  createdAt: string;
}

/**
 * Minha Conta > Indicadores (item 60): indicadores que a pessoa segue. Quando
 * um deles aparece numa amostra nova ou num relatorio publicado, chega um aviso
 * na Caixa de entrada.
 */
export function WatchesTab() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const query = useQuery({
    queryKey: ['me', 'watches'],
    queryFn: () => api.get<{ watches: Watch[] }>('/me/watches'),
  });
  const watches = query.data?.watches ?? [];

  const unwatch = async (w: Watch) => {
    setNotice(null);
    try {
      await api.del(`${iocHref(w.kind, w.value)}/watch`);
      await queryClient.invalidateQueries({ queryKey: ['me', 'watches'] });
      await queryClient.invalidateQueries({ queryKey: ['ioc'] });
      setNotice({ ok: true, text: t('unfollowedValue', { value: w.value }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text={t('loadingIocs')} />}
      <HpsmSection title={t('myWatchesN', { n: watches.length })}>
        <p className="dl-static-empty">
          {t('watchesHint')}{' '}
          <button type="button" className="dl-link-button" onClick={() => setImporting(true)}>
            {t('importList')}
          </button>
          .
        </p>
        {importing && (
          <IocImportDialog
            target="watch"
            onClose={() => setImporting(false)}
            onDone={(text) => {
              setImporting(false);
              setNotice({ ok: true, text });
              void queryClient.invalidateQueries({ queryKey: ['me', 'watches'] });
              void queryClient.invalidateQueries({ queryKey: ['ioc'] });
            }}
          />
        )}
        {watches.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label={t('myWatches')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('type')}</TableHeader>
                  <TableHeader scope="col">{t('indicator')}</TableHeader>
                  <TableHeader scope="col">{t('followingSince')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {watches.map((w) => (
                  <TableRow key={`${w.kind}:${w.value}`}>
                    <TableCell>{IOC_KIND_LABELS[w.kind]}</TableCell>
                    <TableCell>
                      <Link className="dl-link dl-mono" to={iocHref(w.kind, w.value)}>
                        {w.value}
                      </Link>
                    </TableCell>
                    <TableCell>{new Date(w.createdAt).toLocaleDateString(intlLocale())}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => void unwatch(w)}
                      >
                        {t('unfollow')}
                      </button>
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
