import { Button, Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { HuntEvent, HuntEventsPage, HuntRunsPage } from '../api/types';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';

const FIELDS = [
  'any',
  'process',
  'commandline',
  'file',
  'registry',
  'network',
  'dns',
  'hash',
  'imageload',
  'pipe',
] as const;
const OPS = ['contains', 'equals', 'starts', 'ends', 'regex'] as const;
const KINDS = [
  'all',
  'process',
  'network',
  'dns',
  'file',
  'registry',
  'imageload',
  'pipe',
] as const;
const FILTER_KEYS = ['field', 'op', 'value', 'kind', 'scope', 'from', 'to'] as const;

const FIELD_LABEL = {
  any: 'huntFieldAny',
  process: 'huntFieldProcess',
  commandline: 'huntFieldCmd',
  file: 'huntFieldFile',
  registry: 'huntFieldRegistry',
  network: 'huntFieldNetwork',
  dns: 'huntFieldDns',
  hash: 'huntFieldHash',
  imageload: 'huntFieldImageLoad',
  pipe: 'huntFieldPipe',
} as const;
const OP_LABEL = {
  contains: 'huntOpContains',
  equals: 'huntOpEquals',
  starts: 'huntOpStarts',
  ends: 'huntOpEnds',
  regex: 'huntOpRegex',
} as const;
const KIND_LABEL = {
  all: 'huntKindAll',
  process: 'kindProcess',
  network: 'kindNetwork',
  dns: 'kindDns',
  file: 'kindFile',
  registry: 'kindRegistry',
  imageload: 'huntKindImageLoad',
  pipe: 'huntKindPipe',
} as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleString(intlLocale());
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

type Filters = Record<(typeof FILTER_KEYS)[number], string>;
const filtersOf = (params: URLSearchParams): Filters => ({
  field: params.get('field') ?? 'any',
  op: params.get('op') ?? 'contains',
  value: params.get('value') ?? '',
  kind: params.get('kind') ?? 'all',
  scope: params.get('scope') ?? 'all',
  from: params.get('from') ?? '',
  to: params.get('to') ?? '',
});
/** A query da API: as datas do formulario (dia) viram o inicio do dia e o dia seguinte. */
function apiQuery(f: Filters): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of ['field', 'op', 'value', 'kind', 'scope'] as const) q.set(k, f[k]);
  if (f.from) q.set('from', new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q.set('to', end.toISOString());
  }
  return q;
}

/** Um evento numa linha: hora, EventID, processo e o que aconteceu (texto da VM, nunca HTML). */
function EventLine({ e }: { e: HuntEvent }) {
  return (
    <li className={`dl-timeline__event${e.sample ? ' is-sample' : ''}`}>
      <time dateTime={e.time}>{fmtTime(e.time)}</time>
      <span className="dl-timeline__kind">{e.eventId}</span>
      <span className="dl-timeline__proc" title={e.image ?? undefined}>
        {base(e.image)}
        {e.pid !== null && <span className="dl-hint-muted"> PID {e.pid}</span>}
        {e.sample && <span className="dl-timeline__tag">{t('timelineSampleTag')}</span>}
      </span>
      <code className="dl-mono dl-timeline__detail">{e.summary ?? '—'}</code>
    </li>
  );
}

