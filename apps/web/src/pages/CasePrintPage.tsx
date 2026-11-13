import { Theme } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAttack } from '../components/attack';
import type { CaseDetail, CaseIoc } from '../components/cases';
import { CASE_STATUS, caseEventText, caseTechniques } from '../components/cases';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPrint } from '../components/icons';
import { IOC_KIND_LABELS } from '../components/iocs';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { evidenceUrl } from '../components/ReportEvidence';
import { PriorityTag, StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/cases';

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
 * Caso para impressao (item 74), fora da casca e no visual da ficha impressa:
 * dados, amostras com hash e veredito, relatorios publicados, IOCs de todas as
 * amostras, tecnicas ATT&CK e linha do tempo. Com `?auto=1` abre a caixa de
 * impressao assim que carrega.
 */
export function CasePrintPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const printedAt = useRef(new Date().toISOString());

  const caseQuery = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.get<{ case: CaseDetail }>(`/cases/${id}`),
  });
  const iocsQuery = useQuery({
    queryKey: ['case', id, 'iocs'],
    queryFn: () => api.get<{ iocs: CaseIoc[] }>(`/cases/${id}/iocs`),
  });
  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    staleTime: 5 * 60 * 1000,
  });
  const attack = useAttack();

  const c = caseQuery.data?.case;
  const iocs = iocsQuery.data?.iocs;
  const ready = Boolean(c && iocs && !analystsQuery.isLoading && !attack.isLoading);

  useEffect(() => {
    if (c) document.title = tr('printTitle', { code: c.code, title: c.title });
  }, [c]);

  // Impressao automatica (uma vez) quando tudo carregou.
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current || searchParams.get('auto') !== '1') return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [ready, searchParams]);

  let body: ReactNode;
  if (caseQuery.isLoading || iocsQuery.isLoading) {
    body = <HpsmLoading text={tr('preparingCase')} />;
  } else if (!c || !iocs) {
    body = (
      <HpsmMessage kind="error">
        {(caseQuery.error as Error | null)?.message ?? tr('caseNotFound')}
      </HpsmMessage>
    );
  } else {
    const names = new Map((analystsQuery.data?.analysts ?? []).map((a) => [a.id, a.displayName]));
    const reports = c.entries.flatMap(({ entry }) => entry.reports.map((r) => ({ ...r, entry })));
    const techniques = caseTechniques(c);
    body = (
      <>
        <section className="dl-print__section">
          <h2>{tr('caseData')}</h2>
          <table className="dl-print__kv">
            <tbody>
              <Row label={tr('code')}>{c.code}</Row>
              <Row label={tr('status')}>{CASE_STATUS[c.status].label}</Row>
              <Row label={tr('assignee')}>{c.assignee?.displayName ?? '—'}</Row>
              <Row label={tr('createdBy')}>{c.createdBy?.displayName ?? '—'}</Row>
              <Row label={tr('createdAt')}>{fmtDate(c.createdAt)}</Row>
              {c.closedAt && <Row label={tr('closedAt')}>{fmtDate(c.closedAt)}</Row>}
            </tbody>
          </table>
          <h3>{tr('description')}</h3>
          <p className="dl-print__text">{c.description || '—'}</p>
        </section>

        <section className="dl-print__section">
          <h2>{tr('samplesN', { n: c.entries.length })}</h2>
          <table className="dl-print__grid dl-print__grid--wide">
            <thead>
              <tr>
                <th scope="col">{tr('sample')}</th>
                <th scope="col">{tr('type')}</th>
                <th scope="col">{tr('status')}</th>
                <th scope="col">{tr('priority')}</th>
                <th scope="col">{tr('verdict')}</th>
                <th scope="col">SHA-256 / URL</th>
              </tr>
            </thead>
            <tbody>
              {c.entries.map(({ entry }) => (
                <tr key={entry.id}>
                  <td>{entry.title}</td>
                  <td>
                    <TypeTag type={entry.type} />
                  </td>
                  <td>
                    <StatusTag status={entry.status} />
                  </td>
                  <td>
                    <PriorityTag priority={entry.priority} />
                  </td>
                  <td>
                    <VerdictTag verdict={entry.verdict} />
                  </td>
                  <td className="dl-print__mono">
                    {(entry.type === 'FILE' ? entry.sha256 : entry.url) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="dl-print__section">
          <h2>{tr('publishedReportsN', { n: reports.length })}</h2>
          {reports.length === 0 && <p>{tr('noPublished')}</p>}
          {reports.map((report) => (
            <article key={report.id} className="dl-print__report">
              <h3>
                {report.entry.title} — {report.analyst?.displayName ?? '—'} —{' '}
                {fmtDate(report.updatedAt)} — {tr('verdictColon')}{' '}
                <VerdictTag verdict={report.verdict} />
              </h3>
              {report.attackTechniques.length > 0 && (
                <p>ATT&amp;CK: {report.attackTechniques.join(', ')}</p>
              )}
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
              {report.evidence.length > 0 && (
                <>
                  <h4>{tr('evidenceN', { n: report.evidence.length })}</h4>
                  <div className="dl-print__evidence">
                    {report.evidence.map((e, i) => (
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
          <h2>{tr('indicatorsN', { n: iocs.length })}</h2>
          {iocs.length === 0 ? (
            <p>{tr('noIndicator')}</p>
          ) : (
            <table className="dl-print__grid">
              <thead>
                <tr>
                  <th scope="col">{tr('type')}</th>
                  <th scope="col">{tr('source')}</th>
                  <th scope="col">{tr('indicator')}</th>
                  <th scope="col">{tr('samples')}</th>
                </tr>
              </thead>
              <tbody>
                {iocs.map((ioc) => (
                  <tr key={`${ioc.kind}:${ioc.value}`}>
                    <td>{IOC_KIND_LABELS[ioc.kind]}</td>
                    <td>{ioc.source === 'REPORT' ? tr('reportShort') : tr('sample')}</td>
                    <td className="dl-print__mono">{ioc.value}</td>
                    <td>{ioc.entries.map((e) => e.title).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dl-print__section">
          <h2>{tr('attackN', { n: techniques.length })}</h2>
          {techniques.length === 0 ? (
            <p>{tr('noTechniques')}</p>
          ) : (
            <table className="dl-print__grid">
              <thead>
                <tr>
                  <th scope="col">{tr('technique')}</th>
                  <th scope="col">{tr('name')}</th>
                  <th scope="col">{tr('samples')}</th>
                </tr>
              </thead>
              <tbody>
                {techniques.map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{attack.data?.techniques.find((x) => x.id === t.id)?.name ?? '—'}</td>
                    <td>{t.entries.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dl-print__section">
          <h2>{tr('timelineN', { n: c.events.length })}</h2>
          <table className="dl-print__grid">
            <thead>
              <tr>
                <th scope="col">{tr('date')}</th>
                <th scope="col">{tr('user')}</th>
                <th scope="col">{tr('event')}</th>
              </tr>
            </thead>
            <tbody>
              {c.events.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.createdAt)}</td>
                  <td>{e.actor?.displayName ?? tr('someone')}</td>
                  <td>
                    {caseEventText(e, names)}
                    {e.type === 'COMMENT' && e.detail && (
                      <span className="dl-print__text">: {e.detail}</span>
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
          <HpsmToolbar label={tr('caseActions')}>
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
            <div className="dl-print__brand">{tr('brand')}</div>
            <h1 className="dl-print__title">{c ? `${c.code} · ${c.title}` : tr('case')}</h1>
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
