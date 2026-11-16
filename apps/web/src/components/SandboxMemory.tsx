import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { SandboxMemory as Memory, SandboxMemoryDump } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { HpsmMessage } from './messages';
import { StatusText, type StatusTone } from './tags';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());
const mb = (n: number | null) =>
  n === null
    ? '—'
    : `${(n / 1048576).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} MB`;
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

const STATUS: Record<
  SandboxMemoryDump['status'],
  { key: Parameters<typeof t>[0]; tone: StatusTone }
> = {
  CAPTURING: { key: 'memCapturing', tone: 'blue' },
  STORED: { key: 'memStored', tone: 'blue' },
  ANALYZING: { key: 'memAnalyzing', tone: 'blue' },
  DONE: { key: 'memDone', tone: 'green' },
  FAILED: { key: 'memFailed', tone: 'orange' },
};

function DumpRow({ sessionId, dump }: { sessionId: string; dump: SandboxMemoryDump }) {
  const status = STATUS[dump.status];
  const r = dump.result;
  const suspicious = r?.regions ?? [];
  const families = [
    ...new Set(
      suspicious.flatMap((x) => [
        ...(x.configs ?? []).map((c) => c.family),
        ...(x.matches ?? []).map((m) => m.family).filter((f): f is string => Boolean(f)),
      ]),
    ),
  ];
  return (
    <li className="dl-memory__dump">
      <div>
        <strong className="dl-mono">{base(dump.image)}</strong> (PID {dump.pid}) ·{' '}
        <StatusText tone={dump.status === 'DONE' && suspicious.length ? 'red' : status.tone}>
          {t(status.key)}
        </StatusText>
        {dump.error && ` · ${dump.error}`}
        {dump.size !== null && ` · ${mb(dump.size)} (${mb(dump.storedSize)} gzip)`}
        {dump.storedAt && (
          <>
            {' · '}
            <a href={`/api/sandbox/${sessionId}/memory/${dump.id}/download`}>{t('memDownload')}</a>
          </>
        )}
      </div>
      {r && (
        <p className="dl-hint-muted">
          {t('memSummary', {
            regions: r.regionsTotal,
            private: r.privateExecutable,
            suspicious: suspicious.length,
          })}
          {families.length > 0 && ` · ${t('memFamilies', { list: families.join(', ') })}`}
        </p>
      )}
      {suspicious.length > 0 && (
        <table className="dl-risk__reasons" aria-label={t('memRegions')}>
          <thead>
            <tr>
              <th scope="col">{t('memBase')}</th>
              <th scope="col">{t('memKind')}</th>
              <th scope="col">{t('memProtect')}</th>
              <th scope="col">{t('memSize')}</th>
              <th scope="col">{t('memEntropy')}</th>
              <th scope="col">{t('memFirstBytes')}</th>
            </tr>
          </thead>
          <tbody>
            {suspicious.map((x) => {
              const child = dump.children?.find((c) => c.sha256 === x.carved);
              return (
                <tr key={x.base}>
                  <td className="dl-mono">{x.base}</td>
                  <td>
                    {x.kind === 'pe' ? t('memKindPe') : t('memKindCode')}
                    {child && (
                      <>
                        {' · '}
                        <Link to={`/entries/${child.entryId}`}>{t('memChild')}</Link>
                      </>
                    )}
                  </td>
                  <td>{x.protect}</td>
                  <td>{x.size.toLocaleString(intlLocale())}</td>
                  <td>{x.entropy}</td>
                  <td className="dl-mono">{x.head.slice(0, 32)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(r?.urls.length ?? 0) > 0 && (
        <details className="dl-static-strings">
          <summary>{t('memUrls', { n: r!.urls.length })}</summary>
          <ul className="dl-runcompare__list">
            {r!.urls.map((u) => (
              <li key={u} className="dl-mono">
                {u}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * Dump de memoria dos processos da amostra numa execucao (plans/novas-analises, item 3): o que foi
 * capturado, o que o extract achou (regioes privadas executaveis, PEs fora de imagem, familias) e
 * as amostras filhas com os PEs. Com o ambiente no ar, o analista pede a captura.
 */
export function SandboxMemory({ sessionId, running }: { sessionId: string; running: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = ['sandbox', 'memory', sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<Memory>(`/sandbox/${sessionId}/memory`),
    refetchInterval: (q) => {
      const d = q.state.data;
      const pending = d?.dumps.some((x) => x.status !== 'DONE' && x.status !== 'FAILED');
      return pending || (running && d?.scheduledAt) ? 5000 : false;
    },
  });
  const data = query.data;
  if (!data || !data.enabled) return null;
  if (!data.dumps.length && !running) return null;
  const capturing = data.dumps.some((d) => d.status === 'CAPTURING');
  const capture = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sandbox/${sessionId}/memory`);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="dl-static-strings dl-memory" open>
      <summary>
        {t('memTitle')}
        {data.dumps.length > 0 && ` (${data.dumps.length})`}
      </summary>
      <p className="dl-hint-muted">
        {t('memHelp')}
        {!data.analysis && ` ${t('memNoAnalysis')}`}
        {data.scheduledAt && ` ${t('memScheduled', { time: fmtTime(data.scheduledAt) })}`}
      </p>
      {running && (
        <button type="button" className="dl-btn" disabled={busy || capturing} onClick={capture}>
          {busy || capturing ? t('memCapturingNow') : t('memCapture')}
        </button>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {data.dumps.length > 0 && (
        <ul className="dl-memory__list">
          {data.dumps.map((d) => (
            <DumpRow key={d.id} sessionId={sessionId} dump={d} />
          ))}
        </ul>
      )}
    </details>
  );
}