/** Os eventos que casam numa execucao, paginados (abre sob demanda). */
function RunEvents({ sessionId, filters }: { sessionId: string; filters: Filters }) {
  const [page, setPage] = useState(1);
  const q = apiQuery(filters);
  q.set('page', String(page));
  const query = useQuery({
    queryKey: ['sandbox-hunt', 'events', sessionId, q.toString()],
    queryFn: () => api.get<HuntEventsPage>(`/sandbox/hunt/${sessionId}?${q}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  if (query.isError)
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  if (!data) return <HpsmLoading text={t('huntLoading')} />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <>
      <ol className="dl-timeline__list">
        {data.events.map((e, i) => (
          <EventLine key={`${e.time}-${i}`} e={e} />
        ))}
      </ol>
      {pages > 1 && (
        <div className="dl-pager">
          <Button size="sm" kind="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('huntPrevious')}
          </Button>
          <span>{t('huntPage', { page, pages })}</span>
          <Button
            size="sm"
            kind="tertiary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('huntNext')}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Busca nos eventos do Sysmon de todas as execucoes do sandbox (plans/caca-e-formatos, item 2): o
 * formulario numa linha, com os filtros na URL; o resultado por execucao, que abre os eventos e
 * leva a execucao na ficha da amostra.
 */
export function SandboxHuntPage() {
  const [params, setParams] = useSearchParams();
  const applied = filtersOf(params);
  const [form, setForm] = useState<Filters>(applied);
  const [offsets, setOffsets] = useState<number[]>([0]);
  const offset = offsets[offsets.length - 1];
  const paramsKey = params.toString();
  // Outra busca (ou voltar no navegador): o formulario acompanha a URL e a paginacao recomeca.
  useEffect(() => {
    setForm(filtersOf(new URLSearchParams(paramsKey)));
    setOffsets([0]);
  }, [paramsKey]);

  const ready = applied.value.trim().length >= 2;
  const q = apiQuery(applied);
  q.set('offset', String(offset));
  const query = useQuery({
    queryKey: ['sandbox-hunt', q.toString()],
    queryFn: () => api.get<HuntRunsPage>(`/sandbox/hunt?${q}`),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const data = ready ? query.data : undefined;
  const [open, setOpen] = useState<string | null>(null);

  const submit = () => {
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) if (form[k]) next.set(k, form[k]);
    setParams(next);
    setOpen(null);
  };
  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const exportUrl = `/api/sandbox/hunt/export?${apiQuery(applied)}`;

  return (
    <>
      <PageHeader title={t('huntTitle')} subtitle={t('huntSubtitle')} />
      <HpsmSection title={t('huntFilters')}>
        <form
          className="dl-hunt__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Select
            id="hunt-field"
            labelText={t('huntField')}
            size="sm"
            value={form.field}
            onChange={set('field')}
          >
            {FIELDS.map((f) => (
              <SelectItem key={f} value={f} text={t(FIELD_LABEL[f])} />
            ))}
          </Select>
          <Select
            id="hunt-op"
            labelText={t('huntOp')}
            size="sm"
            value={form.op}
            onChange={set('op')}
          >
            {OPS.map((o) => (
              <SelectItem key={o} value={o} text={t(OP_LABEL[o])} />
            ))}
          </Select>
          <TextInput
            id="hunt-value"
            className="dl-hunt__value"
            labelText={t('huntValue')}
            size="sm"
            placeholder={t('huntValuePlaceholder')}
            value={form.value}
            onChange={set('value')}
          />
          <Select
            id="hunt-kind"
            labelText={t('huntKind')}
            size="sm"
            value={form.kind}
            onChange={set('kind')}
          >
            {KINDS.map((k) => (
              <SelectItem key={k} value={k} text={t(KIND_LABEL[k])} />
            ))}
          </Select>
          <Select
            id="hunt-scope"
            labelText={t('huntScope')}
            size="sm"
            value={form.scope}
            onChange={set('scope')}
          >
            <SelectItem value="all" text={t('huntScopeAll')} />
            <SelectItem value="sample" text={t('huntScopeSample')} />
          </Select>
          <TextInput
            id="hunt-from"
            type="date"
            labelText={t('huntFrom')}
            size="sm"
            value={form.from}
            onChange={set('from')}
          />
          <TextInput
            id="hunt-to"
            type="date"
            labelText={t('huntTo')}
            size="sm"
            value={form.to}
            onChange={set('to')}
          />
          <Button size="sm" type="submit" disabled={form.value.trim().length < 2}>
            {t('huntSearch')}
          </Button>
        </form>
      </HpsmSection>

      {!ready && <p className="dl-hint-muted">{t('huntHint')}</p>}
      {ready && query.isError && (
        <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>
      )}
      {ready && !data && query.isLoading && <HpsmLoading text={t('huntLoading')} />}
      {data && (
        <HpsmSection title={t('huntResults')}>
          <p className="dl-hint-muted">
            {data.total !== null
              ? t('huntRunsTotal', { n: data.total })
              : t('huntRunsSample', { n: data.runs.length })}
            {data.capped && ` ${t('huntCapped')}`}{' '}
            {data.runs.length > 0 && (
              <a href={exportUrl} download>
                {t('huntExport')}
              </a>
            )}
          </p>
          {data.runs.length === 0 ? (
            <p className="dl-hint-muted">{t('huntNone')}</p>
          ) : (
            <table className="dl-risk__reasons dl-hunt__runs" aria-label={t('huntResults')}>
              <thead>
                <tr>
                  <th scope="col">{t('huntSample')}</th>
                  <th scope="col">{t('huntRunStarted')}</th>
                  <th scope="col">{t('huntMatched')}</th>
                  <th scope="col">{t('huntFirst')}</th>
                  <th scope="col">{t('huntActions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <Fragment key={r.sessionId}>
                    <tr>
                      <td>
                        <Link className="dl-link" to={`/entries/${r.entryId}`}>
                          {r.entryTitle}
                        </Link>
                      </td>
                      <td>{fmtDate(r.startedAt)}</td>
                      <td>{r.matched.toLocaleString(intlLocale())}</td>
                      <td>
                        <ul className="dl-hunt__first">
                          {r.first.map((e, i) => (
                            <li key={i} className="dl-mono">
                              {base(e.image)}: {e.summary ?? '—'}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dl-link-button"
                          aria-expanded={open === r.sessionId}
                          onClick={() => setOpen(open === r.sessionId ? null : r.sessionId)}
                        >
                          {open === r.sessionId ? t('huntHideEvents') : t('huntShowEvents')}
                        </button>
                        {' · '}
                        <Link
                          className="dl-link"
                          to={`/entries/${r.entryId}?execucao=${encodeURIComponent(r.sessionId)}`}
                        >
                          {t('huntOpenRun')}
                        </Link>
                      </td>
                    </tr>
                    {open === r.sessionId && (
                      <tr>
                        <td colSpan={5}>
                          <RunEvents sessionId={r.sessionId} filters={applied} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          {(offsets.length > 1 || data.nextOffset !== null) && (
            <div className="dl-pager">
              <Button
                size="sm"
                kind="tertiary"
                disabled={offsets.length <= 1}
                onClick={() => setOffsets((o) => o.slice(0, -1))}
              >
                {t('huntPrevious')}
              </Button>
              <Button
                size="sm"
                kind="tertiary"
                disabled={data.nextOffset === null}
                onClick={() =>
                  data.nextOffset !== null && setOffsets((o) => [...o, data.nextOffset!])
                }
              >
                {t('huntNext')}
              </Button>
            </div>
          )}
        </HpsmSection>
      )}
    </>
  );
}
