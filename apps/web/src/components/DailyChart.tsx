import { useState } from 'react';

import { localized } from '../i18n';
import { t as tr } from '../i18n/mgmt';

export interface DailyPoint {
  /** YYYY-MM-DD no fuso do navegador. */
  day: string;
  submitted: number;
  completed: number;
}

const W = 720;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };
const SERIES = localized(() => [
  { key: 'submitted' as const, label: tr('sent'), className: 'dl-chart__bar--s1' },
  { key: 'completed' as const, label: tr('done'), className: 'dl-chart__bar--s2' },
]);

function dayLabel(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

/** Topo arredondado (4px) com a base reta, apoiada no eixo. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Colunas agrupadas por dia (enviadas x concluidas), um eixo so, grade discreta.
 * Passar o mouse (ou focar) num dia mostra os dois numeros; legenda acima e
 * tabela equivalente abaixo (a cor nunca e o unico meio de leitura).
 */
export function DailyChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.submitted, d.completed]));
  // Escala com topo "redondo" (inteiros) e 2 linhas de grade.
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(18, (band - 6) / 2 - gap / 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top].filter((t) => Number.isInteger(t));
  // Rotulos do eixo X sem encavalar: no maximo ~10.
  const every = Math.ceil(data.length / 10);
  const totals = SERIES.map((s) => data.reduce((sum, d) => sum + d[s.key], 0));
  const point = hover !== null ? data[hover] : null;

  return (
    <div className="dl-chart">
      <div className="dl-chart__legend" aria-hidden="true">
        {SERIES.map((s, i) => (
          <span key={s.key}>
            <span className={`dl-chart__swatch ${s.className}`} /> {s.label} ({totals[i]})
          </span>
        ))}
      </div>
      <div className="dl-chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={tr('chartAria', { s: totals[0], c: totals[1] })}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="dl-chart__grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="dl-chart__tick" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const x1 = cx - barW - gap / 2;
            const x2 = cx + gap / 2;
            return (
              <g key={d.day}>
                {hover === i && (
                  <rect
                    className="dl-chart__hover"
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                  />
                )}
                <path
                  className={`dl-chart__bar ${SERIES[0].className}`}
                  d={columnPath(x1, y(d.submitted), barW, plotH + PAD.top - y(d.submitted))}
                />
                <path
                  className={`dl-chart__bar ${SERIES[1].className}`}
                  d={columnPath(x2, y(d.completed), barW, plotH + PAD.top - y(d.completed))}
                />
                {(i % every === 0 || i === data.length - 1) && (
                  <text className="dl-chart__tick" x={cx} y={H - 8} textAnchor="middle">
                    {dayLabel(d.day)}
                  </text>
                )}
                {/* Area de toque maior que as colunas: o dia inteiro. */}
                <rect
                  className="dl-chart__hit"
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          <line
            className="dl-chart__axis"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
          />
        </svg>
        {point && hover !== null && (
          <div
            className="dl-chart__tooltip"
            role="status"
            // Ao lado do dia (nunca por cima das colunas): a direita, ou a esquerda
            // no terco final do grafico.
            style={
              hover < (data.length * 2) / 3
                ? { left: `calc(${((PAD.left + band * (hover + 1)) / W) * 100}% + 6px)` }
                : { right: `calc(${(1 - (PAD.left + band * hover) / W) * 100}% + 6px)` }
            }
          >
            <strong>{dayLabel(point.day)}</strong>
            <span>
              <span className={`dl-chart__swatch ${SERIES[0].className}`} />{' '}
              {tr('sentN', { n: point.submitted })}
            </span>
            <span>
              <span className={`dl-chart__swatch ${SERIES[1].className}`} />{' '}
              {tr('doneN', { n: point.completed })}
            </span>
          </div>
        )}
      </div>
      <details className="dl-chart__table">
        <summary>{tr('viewTable')}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('day')}</th>
              <th scope="col">{tr('sent')}</th>
              <th scope="col">{tr('done')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day)}</td>
                <td>{d.submitted}</td>
                <td>{d.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
