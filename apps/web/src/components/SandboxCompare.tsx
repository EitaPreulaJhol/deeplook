import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { api } from '../api/client';
import type { SandboxCompare as Compare, SandboxCompareCategory, SandboxRun } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { HpsmLoading, HpsmMessage } from './messages';

const fmtDate = (iso: string) => new Date(iso).toLocaleString(intlLocale());

const CATEGORIES: { id: SandboxCompareCategory; label: Parameters<typeof t>[0] }[] = [
  { id: 'process', label: 'compareProcess' },
  { id: 'dns', label: 'compareDns' },
  { id: 'network', label: 'compareNetwork' },
  { id: 'file', label: 'compareFile' },
  { id: 'registry', label: 'compareRegistry' },
  { id: 'sigma', label: 'sigmaTitle' },
  { id: 'ids', label: 'compareIds' },
];

/** Uma lista do diff (texto que veio da VM: nunca HTML). */
function Items({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <ul className="dl-runcompare__list" aria-label={label}>
      {items.map((x, i) => (
        <li key={i} className="dl-mono">
          {x}
        </li>
      ))}
    </ul>
  );
}

function Result({ a, b, scope }: { a: string; b: string; scope: 'sample' | 'all' }) {
  const query = useQuery({
    queryKey: ['sandbox', 'compare', a, b, scope],
    queryFn: () => api.get<Compare>(`/sandbox/${a}/compare/${b}?scope=${scope}`),
  });
  if (query.isError)
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  const data = query.data;
  if (!data) return <HpsmLoading text={t('compareLoading')} />;
  const differences = CATEGORIES.reduce(
    (n, c) => n + data.categories[c.id].counts.onlyA + data.categories[c.id].counts.onlyB,
    0,
  );
  return (
    <div className="dl-runcompare__result">
      {scope === 'sample' && (!data.sample.foundA || !data.sample.foundB) && (
        <HpsmMessage kind="warning">{t('compareNoSample', { name: data.sample.name })}</HpsmMessage>
      )}
      <p className="dl-hint-muted">
        {differences ? t('compareDifferences', { n: differences }) : t('compareSame')}
      </p>
      {CATEGORIES.map(({ id, label }) => {
        const c = data.categories[id];
        if (!c.counts.onlyA && !c.counts.onlyB && !c.counts.both) return null;
        const cut = (shown: number, total: number) =>
          total > shown ? ` ${t('compareCut', { n: shown })}` : '';
        return (
          <details
            key={id}
            className="dl-static-strings"
            open={c.counts.onlyA + c.counts.onlyB > 0}
          >
            <summary>
              {t(label)} ·{' '}
              {t('compareCounts', { a: c.counts.onlyA, b: c.counts.onlyB, both: c.counts.both })}
            </summary>
            <div className="dl-runcompare__cols">
              <div>
                <h5>
                  {t('compareOnlyA')}
                  {cut(c.onlyA.length, c.counts.onlyA)}
                </h5>
                <Items items={c.onlyA.map((x) => x.example)} label={t('compareOnlyA')} />
              </div>
              <div>
                <h5>
                  {t('compareOnlyB')}
                  {cut(c.onlyB.length, c.counts.onlyB)}
                </h5>
                <Items items={c.onlyB.map((x) => x.example)} label={t('compareOnlyB')} />
              </div>
            </div>
            {c.both.length > 0 && (
              <details className="dl-runcompare__both">
                <summary>
                  {t('compareBoth', { n: c.counts.both })}
                  {cut(c.both.length, c.counts.both)}
                </summary>
                <Items
                  items={c.both.map((x) => x.exampleA)}
                  label={t('compareBoth', { n: c.counts.both })}
                />
              </details>
            )}
          </details>
        );
      })}
    </div>
  );
}

/**
 * Diff entre duas execucoes da mesma amostra (plans/novas-analises, item 8): processos, DNS,
 * destinos, arquivos, registro, Sigma e Suricata, com o que so uma fez e o que as duas fizeram. A
 * API normaliza PIDs, GUIDs, o perfil do usuario e nomes temporarios antes de comparar.
 */
export function SandboxCompare({ runs }: { runs: SandboxRun[] }) {
  const id = useId();
  const [a, setA] = useState(runs[1]?.id ?? '');
  const [b, setB] = useState(runs[0]?.id ?? '');
  const [scope, setScope] = useState<'sample' | 'all'>('sample');
  const [open, setOpen] = useState(false);
  if (runs.length < 2) return null;
  const label = (r: SandboxRun) =>
    `${fmtDate(r.startedAt ?? r.createdAt)} · ${r.analyst.displayName}`;
  return (
    <details
      className="dl-static-strings dl-runcompare"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t('compareTitle')}</summary>
      {open && (
        <>
          <div className="dl-timeline__filters">
            {(
              [
                ['A', a, setA],
                ['B', b, setB],
              ] as const
            ).map(([name, value, set]) => (
              <label key={name} className="dl-runcompare__pick">
                {t('compareRun', { name })}{' '}
                <select value={value} onChange={(e) => set(e.target.value)}>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {label(r)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <fieldset className="dl-timeline__scope">
              <legend>{t('timelineShow')}</legend>
              {(['sample', 'all'] as const).map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name={`${id}-scope`}
                    checked={scope === s}
                    onChange={() => setScope(s)}
                  />{' '}
                  {t(s === 'sample' ? 'timelineSample' : 'timelineAll')}
                </label>
              ))}
            </fieldset>
          </div>
          {a === b ? (
            <p className="dl-hint-muted">{t('compareSameRun')}</p>
          ) : (
            <Result a={a} b={b} scope={scope} />
          )}
        </>
      )}
    </details>
  );
}
