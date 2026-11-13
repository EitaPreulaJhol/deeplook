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
  const br = (d: string) => d.split('-').reverse().join('/');
  return from === to ? br(from) : `${br(from)} a ${br(to)}`;
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
      <div className="dl-kpis" aria-label="Indicadores do período">
        <Kpi
          value={d.received.total}
          label="Amostras recebidas"
          hint={`${d.received.files} arquivo(s), ${d.received.urls} link(s)`}
        />
        <Kpi value={d.completed} label="Concluídas" tone="green" hint="sem duplicatas" />
        <Kpi
          value={fmtHours(d.timeToComplete.all.avgHours)}
          label="Tempo médio até concluir"
          hint={`mediana ${fmtHours(d.timeToComplete.all.medianHours)}`}
        />
        <Kpi value={d.cases.opened} label="Casos abertos" tone="orange" />
        <Kpi value={d.cases.closed} label="Casos encerrados" tone="blue" />
        <Kpi value={d.cases.openNow} label="Casos em aberto hoje" />
      </div>

      <div className="dl-dash-grid">
        <HpsmSection title="Tempo até concluir por prioridade">
          <TableContainer>
            <Table size="xs" aria-label="Tempo até concluir por prioridade">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Prioridade</TableHeader>
                  <TableHeader scope="col">Concluídas</TableHeader>
                  <TableHeader scope="col">Tempo médio</TableHeader>
                  <TableHeader scope="col">Mediana</TableHeader>
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

        <HpsmSection title={`Vereditos das concluídas (${d.completed})`}>
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

      <HpsmSection title="Técnicas ATT&CK mais vistas" className="dl-mt-lg">
        {d.techniques.length === 0 ? (
          <p className="dl-static-empty">
            Nenhuma técnica nos relatórios publicados escritos no período.
          </p>
        ) : (
          <ul className="dl-hbars dl-hbars--wide" aria-label="Técnicas ATT&CK mais vistas">
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

      <HpsmSection title="Carga por analista" className="dl-mt-lg">
        <TableContainer>
          <Table size="xs" aria-label="Carga por analista no período">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Analista</TableHeader>
                <TableHeader scope="col">Concluídas (responsável)</TableHeader>
                <TableHeader scope="col">Tempo médio até concluir</TableHeader>
                <TableHeader scope="col">Relatórios publicados</TableHeader>
                <TableHeader scope="col">Revisões feitas</TableHeader>
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
