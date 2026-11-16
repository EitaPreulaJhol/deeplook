import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { SandboxSigma as Sigma, SandboxSigmaHit } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { AttackTechniqueLinks } from './attack';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText, type StatusTone } from './tags';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());
/** O nome do executavel, sem a pasta. */
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

const LEVEL: Record<string, { key: Parameters<typeof t>[0]; tone: StatusTone }> = {
  critical: { key: 'sigmaCritical', tone: 'red' },
  high: { key: 'sigmaHigh', tone: 'red' },
  medium: { key: 'sigmaMedium', tone: 'orange' },
  low: { key: 'sigmaLow', tone: 'blue' },
  informational: { key: 'sigmaInfo', tone: 'gray' },
};

/** Os campos do evento que casou, como texto (vem da VM: nunca HTML). */
function EventFields({ hit }: { hit: SandboxSigmaHit }) {
  const fields = Object.entries(hit.event).filter(([, v]) => v !== null && v !== '');
  return (
    <dl className="dl-sigma__event">
      <dt>EventID</dt>
      <dd>{hit.eventId}</dd>
      {fields.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd className="dl-mono">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function HitRow({ hit }: { hit: SandboxSigmaHit }) {
  const [open, setOpen] = useState(false);
  const level = LEVEL[hit.level] ?? LEVEL.informational;
  const detailId = useId();
  return (
    <>
      <tr>
        <td>
          <StatusText tone={level.tone}>{t(level.key)}</StatusText>
        </td>
        <td>
          <button
            type="button"
            className="dl-link-button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen(!open)}
          >
            {hit.title}
          </button>
          {hit.teamRuleId && <span className="dl-hint-muted"> · {t('sigmaTeam')}</span>}
          {!hit.sample && <span className="dl-hint-muted"> · {t('sigmaNotSample')}</span>}
        </td>
        <td>{hit.techniques.length ? <AttackTechniqueLinks ids={hit.techniques} /> : '—'}</td>
        <td className="dl-mono" title={hit.image ?? undefined}>
          {base(hit.image)}
          {hit.pid !== null && ` (${hit.pid})`}
        </td>
        <td>{hit.count}</td>
        <td>
          <time dateTime={hit.firstAt}>{fmtTime(hit.firstAt)}</time>
        </td>
      </tr>
      {open && (
        <tr id={detailId} className="dl-sigma__detail">
          <td colSpan={6}>
            {hit.description && <p>{hit.description}</p>}
            <EventFields hit={hit} />
            {hit.falsepositives.length > 0 && (
              <p className="dl-hint-muted">
                {t('sigmaFalsePositives', { list: hit.falsepositives.join('; ') })}
              </p>
            )}
            <p className="dl-hint-muted">
              {hit.author && `${t('sigmaAuthor', { author: hit.author })} · `}
              {hit.url && (
                <a href={hit.url} target="_blank" rel="noreferrer noopener">
                  {t('sigmaRuleLink')}
                </a>
              )}
              {hit.teamRuleId && (
                <Link to={`/sigma?editar=${encodeURIComponent(hit.teamRuleId)}`}>
                  {t('sigmaEditTeamRule')}
                </Link>
              )}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Deteccoes das regras Sigma nos eventos do Sysmon de uma execucao (plans/novas-analises, item 1).
 * Por padrao, so as dos processos da amostra (e descendentes); "Tudo" mostra tambem o que casou no
 * resto do Windows. Atualiza junto com a coleta enquanto o ambiente roda.
 */
export function SandboxSigma({
  sessionId,
  running,
  intervalS,
}: {
  sessionId: string;
  running: boolean;
  intervalS: number;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [all, setAll] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = ['sandbox', 'sigma', sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<Sigma>(`/sandbox/${sessionId}/sigma`),
    refetchInterval: running && intervalS ? intervalS * 1000 : false,
  });
  const data = query.data;
  const reevaluate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sandbox/${sessionId}/sigma/reevaluate`);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const showAll = all ?? !data?.sample.found;
  const hits = data ? data.hits.filter((h) => showAll || h.sample) : [];
  const sampleCount = data?.hits.filter((h) => h.sample).length ?? 0;
  return (
    <details className="dl-static-strings dl-sigma" open>
      <summary>
        {t('sigmaTitle')}
        {data &&
          ` (${sampleCount}${data.hits.length !== sampleCount ? ` / ${data.hits.length}` : ''})`}
      </summary>
      {!data ? (
        query.isError ? (
          <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>
        ) : (
          <HpsmLoading text={t('consultingEnv')} />
        )
      ) : (
        <>
          <p className="dl-hint-muted">
            {t('sigmaRules', { n: data.rules.count.toLocaleString(intlLocale()) })}{' '}
            {data.rules.url && (
              <a href={data.rules.url} target="_blank" rel="noreferrer noopener">
                {data.rules.name} {data.rules.release}
              </a>
            )}
            {data.rules.license && ` (${data.rules.license})`}
            {data.rules.team ? ` · ${t('sigmaTeamRules', { n: data.rules.team })}` : ''}
            {data.pending > 0 && ` · ${t('sigmaPending', { n: data.pending })}`}
          </p>
          <div className="dl-timeline__filters">
            <fieldset className="dl-timeline__scope">
              <legend>{t('timelineShow')}</legend>
              {([false, true] as const).map((value) => (
                <label key={String(value)}>
                  <input
                    type="radio"
                    name={`${id}-scope`}
                    checked={showAll === value}
                    disabled={!value && !data.sample.found}
                    onChange={() => setAll(value)}
                  />{' '}
                  {t(value ? 'sigmaAll' : 'sigmaSample')}
                </label>
              ))}
            </fieldset>
            <button type="button" className="dl-btn" disabled={busy} onClick={reevaluate}>
              {busy ? t('sigmaReevaluating') : t('sigmaReevaluate')}
            </button>
          </div>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          {hits.length === 0 ? (
            <p className="dl-hint-muted">
              {showAll || !data.hits.length ? t('sigmaNone') : t('sigmaNoneSample')}
            </p>
          ) : (
            <table className="dl-risk__reasons" aria-label={t('sigmaTitle')}>
              <thead>
                <tr>
                  <th scope="col">{t('sigmaLevel')}</th>
                  <th scope="col">{t('sigmaRule')}</th>
                  <th scope="col">ATT&amp;CK</th>
                  <th scope="col">{t('process')}</th>
                  <th scope="col">{t('sigmaCount')}</th>
                  <th scope="col">{t('sigmaFirst')}</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <HitRow key={`${h.ruleId}-${h.image}-${h.pid}`} hit={h} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </details>
  );
}
