import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconScreen } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface Capture {
  id: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  url: string;
  finalUrl: string | null;
  title: string | null;
  httpStatus: number | null;
  redirects: { url: string; status: number | null }[] | null;
  certificate: {
    subject: string | null;
    issuer: string | null;
    protocol: string | null;
    validFrom: string | null;
    validTo: string | null;
  } | null;
  blocked: { host: string; reason: string }[] | null;
  htmlTruncated: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  requestedBy: { id: string; displayName: string } | null;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

/** Data do certificado (dia), com aviso se ja venceu. */
function certDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(intlLocale()) : '—';
}

/**
 * Captura da pagina (item 80): o analista pede e um navegador isolado (sem
 * acesso a rede interna) abre o link e guarda print, HTML, redirecionamentos e
 * certificado. Nenhum endereco vira link clicavel; o HTML so e baixado como
 * texto.
 */
export function PageCaptureSection({
  entryId,
  canTriage,
}: {
  entryId: string;
  canTriage: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['entry', entryId, 'captures'];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      api.get<{ captures: Capture[]; enabled: boolean }>(`/entries/${entryId}/captures`),
    // Enquanto houver captura em andamento, confere a cada 2 s.
    refetchInterval: (q) =>
      q.state.data?.captures.some((c) => c.status === 'PENDING') ? 2000 : false,
  });
  const [error, setError] = useState<string | null>(null);
  const captures = query.data?.captures ?? [];
  const enabled = query.data?.enabled ?? false;
  const running = captures.some((c) => c.status === 'PENDING');
  const latest = captures[0];

  if (!query.data && !query.isLoading) return null;
  if (query.data && !enabled && captures.length === 0) return null;

  const start = async () => {
    setError(null);
    try {
      await api.post(`/entries/${entryId}/capture`);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <HpsmSection title={t('captureTitle')} className="dl-mt-lg">
      {canTriage && enabled && (
        <HpsmToolbar label={t('captureActions')}>
          <HpsmToolbarButton
            label={
              running ? t('capturing') : captures.length ? t('captureAgain') : t('capturePage')
            }
            title={t('captureHelp')}
            icon={IconScreen}
            disabled={running}
            onClick={() => void start()}
          />
        </HpsmToolbar>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={t('loadingCaptures')} />}
      {captures.length === 0 && enabled && (
        <p className="dl-static-empty">
          {t('noCaptures')} {canTriage ? t('noCapturesHelp') : t('analystCanCapture')}
        </p>
      )}
      {latest && (
        <div className="dl-capture">
          {latest.status === 'PENDING' && <HpsmLoading text={t('openingPage')} />}
          {latest.status === 'FAILED' && (
            <HpsmMessage kind="error">
              {t('captureFailed', {
                date: fmtDate(latest.createdAt),
                error: latest.error ?? t('unknownReason'),
              })}
            </HpsmMessage>
          )}
          {latest.status === 'DONE' && (
            <div className="dl-capture__grid">
              <a
                className="dl-capture__shot"
                href={`/api/captures/${latest.id}/screenshot`}
                target="_blank"
                rel="noreferrer"
                title={t('openFullPrint')}
              >
                <img
                  src={`/api/captures/${latest.id}/screenshot`}
                  alt={t('pagePrint', { title: latest.title ?? latest.url })}
                />
              </a>
              <HpsmForm>
                <HpsmField label={t('capturedAt')}>
                  <HpsmReadonly>
                    {t('dateBy', {
                      date: fmtDate(latest.finishedAt),
                      name: latest.requestedBy?.displayName ?? '—',
                    })}
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField label={t('title')}>
                  <HpsmReadonly>{latest.title || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField label={t('finalAddress')}>
                  <HpsmReadonly
                    mono
                    copyable={
                      latest.finalUrl
                        ? { value: latest.finalUrl, label: t('finalAddressLower') }
                        : undefined
                    }
                  >
                    {latest.finalUrl ?? '—'}
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField label={t('response')}>
                  <HpsmReadonly>
                    <StatusText
                      tone={latest.httpStatus && latest.httpStatus < 400 ? 'green' : 'orange'}
                    >
                      HTTP {latest.httpStatus ?? '—'}
                    </StatusText>
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField
                  label={t('redirects', { n: Math.max(0, (latest.redirects?.length ?? 1) - 1) })}
                  top
                >
                  <ol className="dl-capture__chain">
                    {(latest.redirects ?? []).map((r, i) => (
                      <li key={i}>
                        <span className="dl-mono">{r.url}</span>{' '}
                        <span className="dl-hint-muted">({r.status ?? '—'})</span>
                      </li>
                    ))}
                  </ol>
                </HpsmField>
                <HpsmField label={t('certificate')} top>
                  {latest.certificate ? (
                    <HpsmReadonly>
                      {t('certInfo', {
                        subject: latest.certificate.subject ?? '—',
                        issuer: latest.certificate.issuer ?? '—',
                        protocol: latest.certificate.protocol ?? '',
                        from: certDate(latest.certificate.validFrom),
                        to: certDate(latest.certificate.validTo),
                      })}
                      {latest.certificate.validTo &&
                        new Date(latest.certificate.validTo) < new Date() && (
                          <StatusText tone="red"> {t('expired')}</StatusText>
                        )}
                    </HpsmReadonly>
                  ) : (
                    <HpsmReadonly>{t('noHttps')}</HpsmReadonly>
                  )}
                </HpsmField>
                {(latest.blocked?.length ?? 0) > 0 && (
                  <HpsmField label={t('blocked', { n: latest.blocked!.length })} top>
                    <ul className="dl-capture__blocked">
                      {latest.blocked!.map((b) => (
                        <li key={b.host} title={b.reason}>
                          <span className="dl-mono">{b.host}</span>{' '}
                          <span className="dl-hint-muted">— {b.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </HpsmField>
                )}
                <HpsmField label="HTML">
                  <HpsmReadonly>
                    <a className="dl-link" href={`/api/captures/${latest.id}/html`}>
                      {t('downloadHtml')}
                    </a>
                    {latest.htmlTruncated && <span className="dl-hint-muted"> {t('cut2mb')}</span>}
                  </HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </div>
          )}
          {captures.length > 1 && (
            <details className="dl-capture__older">
              <summary>{t('olderCaptures', { n: captures.length - 1 })}</summary>
              <ul>
                {captures.slice(1).map((c) => (
                  <li key={c.id}>
                    {fmtDate(c.createdAt)} — {c.requestedBy?.displayName ?? '—'} —{' '}
                    {c.status === 'DONE' ? (
                      <>
                        HTTP {c.httpStatus ?? '—'} ·{' '}
                        <a
                          className="dl-link"
                          href={`/api/captures/${c.id}/screenshot`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('printLink')}
                        </a>{' '}
                        ·{' '}
                        <a className="dl-link" href={`/api/captures/${c.id}/html`}>
                          {t('htmlText')}
                        </a>
                      </>
                    ) : c.status === 'FAILED' ? (
                      t('failedLower', { error: c.error ?? '—' })
                    ) : (
                      t('inProgress')
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </HpsmSection>
  );
}
