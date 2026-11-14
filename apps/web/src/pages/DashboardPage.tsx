import {
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { DashboardData, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DailyChart } from '../components/DailyChart';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import type { StatusTone } from '../components/tags';
import { StatusText, VerdictTag } from '../components/tags';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/mgmt';

const PERIODS = [7, 30, 90] as const;
const VERDICTS: Verdict[] = ['MALICIOUS', 'SUSPICIOUS', 'CLEAN', 'UNKNOWN'];

/** Numero que leva a lista ja filtrada (ou texto, sem link). */
function Num({ to, value, label }: { to?: string; value: number; label: string }) {
  return to ? (
    <Link className="dl-link" to={to} title={tr('openList', { label })}>
      {value}
    </Link>
  ) : (
    <>{value}</>
  );
}

/** Bloco de indicador: numero grande, rotulo com o marcador de estado e dica. */
function Kpi({
  value,
  label,
  tone = 'none',
  hint,
  to,
}: {
  value: number;
  label: string;
  tone?: StatusTone;
  hint?: ReactNode;
  to?: string;
}) {
  const body = (
    <>
      <span className="dl-kpi__value">{value}</span>
      <span className="dl-kpi__label">
        <StatusText tone={tone}>{label}</StatusText>
      </span>
      {hint && <span className="dl-kpi__hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link className="dl-kpi dl-kpi--link" to={to} title={tr('openList', { label })}>
      {body}
    </Link>
  ) : (
    <div className="dl-kpi">{body}</div>
  );
}

/**
 * Painel (Dashboards do HPSM): indicadores da fila, entrada e conclusao por dia,
 * vereditos e carga por analista. Cada numero abre a lista ja filtrada.
 * Usuarios comuns veem so as proprias amostras (links para Meus Uploads).
 */
export function DashboardPage() {
  const { user } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const daysParam = Number(searchParams.get('dias'));
  const days = (PERIODS as readonly number[]).includes(daysParam) ? daysParam : 7;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const query = useQuery({
    queryKey: ['dashboard', days, tz],
    queryFn: () => api.get<DashboardData>(`/dashboard?days=${days}&tz=${encodeURIComponent(tz)}`),
    refetchInterval: 60_000,
  });
  const d = query.data;
  const mine = d?.scope === 'mine';
  const base = mine ? '/me' : '/history';
  const link = (qs: string) => `${base}?${qs}`;
  const since = d ? encodeURIComponent(d.since) : '';
  const sinceLabel = d ? new Date(d.since).toLocaleDateString(intlLocale()) : '';
  const verdictTotal = d ? VERDICTS.reduce((sum, v) => sum + d.byVerdict[v], 0) : 0;
  const verdictMax = d ? Math.max(1, ...VERDICTS.map((v) => d.byVerdict[v])) : 1;
  const techniqueMax = Math.max(1, ...(d?.techniques ?? []).map((t) => t.count));

  return (
    <>
      <HpsmToolbar label={tr('dashActions')}>
        <HpsmToolbarButton
          label={query.isFetching ? tr('refreshing') : tr('refresh')}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
      </HpsmToolbar>
      <PageHeader title={tr('dashboard')} subtitle={mine ? tr('dashMine') : tr('dashQueues')} />
      <div className="hpsm-filterbar">
        <div className="hpsm-filterbar__item">
          <label className="hpsm-filterbar__label" htmlFor="dash-period">
            {tr('period')}
          </label>
          <Select
            id="dash-period"
            labelText={tr('periodLabel')}
            hideLabel
            size="sm"
            value={String(days)}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value === '7') next.delete('dias');
              else next.set('dias', e.target.value);
              setSearchParams(next, { replace: true });
            }}
          >
            {PERIODS.map((p) => (
              <SelectItem key={p} value={String(p)} text={tr('lastNDays', { p })} />
            ))}
          </Select>
        </div>
      </div>

      {query.isLoading && <HpsmLoading text={tr('computing')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {tr('dashError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}

      {d && (
        <>
          <div className="dl-kpis" aria-label={tr('indicatorsAria')}>
            <Kpi
              value={d.byStatus.PENDING}
              label={tr('pending')}
              tone="gray"
              to={link('status=PENDING')}
            />
            <Kpi
              value={d.byStatus.IN_REVIEW}
              label={tr('inReview')}
              tone="blue"
              to={link('status=IN_REVIEW')}
            />
            {/* Prazos e ATT&CK sao da equipe, nao de quem enviou (item 138). */}
            {canTriage && (
              <>
                <Kpi
                  value={d.open.warn}
                  label={tr('warnOrLate')}
                  tone="orange"
                  hint={tr('moreThanH', { h: d.sla.warnHours })}
                  to={link('age=warn')}
                />
                <Kpi
                  value={d.open.late}
                  label={tr('late')}
                  tone="red"
                  hint={tr('moreThanH', { h: d.sla.lateHours })}
                  to={link('age=late')}
                />
              </>
            )}
            <Kpi
              value={d.period.submitted}
              label={tr('sentInPeriod')}
              hint={`desde ${sinceLabel}`}
              to={link(`submittedFrom=${since}`)}
            />
            <Kpi
              value={d.period.completed}
              label={tr('doneInPeriod')}
              tone="green"
              hint={tr('sinceNoDup', { since: sinceLabel })}
              to={link(`completedFrom=${since}`)}
            />
          </div>

          <div className="dl-dash-grid">
            <HpsmSection title={tr('dailyTitle', { days: d.days })}>
              <DailyChart data={d.daily} />
            </HpsmSection>

            <HpsmSection title={tr('verdictsTitle', { n: verdictTotal })}>
              <ul className="dl-hbars">
                {VERDICTS.map((v) => (
                  <li key={v}>
                    <span className="dl-hbars__label">
                      <VerdictTag verdict={v} />
                    </span>
                    <span className="dl-hbars__track">
                      <span
                        className="dl-hbars__bar"
                        style={{ width: `${(d.byVerdict[v] / verdictMax) * 100}%` }}
                      />
                    </span>
                    <span className="dl-hbars__value">
                      <Num value={d.byVerdict[v]} label={v} to={link(`verdict=${v}`)} />
                    </span>
                  </li>
                ))}
              </ul>
            </HpsmSection>
          </div>

          {canTriage && (
            <HpsmSection title={tr('topAttack')}>
              {(d.techniques ?? []).length === 0 ? (
                <p className="dl-static-empty">{tr('noAttack', { since: sinceLabel })}</p>
              ) : (
                <ul className="dl-hbars dl-hbars--wide" aria-label={tr('topAttackAria')}>
                  {(d.techniques ?? []).map((t) => (
                    <li key={t.id}>
                      <span className="dl-hbars__label" title={t.name}>
                        <span className="dl-mono">{t.id}</span> {t.name}
                      </span>
                      <span className="dl-hbars__track">
                        <span
                          className="dl-hbars__bar"
                          style={{ width: `${(t.count / techniqueMax) * 100}%` }}
                        />
                      </span>
                      <span className="dl-hbars__value">
                        <Num
                          value={t.count}
                          label={`${t.id} ${t.name}`}
                          to={link(`attack=${t.id}`)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </HpsmSection>
          )}

          {!mine && d.workload.length > 0 && (
            <HpsmSection title={tr('workload')}>
              <TableContainer>
                <Table size="xs" aria-label={tr('workload')}>
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">{tr('assignee')}</TableHeader>
                      <TableHeader scope="col">{tr('pendingCol')}</TableHeader>
                      <TableHeader scope="col">{tr('inReviewCol')}</TableHeader>
                      <TableHeader scope="col">{tr('lateCol')}</TableHeader>
                      <TableHeader scope="col">{tr('doneInPeriodCol')}</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {d.workload.map((w) => {
                      const who = `assignee=${w.id ?? 'none'}`;
                      return (
                        <TableRow key={w.id ?? 'none'}>
                          <TableCell>{w.id ? w.name : <em>{w.name}</em>}</TableCell>
                          <TableCell>
                            <Num
                              value={w.pending}
                              label={tr('wPending', { name: w.name })}
                              to={link(`${who}&status=PENDING`)}
                            />
                          </TableCell>
                          <TableCell>
                            <Num
                              value={w.inReview}
                              label={tr('wInReview', { name: w.name })}
                              to={link(`${who}&status=IN_REVIEW`)}
                            />
                          </TableCell>
                          <TableCell>
                            {w.late > 0 ? (
                              <StatusText tone="red">
                                <Num
                                  value={w.late}
                                  label={tr('wLate', { name: w.name })}
                                  to={link(`${who}&age=late`)}
                                />
                              </StatusText>
                            ) : (
                              0
                            )}
                          </TableCell>
                          <TableCell>
                            {w.id ? (
                              <Num
                                value={w.completed}
                                label={tr('wDone', { name: w.name })}
                                to={link(`${who}&completedFrom=${since}`)}
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </HpsmSection>
          )}
        </>
      )}
    </>
  );
}
