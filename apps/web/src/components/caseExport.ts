import type { AttackData } from '../api/types';
import type { CaseDetail, CaseIoc } from './cases';
import { CASE_STATUS, caseEventText, caseTechniques } from './cases';
import { block, cell } from './entryExport';
import { IOC_KIND_LABELS } from './iocs';
import { priorityLabel, statusLabel, verdictLabel } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
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
    `Exportado do DeepLook por ${exportedBy} em ${fmtDate(new Date().toISOString())}.`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| Código | ${c.code} |`,
    `| Status | ${CASE_STATUS[c.status].label} |`,
    `| Responsável | ${cell(c.assignee?.displayName)} |`,
    `| Criado por | ${cell(c.createdBy?.displayName)} |`,
    `| Criado em | ${fmtDate(c.createdAt)} |`,
    ...(c.closedAt ? [`| Encerrado em | ${fmtDate(c.closedAt)} |`] : []),
    '',
    ...block('Descrição', c.description),
    `## Amostras (${c.entries.length})`,
    '',
    '| Amostra | Tipo | Status | Prioridade | Veredito | SHA-256 / URL |',
    '|---|---|---|---|---|---|',
    ...c.entries.map(
      ({ entry }) =>
        `| ${cell(entry.title)} | ${entry.type === 'FILE' ? 'Arquivo' : 'Link'} | ${statusLabel(entry.status)} | ${priorityLabel(entry.priority)} | ${verdictLabel(entry.verdict)} | ${cell(entry.type === 'FILE' ? entry.sha256 : entry.url)} |`,
    ),
    '',
    `## Relatórios publicados (${reports.length})`,
    '',
  ];
  for (const r of reports) {
    lines.push(
      `### ${r.entry.title} — ${r.analyst?.displayName ?? '—'} — ${fmtDate(r.updatedAt)}`,
      '',
      `Veredito: **${verdictLabel(r.verdict)}**`,
      '',
      ...(r.attackTechniques.length ? [`ATT&CK: ${r.attackTechniques.join(', ')}`, ''] : []),
      ...block('Resumo', r.summary),
      ...block('Achados', r.findings),
      ...block('IOCs', r.iocs),
      ...(r.evidence.length
        ? [
            `**Evidências (${r.evidence.length})** — imagens no DeepLook:`,
            '',
            ...r.evidence.map(
              (e, i) => `- ${e.caption || `Evidência ${i + 1}`} (${e.width}×${e.height})`,
            ),
            '',
          ]
        : []),
    );
  }
  lines.push(
    `## Indicadores (${iocs.length})`,
    '',
    ...(iocs.length
      ? [
          '| Tipo | Valor | Origem | Amostras |',
          '|---|---|---|---|',
          ...iocs.map(
            (i) =>
              `| ${IOC_KIND_LABELS[i.kind]} | ${cell(i.value)} | ${i.source === 'REPORT' ? 'Relatório publicado' : 'Própria amostra'} | ${cell(i.entries.map((e) => e.title).join(', '))} |`,
          ),
        ]
      : ['Nenhum indicador.']),
    '',
    `## Técnicas ATT&CK (${techniques.length})`,
    '',
    ...(techniques.length
      ? [
          '| Técnica | Nome | Amostras |',
          '|---|---|---|',
          ...techniques.map(
            (t) =>
              `| ${t.id} | ${cell(attack?.techniques.find((x) => x.id === t.id)?.name)} | ${cell(t.entries.join(', '))} |`,
          ),
        ]
      : ['Nenhuma técnica nos relatórios publicados.']),
    '',
    `## Linha do tempo (${c.events.length})`,
    '',
    ...c.events.map(
      (e) =>
        `- ${fmtDate(e.createdAt)} — **${e.actor?.displayName ?? 'Alguém'}** ${caseEventText(e, names)}${
          e.type === 'COMMENT' && e.detail ? `: ${e.detail.replace(/\r?\n/g, ' ')}` : ''
        }`,
    ),
    '',
  );
  return lines.join('\n');
}
