import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import type { ReactNode } from 'react';

import type { Priority, Verdict } from '../api/types';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/mgmt';
import { HpsmSection } from './HpsmForm';
import { PriorityTag, StatusText, VerdictTag } from './tags';

type Duration = { n: number; avgHours: number | null; medianHours: number | null };

/** GET /api/management (item 77). */
export interface ManagementData {
  period: { from: string; to: string; tz: string; since: string; until: string };
  received: { total: number; files: number; urls: number };
  completed: number;
  timeToComplete: { all: Duration; byPriority: Record<Priority, Duration> };
  verdicts: Record<Verdict, number>;
  techniques: { id: string; name: string; count: number }[];
  cases: { opened: number; closed: number; openNow: number };
  workload: {
    id: string;
    name: string;
    completed: number;
    avgHours: number | null;
    reports: number;
    reviews: number;
  }[];
}

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
const VERDICTS: Verdict[] = ['MALICIOUS', 'SUSPICIOUS', 'CLEAN', 'UNKNOWN'];

/** "3,5 h" ate dois dias; depois "2 d 4 h". */
export function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 48) return `${h.toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} h`;
  const days = Math.floor(h / 24);
  const rest = Math.round(h - days * 24);
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** "01/10/2026 a 31/10/2026". */
export function periodLabel(from: string, to: string): string {
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(intlLocale());
  return from === to ? day(from) : tr('periodRange', { from: day(from), to: day(to) });
}

function Kpi({
  value,
  label,
  hint,
  tone = 'none',
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: 'none' | 'green' | 'blue' | 'orange';
}) {
  return (
    <div className="dl-kpi">
      <span className="dl-kpi__value">{value}</span>
      <span className="dl-kpi__label">
        <StatusText tone={tone}>{label}</StatusText>
      </span>
      {hint && <span className="dl-kpi__hint">{hint}</span>}
    </div>
  );
}

/**
 * Corpo do relatorio gerencial (tela e impressao): indicadores do periodo,
 * tempo ate concluir por prioridade, vereditos, tecnicas, casos e carga por
 * analista.
 */
export function ManagementReport({ data: d }: { data: ManagementData }) {
  const verdictMax = Math.max(1, ...VERDICTS.map((v) => d.verdicts[v]));
  const techniqueMax = Math.max(1, ...d.techniques.map((t) => t.count));
  return (
    <>
      <div className="dl-kpis" aria-label={tr('periodIndicators')}>
        <Kpi
          value={d.received.total}
          label={tr('received')}
          hint={tr('receivedDetail', { files: d.received.files, urls: d.received.urls })}
        />
        <Kpi value={d.completed} label={tr('done')} tone="green" hint={tr('noDuplicates')} />
        <Kpi
          value={fmtHours(d.timeToComplete.all.avgHours)}
          label={tr('avgTime')}
          hint={`mediana ${fmtHours(d.timeToComplete.all.medianHours)}`}
        />
        <Kpi value={d.cases.opened} label={tr('casesOpened')} tone="orange" />
        <Kpi value={d.cases.closed} label={tr('casesClosed')} tone="blue" />
        <Kpi value={d.cases.openNow} label={tr('casesOpenToday')} />
      </div>

      <div className="dl-dash-grid">
        <HpsmSection title={tr('timeByPriority')}>
          <TableContainer>
            <Table size="xs" aria-label={tr('timeByPriority')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{tr('priority')}</TableHeader>
                  <TableHeader scope="col">{tr('done')}</TableHeader>
                  <TableHeader scope="col">{tr('avgTimeShort')}</TableHeader>
                  <TableHeader scope="col">{tr('median')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {PRIORITIES.map((p) => {
                  const t = d.timeToComplete.byPriority[p];
                  return (
                    <TableRow key={p}>
                      <TableCell>
                        <PriorityTag priority={p} />
                      </TableCell>
                      <TableCell>{t.n}</TableCell>
                      <TableCell>{fmtHours(t.avgHours)}</TableCell>
                      <TableCell>{fmtHours(t.medianHours)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </HpsmSection>

        <HpsmSection title={tr('verdictsOfDone', { n: d.completed })}>
          <ul className="dl-hbars">
            {VERDICTS.map((v) => (
              <li key={v}>
                <span className="dl-hbars__label">
                  <VerdictTag verdict={v} />
                </span>
                <span className="dl-hbars__track">
                  <span
                    className="dl-hbars__bar"
                    style={{ width: `${(d.verdicts[v] / verdictMax) * 100}%` }}
                  />
                </span>
                <span className="dl-hbars__value">{d.verdicts[v]}</span>
              </li>
            ))}
          </ul>
        </HpsmSection>
      </div>

      <HpsmSection title={tr('topAttackShort')} className="dl-mt-lg">
        {d.techniques.length === 0 ? (
          <p className="dl-static-empty">{tr('noAttackPeriod')}</p>
        ) : (
          <ul className="dl-hbars dl-hbars--wide" aria-label={tr('topAttackShort')}>
            {d.techniques.map((t) => (
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
                <span className="dl-hbars__value">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </HpsmSection>

      <HpsmSection title={tr('workload')} className="dl-mt-lg">
        <TableContainer>
          <Table size="xs" aria-label={tr('workloadPeriodAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{tr('analyst')}</TableHeader>
                <TableHeader scope="col">{tr('doneAssignee')}</TableHeader>
                <TableHeader scope="col">{tr('avgTime')}</TableHeader>
                <TableHeader scope="col">{tr('publishedReports')}</TableHeader>
                <TableHeader scope="col">{tr('reviewsDone')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.workload.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{a.completed}</TableCell>
                  <TableCell>{fmtHours(a.avgHours)}</TableCell>
                  <TableCell>{a.reports}</TableCell>
                  <TableCell>{a.reviews}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </HpsmSection>
    </>
  );
}
