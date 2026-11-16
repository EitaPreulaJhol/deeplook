import { useState } from 'react';

import { intlLocale } from '../i18n';
import { t } from '../i18n/admin';

const W = 360;
const H = 140;
const PAD = { top: 10, right: 8, bottom: 22, left: 40 };

/**
 * Uma metrica do Monitoramento no tempo (plans/monitoramento, item 5): uma serie so (o titulo a
 * nomeia, sem legenda), linha de 2 px, grade discreta, um eixo. Passar o mouse mostra o horario e o
 * valor do ponto mais proximo; a tabela equivalente fica embaixo.
 */
export function MonitorChart({
  title,
  points,
  since,
  until,
  format,
  reference,
}: {
  title: string;
  points: [number, number][];
  since: number;
  until: number;
  format: (value: number) => string;
  /** Linha de referencia (o limite de ambientes). */
  reference?: { value: number; label: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(1e-9, reference?.value ?? 0, ...points.map((p) => p[1]));
  const top = niceTop(max);
  const x = (time: number) => PAD.left + ((time - since) / Math.max(1, until - since)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const path = points
    .map(([time, v], i) => `${i ? 'L' : 'M'}${x(time).toFixed(1)},${y(v).toFixed(1)}`)
    .join('');
  const hourFmt = new Intl.DateTimeFormat(intlLocale(), {
    ...(until - since > 2 * 86_400_000 ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
  const ticksX = [since, since + (until - since) / 2, until];
  const point = hover !== null ? points[hover] : null;

  const nearest = (clientX: number, rect: DOMRect) => {
    if (!points.length) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i][0]) - px) < Math.abs(x(points[best][0]) - px)) best = i;
    }
    setHover(best);
  };

  return (
    <figure className="dl-monchart">
      <figcaption className="dl-monchart__title">{title}</figcaption>
      {points.length === 0 ? (
        <p className="dl-hint-muted">{t('monChartEmpty')}</p>
      ) : (
        <>
          <div className="dl-chart__plot">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={title}
              onMouseMove={(e) => nearest(e.clientX, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setHover(null)}
            >
              {/* Contagens (topo inteiro): sem a marca do meio quebrada ("2.5 ambientes"). */}
              {[0, top / 2, top]
                .filter((tick) => !Number.isInteger(top) || Number.isInteger(tick))
                .map((tick) => (
                  <g key={tick}>
                    <line
                      className="dl-chart__grid"
                      x1={PAD.left}
                      x2={W - PAD.right}
                      y1={y(tick)}
                      y2={y(tick)}
                    />
                    <text
                      className="dl-chart__tick"
                      x={PAD.left - 4}
                      y={y(tick) + 4}
                      textAnchor="end"
                    >
                      {format(tick)}
                    </text>
                  </g>
                ))}
              {ticksX.map((tick, i) => (
                <text
                  key={tick}
                  className="dl-chart__tick"
                  x={x(tick)}
                  y={H - 6}
                  textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
                >
                  {hourFmt.format(tick)}
                </text>
              ))}
              {reference && (
                <g>
                  <line
                    className="dl-monchart__ref"
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={y(reference.value)}
                    y2={y(reference.value)}
                  />
                  <text
                    className="dl-chart__tick"
                    x={W - PAD.right}
                    y={y(reference.value) - 3}
                    textAnchor="end"
                  >
                    {reference.label}
                  </text>
                </g>
              )}
              <path className="dl-monchart__line" d={path} />
              {points.length === 1 && (
                <circle
                  className="dl-monchart__dot"
                  cx={x(points[0][0])}
                  cy={y(points[0][1])}
                  r={4}
                />
              )}
              {point && (
                <g>
                  <line
                    className="dl-monchart__cross"
                    x1={x(point[0])}
                    x2={x(point[0])}
                    y1={PAD.top}
                    y2={PAD.top + plotH}
                  />
                  <circle className="dl-monchart__dot" cx={x(point[0])} cy={y(point[1])} r={4} />
                </g>
              )}
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
                style={
                  x(point[0]) < W * 0.6
                    ? { left: `calc(${(x(point[0]) / W) * 100}% + 8px)` }
                    : { right: `calc(${(1 - x(point[0]) / W) * 100}% + 8px)` }
                }
              >
                <strong>{hourFmt.format(point[0])}</strong>
                <span>{format(point[1])}</span>
              </div>
            )}
          </div>
          <details className="dl-chart__table">
            <summary>{t('monChartTable')}</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('monChartTime')}</th>
                  <th scope="col">{t('monChartValue')}</th>
                </tr>
              </thead>
              <tbody>
                {points.map(([time, v]) => (
                  <tr key={time}>
                    <td>{hourFmt.format(time)}</td>
                    <td>{format(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  );
}

/** Topo do eixo "redondo" (1, 2, 5 x 10^n) acima do maior valor. */
export function niceTop(max: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 5, 10]) if (step * exp >= max) return step * exp;
  return 10 * exp;
}
