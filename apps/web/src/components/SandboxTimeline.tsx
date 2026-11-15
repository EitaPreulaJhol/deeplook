import { Checkbox } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode, useId, useState } from 'react';

import { api } from '../api/client';
import type {
  SandboxTimeline as Timeline,
  SandboxTimelineEvent,
  SandboxTimelineMarker,
  TimelineKind,
} from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { HpsmLoading } from './messages';

const KINDS: TimelineKind[] = ['process', 'network', 'dns', 'file', 'registry'];
const KIND_LABEL = {
  process: 'kindProcess',
  network: 'kindNetwork',
  dns: 'kindDns',
  file: 'kindFile',
  registry: 'kindRegistry',
} as const;
const MARKER_LABEL = {
  started: 'markerStarted',
  autorun: 'markerAutorun',
  sample: 'markerSample',
  screenshot: 'markerScreenshot',
  stopped: 'markerStopped',
} as const;

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());
/** O nome do executavel, sem a pasta. */
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

/** O que aconteceu, numa linha de texto (vem de arquivo hostil: so texto, nunca HTML). */
function describe(e: SandboxTimelineEvent): string {
  const d = e.detail;
  switch (e.kind) {
    case 'process':
      return String(d.cmd ?? e.image ?? '');
    case 'network':
      return `${d.protocol ?? ''} ${d.host ?? d.ip ?? '?'}${d.port !== null ? `:${d.port}` : ''}`.trim();
    case 'dns':
      return d.results ? `${d.query} → ${String(d.results).replace(/;$/, '')}` : String(d.query);
    case 'file':
      return String(d.path ?? '');
    case 'registry':
      return `${d.action ?? ''} ${d.key ?? ''}${d.details ? ` = ${d.details}` : ''}`.trim();
  }
}

function MarkerRow({ marker, sessionId }: { marker: SandboxTimelineMarker; sessionId: string }) {
  const label = t(MARKER_LABEL[marker.kind]);
  return (
    <li className="dl-timeline__marker">
      <time dateTime={marker.time}>{fmtTime(marker.time)}</time>
      <span>
        {marker.kind === 'screenshot' && marker.id ? (
          <a
            href={`/api/sandbox/${sessionId}/artifacts/${marker.id}`}
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        ) : (
          label
        )}
      </span>
    </li>
  );
}

function EventRow({ event, showSample }: { event: SandboxTimelineEvent; showSample: boolean }) {
  return (
    <li className={`dl-timeline__event${showSample && event.sample ? ' is-sample' : ''}`}>
      <time dateTime={event.time}>{fmtTime(event.time)}</time>
      <span className={`dl-timeline__kind dl-timeline__kind--${event.kind}`}>
        {t(KIND_LABEL[event.kind])}
      </span>
      <span className="dl-timeline__proc">
        {base(event.image)}
        {event.pid !== null && <span className="dl-hint-muted"> PID {event.pid}</span>}
        {showSample && event.sample && (
          <span className="dl-timeline__tag">{t('timelineSampleTag')}</span>
        )}
      </span>
      <code className="dl-mono dl-timeline__detail">{describe(event)}</code>
    </li>
  );
}

/**
 * As marcas do ambiente (no ar, amostra aberta, prints, fim) entre os eventos da pagina: as do
 * intervalo dela e, na primeira e na ultima pagina, as de antes e as de depois.
 */
function merge(
  events: SandboxTimelineEvent[],
  markers: SandboxTimelineMarker[],
  first: boolean,
  last: boolean,
): (
  { kind: 'event'; event: SandboxTimelineEvent } | { kind: 'marker'; marker: SandboxTimelineMarker }
)[] {
  const start = events[0]?.time ?? '';
  const end = events[events.length - 1]?.time ?? '';
  const inPage = markers.filter(
    (m) =>
      !events.length ||
      (m.time >= start && m.time <= end) ||
      (first && m.time < start) ||
      (last && m.time > end),
  );
  const items: ReturnType<typeof merge> = events.map((event) => ({ kind: 'event', event }));
  for (const marker of inPage) {
    const at = items.findIndex((i) => i.kind === 'event' && i.event.time > marker.time);
    items.splice(at === -1 ? items.length : at, 0, { kind: 'marker', marker });
  }
  return items;
}

