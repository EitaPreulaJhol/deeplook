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
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { IocDetail, IocSighting } from '../api/types';
import { CopyButton } from '../components/CopyButton';
import { saveEntrySequence } from '../components/entryNav';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconArrowLeft, IconBell } from '../components/icons';
import { IOC_KIND_LABELS, iocHref, shortIoc, urlHostIoc } from '../components/iocs';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { useWorkspaceTitle } from '../components/workspace';
import { intlLocale } from '../i18n';
import { t } from '../i18n/detection';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

/** Onde o indicador aparece naquela amostra. */
function describe(sighting: IocSighting): string {
  switch (sighting.kind) {
    case 'REPORT':
      return t('reportBy', { analyst: sighting.analyst, date: fmtDate(sighting.createdAt) });
    case 'FILE':
      return t('isFile');
    case 'URL_HOST':
      return t('isHost');
    case 'URL_SAMPLE':
      return t('isLink');
  }
}

/**
 * Ficha do indicador (/iocs/:kind/:value): em quais amostras ele aparece -
 * citado num relatorio publicado, como o proprio arquivo ou como o dominio da
 * URL -, com a primeira e a ultima aparicao. Aberta pelo "Ir para:" e pelos
 * links de IOCs da amostra.
 */
export function IocPage() {
  const { kind = '', value = '' } = useParams();
  const navigate = useNavigate();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const query = useQuery({
    queryKey: ['ioc', kind, value],
    queryFn: () =>
      api.get<IocDetail>(`/iocs/${encodeURIComponent(kind)}/${encodeURIComponent(value)}`),
    retry: false,
  });
  // Na URL, o endereco leva a chave; o titulo mostra o link quando a ficha chega.
  useWorkspaceTitle(`IOC · ${shortIoc(query.data?.ioc.value ?? value)}`);

  // Alertas de IOC: seguir avisa na Caixa de entrada quando o indicador aparecer de novo.
  const queryClient = useQueryClient();
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchNotice, setWatchNotice] = useState<string | null>(null);
  const watching = query.data?.watching ?? false;
  const toggleWatch = async () => {
    setWatchBusy(true);
    setWatchNotice(null);
    try {
      const path = `/iocs/${encodeURIComponent(kind)}/${encodeURIComponent(value)}/watch`;
      if (watching) await api.del(path);
      else await api.post(path, {});
      await queryClient.invalidateQueries({ queryKey: ['ioc', kind, value] });
      await queryClient.invalidateQueries({ queryKey: ['me', 'watches'] });
      setWatchNotice(watching ? t('unfollowed') : t('following'));
    } catch (err) {
      setWatchNotice((err as Error).message);
    } finally {
      setWatchBusy(false);
    }
  };

  const toolbar = (
    <HpsmToolbar label={t('iocActions')}>
      <HpsmToolbarButton label={t('back')} icon={IconArrowLeft} onClick={() => navigate(-1)} />
      {query.data && (
        <HpsmToolbarButton
          label={watching ? t('unfollow') : t('follow')}
          icon={IconBell}
          pressed={watching}
          disabled={watchBusy}
          title={watching ? t('unfollowHelp') : t('followHelp')}
          onClick={() => void toggleWatch()}
        />
      )}
    </HpsmToolbar>
  );

  if (query.isLoading) return <HpsmLoading text={t('searchingIoc')} />;
  if (query.isError || !query.data) {
    return (
      <>
        {toolbar}
        <HpsmMessage kind="error">
          {t('invalidIoc', { error: (query.error as Error | null)?.message ?? value })}
        </HpsmMessage>
      </>
    );
  }

  const { ioc, items, total, firstSeen, lastSeen } = query.data;
  const host = ioc.kind === 'URL' ? urlHostIoc(ioc.value) : null;
  const open = (id: string) => {
    saveEntrySequence(items.map((item) => item.entry.id));
    navigate(`/entries/${id}`);
  };
  const onRowKeyDown = (event: KeyboardEvent, index: number, id: string) => {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : null;
    if (target !== null) {
      event.preventDefault();
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(id);
    }
  };

  return (
    <>
      {toolbar}
      {watchNotice && (
        <HpsmMessage key={watchNotice} kind="success">
          {watchNotice}
        </HpsmMessage>
      )}
      <PageHeader
        title={`${IOC_KIND_LABELS[ioc.kind]}: ${ioc.value}`}
        subtitle={t('iocSubtitle')}
      />
      {query.data?.allowed && (
        <HpsmMessage kind="info">
          {t('allowedIoc', {
            covered:
              query.data.allowed.by !== ioc.value
                ? ` ${t('coveredBy', { by: query.data.allowed.by })}`
                : '',
            reason: query.data.allowed.reason,
          })}
        </HpsmMessage>
      )}
      <div className="dl-summary">
        <span>
          <span className="dl-summary__label">{t('sumType')}</span> {IOC_KIND_LABELS[ioc.kind]}
        </span>
        <span className="dl-ioc-value">
          <span className="dl-summary__label">{t('sumValue')}</span>{' '}
          <span className="dl-mono">{ioc.value}</span>
          <CopyButton value={ioc.value} label="indicador" />
        </span>
        {host && (
          <span>
            <span className="dl-summary__label">{t('sumHost')}</span>{' '}
            <Link className="dl-link dl-mono" to={iocHref(host.kind, host.value)}>
              {host.value}
            </Link>
          </span>
        )}
        <span>
          <span className="dl-summary__label">{t('firstSeen')}</span> {fmtDate(firstSeen)}
        </span>
        <span>
          <span className="dl-summary__label">{t('lastSeen')}</span> {fmtDate(lastSeen)}
        </span>
        <span>
          <span className="dl-summary__label">{t('sumSamples')}</span> {total}
        </span>
      </div>

      {items.length === 0 ? (
        <HpsmMessage kind="info">{t('notSeenYet')}</HpsmMessage>
      ) : (
        <TableContainer>
          <Table size="xs" aria-label={t('iocSamplesAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{t('sample')}</TableHeader>
                <TableHeader scope="col">{t('type')}</TableHeader>
                <TableHeader scope="col">{t('status')}</TableHeader>
                <TableHeader scope="col">{t('verdict')}</TableHeader>
                <TableHeader scope="col">{t('whereSeen')}</TableHeader>
                <TableHeader scope="col">{t('submittedOn')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(({ entry, sightings }, index) => (
                <TableRow
                  key={entry.id}
                  ref={(el: HTMLTableRowElement | null) => {
                    rowRefs.current[index] = el;
                  }}
                  className="hpsm-grid-row"
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => open(entry.id)}
                  onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, entry.id)}
                >
                  <TableCell>
                    <span className="dl-cell-text" title={entry.title}>
                      {entry.title}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TypeTag type={entry.type} />
                  </TableCell>
                  <TableCell>
                    <StatusTag status={entry.status} />
                  </TableCell>
                  <TableCell>
                    <VerdictTag verdict={entry.verdict} />
                  </TableCell>
                  <TableCell>
                    <ul className="dl-related-reasons">
                      {sightings.map((s, i) => (
                        <li key={i}>{describe(s)}</li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>{fmtDate(entry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
