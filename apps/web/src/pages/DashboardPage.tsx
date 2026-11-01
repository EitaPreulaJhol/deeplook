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

const PERIODS = [7, 30, 90] as const;
const VERDICTS: Verdict[] = ['MALICIOUS', 'SUSPICIOUS', 'CLEAN', 'UNKNOWN'];

/** Numero que leva a lista ja filtrada (ou texto, sem link). */
function Num({ to, value, label }: { to?: string; value: number; label: string }) {
  return to ? (
    <Link className="dl-link" to={to} title={`Abrir a lista: ${label}`}>
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
    <Link className="dl-kpi dl-kpi--link" to={to} title={`Abrir a lista: ${label}`}>
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
  const sinceLabel = d ? new Date(d.since).toLocaleDateString('pt-BR') : '';
  const verdictTotal = d ? VERDICTS.reduce((sum, v) => sum + d.byVerdict[v], 0) : 0;
  const verdictMax = d ? Math.max(1, ...VERDICTS.map((v) => d.byVerdict[v])) : 1;
  const techniqueMax = Math.max(1, ...(d?.techniques ?? []).map((t) => t.count));

  return (
    <>
      <HpsmToolbar label="Ações do painel">
        <HpsmToolbarButton
          label={query.isFetching ? 'Atualizando...' : 'Atualizar'}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
      </HpsmToolbar>
      <PageHeader
        title="Painel"
        subtitle={
          mine
            ? 'Situação das amostras que você enviou.'
            : 'Situação das filas de análise. Cada número abre a lista correspondente.'
        }
      />
      <div className="hpsm-filterbar">
        <div className="hpsm-filterbar__item">
          <label className="hpsm-filterbar__label" htmlFor="dash-period">
            Período:
          </label>
          <Select
            id="dash-period"
            labelText="Período"
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
              <SelectItem key={p} value={String(p)} text={`Últimos ${p} dias`} />
            ))}
          </Select>
        </div>
      </div>

      {query.isLoading && <HpsmLoading text="Calculando os indicadores..." />}
      {query.isError && (
        <HpsmMessage kind="error">
          Erro ao carregar o painel: {(query.error as Error).message}
        </HpsmMessage>
      )}

      {d && (
        <>
          <div className="dl-kpis" aria-label="Indicadores">
            <Kpi
              value={d.byStatus.PENDING}
              label="Pendentes"
              tone="gray"
              to={link('status=PENDING')}
            />
            <Kpi
              value={d.byStatus.IN_REVIEW}
              label="Em análise"
              tone="blue"
              to={link('status=IN_REVIEW')}
            />
            {/* Prazos e ATT&CK sao da equipe, nao de quem enviou (item 138). */}
            {canTriage && (
              <>
                <Kpi
                  value={d.open.warn}
                  label="Em alerta ou atrasadas"
                  tone="orange"
                  hint={`mais de ${d.sla.warnHours} h no status`}
                  to={link('age=warn')}
                />
                <Kpi
                  value={d.open.late}
                  label="Atrasadas"
                  tone="red"
                  hint={`mais de ${d.sla.lateHours} h no status`}
                  to={link('age=late')}
                />
              </>
            )}
            <Kpi
              value={d.period.submitted}
              label="Enviadas no período"
              hint={`desde ${sinceLabel}`}
              to={link(`submittedFrom=${since}`)}
            />
            <Kpi
              value={d.period.completed}
              label="Concluídas no período"
              tone="green"
              hint={`desde ${sinceLabel} (sem duplicatas)`}
              to={link(`completedFrom=${since}`)}
            />
          </div>

          <div className="dl-dash-grid">
            <HpsmSection title={`Entrada e conclusão por dia (últimos ${d.days} dias)`}>
              <DailyChart data={d.daily} />
            </HpsmSection>

            <HpsmSection title={`Vereditos (${verdictTotal} amostras)`}>
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
            <HpsmSection title="Técnicas ATT&CK mais vistas no período" className="dl-mt-lg">
              {(d.techniques ?? []).length === 0 ? (
                <p className="dl-static-empty">
                  Nenhuma técnica registrada nos relatórios publicados desde {sinceLabel}.
                </p>
              ) : (
                <ul className="dl-hbars dl-hbars--wide" aria-label="Técnicas ATT&CK mais vistas">
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
            <HpsmSection title="Carga por analista" className="dl-mt-lg">
              <TableContainer>
                <Table size="xs" aria-label="Carga por analista">
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">Responsável</TableHeader>
                      <TableHeader scope="col">Pendentes</TableHeader>
                      <TableHeader scope="col">Em análise</TableHeader>
                      <TableHeader scope="col">Atrasadas</TableHeader>
                      <TableHeader scope="col">Concluídas no período</TableHeader>
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
                              label={`${w.name}: pendentes`}
                              to={link(`${who}&status=PENDING`)}
                            />
                          </TableCell>
                          <TableCell>
                            <Num
                              value={w.inReview}
                              label={`${w.name}: em análise`}
                              to={link(`${who}&status=IN_REVIEW`)}
                            />
                          </TableCell>
                          <TableCell>
                            {w.late > 0 ? (
                              <StatusText tone="red">
                                <Num
                                  value={w.late}
                                  label={`${w.name}: atrasadas`}
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
                                label={`${w.name}: concluídas`}
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