function TimelineBody({ sessionId, running }: { sessionId: string; running: boolean }) {
  const id = useId();
  const [scope, setScope] = useState<'sample' | 'all' | null>(null);
  const [kinds, setKinds] = useState<TimelineKind[]>(KINDS);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (scope) params.set('scope', scope);
  if (kinds.length < KINDS.length) params.set('kinds', kinds.join(','));
  const query = useQuery({
    queryKey: ['sandbox', 'timeline', sessionId, scope, kinds.join(), page],
    queryFn: () => api.get<Timeline>(`/sandbox/${sessionId}/timeline?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: running ? 60_000 : false,
  });
  const data = query.data;
  if (!data) return <HpsmLoading text={t('consultingEnv')} />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const toggleKind = (kind: TimelineKind, on: boolean) => {
    const next = on
      ? KINDS.filter((k) => k === kind || kinds.includes(k))
      : kinds.filter((k) => k !== kind);
    if (!next.length) return;
    setKinds(next);
    setPage(1);
  };
  let note: ReactNode = null;
  if (!data.sample.found)
    note = <p className="dl-hint-muted">{t('timelineNoSample', { name: data.sample.name })}</p>;
  return (
    <div className="dl-timeline__body">
      <div className="dl-timeline__filters">
        <fieldset className="dl-timeline__scope">
          <legend>{t('timelineShow')}</legend>
          {(['sample', 'all'] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name={`${id}-scope`}
                checked={(scope ?? data.scope) === s}
                disabled={s === 'sample' && !data.sample.found}
                onChange={() => {
                  setScope(s);
                  setPage(1);
                }}
              />{' '}
              {t(s === 'sample' ? 'timelineSample' : 'timelineAll')}
            </label>
          ))}
        </fieldset>
        <fieldset className="dl-timeline__kinds">
          <legend>{t('timelineKinds')}</legend>
          {KINDS.map((kind) => (
            <Checkbox
              key={kind}
              id={`${id}-${kind}`}
              labelText={t(KIND_LABEL[kind])}
              checked={kinds.includes(kind)}
              onChange={(_, { checked }) => toggleKind(kind, checked)}
            />
          ))}
        </fieldset>
      </div>
      {note}
      <p className="dl-timeline__total" aria-live="polite">
        {t('timelineTotal', { n: data.total })}
      </p>
      {data.events.length === 0 ? (
        <p className="dl-hint-muted">{t('timelineEmpty')}</p>
      ) : (
        <ol className="dl-timeline__list">
          {merge(data.events, data.markers, page === 1, page >= pages).map((item, i) => (
            <Fragment key={i}>
              {item.kind === 'event' ? (
                <EventRow event={item.event} showSample={data.scope === 'all'} />
              ) : (
                <MarkerRow marker={item.marker} sessionId={sessionId} />
              )}
            </Fragment>
          ))}
        </ol>
      )}
      {pages > 1 && (
        <div className="dl-timeline__pager">
          <button
            type="button"
            className="dl-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('timelinePrev')}
          </button>
          <span>{t('timelinePage', { page, pages })}</span>
          <button
            type="button"
            className="dl-btn"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('timelineNext')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Linha do tempo de uma execucao (plans/sandbox-execucoes, fase 3): processos, rede, DNS, arquivos
 * e registro numa sequencia so, com as marcas do ambiente. Por padrao, so a amostra e o que ela
 * abriu (pela arvore de processos do Sysmon). Carrega ao abrir o bloco.
 */
export function SandboxTimeline({ sessionId, running }: { sessionId: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="dl-static-strings dl-timeline"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t('timelineTitle')}</summary>
      {open && <TimelineBody sessionId={sessionId} running={running} />}
    </details>
  );
}
