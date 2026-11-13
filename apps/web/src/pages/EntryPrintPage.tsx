import { Theme } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, EntryEvent } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { describeEvent } from '../components/EntryHistoryTab';
import { formatFileSize } from '../components/HpsmFileDrop';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPrint } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { evidenceUrl } from '../components/ReportEvidence';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/misc';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

/** Linha "rotulo: valor" da tabela de dados. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/**
 * Ficha para impressao da amostra (menu "Mais" > Imprimir ficha), fora da casca:
 * dados, relatorios publicados e historico de uma vez, com "Impresso por / em".
 * Nada do ambiente isolado (console, credenciais) entra na ficha. Com `?auto=1`
 * abre a caixa de impressao assim que carrega.
 */
export function EntryPrintPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const printedAt = useRef(new Date().toISOString());

  const entryQuery = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<{ entry: Entry }>(`/entries/${id}`),
  });
  const eventsQuery = useQuery({
    queryKey: ['entry', id, 'events'],
    queryFn: () => api.get<{ events: EntryEvent[] }>(`/entries/${id}/events`),
  });

  const entry = entryQuery.data?.entry;
  const events = eventsQuery.data?.events;
  const ready = Boolean(entry && events);

  useEffect(() => {
    if (entry) document.title = tr('printEntryTitle', { title: entry.title });
  }, [entry]);

  // Impressao automatica (uma vez) quando tudo carregou.
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current || searchParams.get('auto') !== '1') return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [ready, searchParams]);

  let body: ReactNode;
  if (entryQuery.isLoading || eventsQuery.isLoading) {
    body = <HpsmLoading text={tr('preparingRecord')} />;
  } else if (!entry || !events) {
    body = <HpsmMessage kind="error">{tr('sampleNotFound')}</HpsmMessage>;
  } else {
    const published = (entry.reports ?? []).filter((r) => r.status === 'PUBLISHED');
    body = (
      <>
        <section className="dl-print__section">
          <h2>{tr('sampleData')}</h2>
          <table className="dl-print__kv">
            <tbody>
              <Row label="ID">{entry.id}</Row>
              <Row label={tr('type')}>
                <TypeTag type={entry.type} />
              </Row>
              <Row label={tr('status')}>
                <StatusTag status={entry.status} />
              </Row>
              <Row label={tr('verdict')}>
                <VerdictTag verdict={entry.verdict} />
              </Row>
              <Row label={tr('assignee')}>{entry.assignee?.displayName ?? '—'}</Row>
              <Row label={tr('submittedByM')}>
                {entry.owner.displayName}
                {entry.owner.email && ` (${entry.owner.email})`}
              </Row>
              <Row label={tr('submittedOnM')}>{fmtDate(entry.createdAt)}</Row>
              <Row label={tr('inStatusSince')}>{fmtDate(entry.statusChangedAt)}</Row>
              {entry.duplicateOf && (
                <Row label={tr('duplicateOf')}>
                  {entry.duplicateOf.title} ({entry.duplicateOf.id})
                </Row>
              )}
              {(entry._count?.duplicates ?? 0) > 0 && (
                <Row label={tr('duplicates')}>{entry._count?.duplicates}</Row>
              )}
              {entry.type === 'FILE' ? (
                <>
                  <Row label={tr('file')}>
                    {entry.originalFilename ?? '—'} ({formatFileSize(entry.fileSize)})
                  </Row>
                  <Row label={tr('mimeType')}>{entry.mimeType ?? '—'}</Row>
                  {entry.staticInfo?.detectedType && (
                    <Row label={tr('realType')}>
                      {entry.staticInfo.detectedType.label}
                      {entry.staticInfo.extensionMismatch?.dangerous &&
                        ` ${tr('disguisedAs', { ext: entry.staticInfo.extensionMismatch.declared })}`}
                    </Row>
                  )}
                  {entry.staticInfo && (
                    <Row label={tr('entropy')}>
                      {tr('entropyOf8', { value: entry.staticInfo.entropy.toFixed(2) })}
                    </Row>
                  )}
                  <Row label="SHA-256">
                    <span className="dl-print__mono">{entry.sha256 ?? '—'}</span>
                  </Row>
                </>
              ) : (
                <Row label="URL">
                  <span className="dl-print__mono">{entry.url}</span>
                </Row>
              )}
              <Row label={tr('tags')}>{entry.tags.map((t) => t.name).join(', ') || '—'}</Row>
            </tbody>
          </table>
          <h3>{tr('description')}</h3>
          <p className="dl-print__text">{entry.description || '—'}</p>
        </section>

        <section className="dl-print__section">
          <h2>{tr('publishedReportsN', { n: published.length })}</h2>
          {published.length === 0 && <p>{tr('noPublished')}</p>}
          {published.map((report) => (
            <article key={report.id} className="dl-print__report">
              <h3>
                {tr('reportHeader', {
                  name: report.analyst.displayName,
                  date: fmtDate(report.createdAt),
                })}{' '}
                <VerdictTag verdict={report.verdict} />
              </h3>
              <h4>{tr('summary')}</h4>
              <p className="dl-print__text">{report.summary}</p>
              {report.findings && (
                <>
                  <h4>{tr('findings')}</h4>
                  <p className="dl-print__text">{report.findings}</p>
                </>
              )}
              {report.iocs && (
                <>
                  <h4>IOCs</h4>
                  <p className="dl-print__text dl-print__mono">{report.iocs}</p>
                </>
              )}
              {(report.evidence?.length ?? 0) > 0 && (
                <>
                  <h4>{tr('evidenceN', { n: report.evidence?.length })}</h4>
                  <div className="dl-print__evidence">
                    {(report.evidence ?? []).map((e, i) => (
                      <figure key={e.id}>
                        <img
                          src={evidenceUrl(e.id)}
                          alt={e.caption || tr('evidenceItem', { n: i + 1 })}
                        />
                        <figcaption>{e.caption || tr('evidenceItem', { n: i + 1 })}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}
            </article>
          ))}
        </section>

        <section className="dl-print__section">
          <h2>{tr('historyN', { n: events.length })}</h2>
          <table className="dl-print__grid">
            <thead>
              <tr>
                <th scope="col">{tr('date')}</th>
                <th scope="col">{tr('user')}</th>
                <th scope="col">{tr('event')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{fmtDate(event.createdAt)}</td>
                  <td>{event.actor?.displayName ?? tr('system')}</td>
                  <td>
                    {describeEvent(event)}
                    {event.type === 'COMMENT' && (
                      <span className="dl-print__text">: {event.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    );
  }

  return (
    <Theme theme="g10">
      <div className="dl-print">
        <div className="dl-print__toolbar">
          <HpsmToolbar label={tr('recordActions')}>
            <HpsmToolbarButton
              label={tr('print')}
              icon={IconPrint}
              disabled={!ready}
              onClick={() => window.print()}
            />
            <HpsmToolbarButton label={tr('close')} onClick={() => window.close()} />
          </HpsmToolbar>
        </div>

        <header className="dl-print__head">
          <img src="/icons/magnifier.svg" alt="" className="dl-print__logo" />
          <div>
            <div className="dl-print__brand">{tr('brandRecord')}</div>
            <h1 className="dl-print__title">{entry?.title ?? tr('sample')}</h1>
          </div>
          <div className="dl-print__meta">
            {tr('printedBy', { name: user?.displayName ?? '—' })}
            <br />
            {tr('printedOn', { date: fmtDate(printedAt.current) })}
          </div>
        </header>

        {body}

        <footer className="dl-print__foot">{tr('printWarning')}</footer>
      </div>
    </Theme>
  );
}
