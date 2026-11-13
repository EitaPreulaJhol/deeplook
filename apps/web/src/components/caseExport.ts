import type { AttackData } from '../api/types';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/cases';
import type { CaseDetail, CaseIoc } from './cases';
import { CASE_STATUS, caseEventText, caseTechniques } from './cases';
import { block, cell } from './entryExport';
import { IOC_KIND_LABELS } from './iocs';
import { priorityLabel, statusLabel, verdictLabel } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

/**
 * Caso em Markdown (item 74): dados, amostras com hash e veredito, relatorios
 * publicados, IOCs de todas as amostras (sem repetir), tecnicas ATT&CK e linha
 * do tempo.
 */
export function caseMarkdown(
  c: CaseDetail,
  iocs: CaseIoc[],
  attack: AttackData | undefined,
  names: Map<string, string>,
  exportedBy: string,
): string {
  const reports = c.entries.flatMap(({ entry }) => entry.reports.map((r) => ({ ...r, entry })));
  const techniques = caseTechniques(c);
  const lines = [
    `# ${c.code} · ${c.title}`,
    '',
    tr('exportedBy', { by: exportedBy, date: fmtDate(new Date().toISOString()) }),
    '',
    tr('mdHeader'),
    '|---|---|',
    tr('mdCode', { code: c.code }),
    tr('mdStatus', { status: CASE_STATUS[c.status].label }),
    tr('mdAssignee', { name: cell(c.assignee?.displayName) }),
    tr('mdCreatedBy', { name: cell(c.createdBy?.displayName) }),
    tr('mdCreatedAt', { date: fmtDate(c.createdAt) }),
    ...(c.closedAt ? [tr('mdClosedAt', { date: fmtDate(c.closedAt) })] : []),
    '',
    ...block(tr('description'), c.description),
    tr('mdSamples', { n: c.entries.length }),
    '',
    tr('mdSamplesHeader'),
    '|---|---|---|---|---|---|',
    ...c.entries.map(
      ({ entry }) =>
        `| ${cell(entry.title)} | ${entry.type === 'FILE' ? tr('typeFile') : tr('typeUrl')} | ${statusLabel(entry.status)} | ${priorityLabel(entry.priority)} | ${verdictLabel(entry.verdict)} | ${cell(entry.type === 'FILE' ? entry.sha256 : entry.url)} |`,
    ),
    '',
    tr('mdPublished', { n: reports.length }),
    '',
  ];
  for (const r of reports) {
    lines.push(
      `### ${r.entry.title} — ${r.analyst?.displayName ?? '—'} — ${fmtDate(r.updatedAt)}`,
      '',
      tr('mdVerdict', { verdict: verdictLabel(r.verdict) }),
      '',
      ...(r.attackTechniques.length ? [`ATT&CK: ${r.attackTechniques.join(', ')}`, ''] : []),
      ...block(tr('summary'), r.summary),
      ...block(tr('findings'), r.findings),
      ...block('IOCs', r.iocs),
      ...(r.evidence.length
        ? [
            tr('mdEvidence', { n: r.evidence.length }),
            '',
            ...r.evidence.map(
              (e, i) =>
                `- ${e.caption || tr('evidenceItem', { n: i + 1 })} (${e.width}×${e.height})`,
            ),
            '',
          ]
        : []),
    );
  }
  lines.push(
    tr('mdIndicators', { n: iocs.length }),
    '',
    ...(iocs.length
      ? [
          tr('mdIocHeader'),
          '|---|---|---|---|',
          ...iocs.map(
            (i) =>
              `| ${IOC_KIND_LABELS[i.kind]} | ${cell(i.value)} | ${i.source === 'REPORT' ? tr('publishedReport') : tr('sampleItself')} | ${cell(i.entries.map((e) => e.title).join(', '))} |`,
          ),
        ]
      : [tr('noIndicator')]),
    '',
    tr('mdTechniques', { n: techniques.length }),
    '',
    ...(techniques.length
      ? [
          tr('mdTechHeader'),
          '|---|---|---|',
          ...techniques.map(
            (t) =>
              `| ${t.id} | ${cell(attack?.techniques.find((x) => x.id === t.id)?.name)} | ${cell(t.entries.join(', '))} |`,
          ),
        ]
      : [tr('noTechniques')]),
    '',
    tr('mdTimeline', { n: c.events.length }),
    '',
    ...c.events.map(
      (e) =>
        `- ${fmtDate(e.createdAt)} — **${e.actor?.displayName ?? tr('someone')}** ${caseEventText(e, names)}${
          e.type === 'COMMENT' && e.detail ? `: ${e.detail.replace(/\r?\n/g, ' ')}` : ''
        }`,
    ),
    '',
  );
  return lines.join('\n');
}
