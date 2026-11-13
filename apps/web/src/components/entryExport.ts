import type { Entry } from '../api/types';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/entry';
import { formatFileSize } from './HpsmFileDrop';
import { statusLabel, verdictLabel } from './tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

/** Celula de tabela Markdown: sem quebras de linha e com "|" escapado. */
export function cell(value: string | null | undefined): string {
  return (value ?? '—').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** Bloco de texto livre em Markdown (cerca de codigo: preserva quebras e IOCs). */
export function block(title: string, text?: string | null): string[] {
  if (!text?.trim()) return [];
  return [`**${title}**`, '', '```', text.trim(), '```', ''];
}

/**
 * Relatorios publicados da amostra em Markdown (menu "Mais" > Exportar
 * relatorios): cabecalho com os dados da amostra e um bloco por relatorio.
 * Rascunhos ficam de fora.
 */
export function entryReportsMarkdown(entry: Entry, exportedBy: string): string {
  const published = (entry.reports ?? []).filter((r) => r.status === 'PUBLISHED');
  const lines = [
    `# ${entry.title}`,
    '',
    tr('exportedBy', { by: exportedBy, date: fmtDate(new Date().toISOString()) }),
    '',
    tr('mdHeader'),
    '|---|---|',
    `| ID | ${cell(entry.id)} |`,
    `| ${tr('mdType')} | ${entry.type === 'FILE' ? tr('typeFile') : tr('typeUrl')} |`,
    tr('mdOwner', { name: cell(entry.owner.displayName) }),
    tr('mdSubmitted', { date: fmtDate(entry.createdAt) }),
    tr('mdStatus', { status: statusLabel(entry.status) }),
    tr('mdVerdict', { verdict: verdictLabel(entry.verdict) }),
    ...(entry.type === 'FILE'
      ? [
          tr('mdFile', {
            name: cell(entry.originalFilename),
            size: formatFileSize(entry.fileSize),
          }),
          `| SHA-256 | ${cell(entry.sha256)} |`,
        ]
      : [`| URL | ${cell(entry.url)} |`]),
    ...(entry.tags.length
      ? [tr('mdTags', { tags: cell(entry.tags.map((t) => t.name).join(', ')) })]
      : []),
    '',
    tr('mdPublished', { n: published.length }),
    '',
  ];
  for (const report of published) {
    lines.push(
      `### ${report.analyst.displayName} — ${fmtDate(report.createdAt)}`,
      '',
      tr('mdReportVerdict', { verdict: verdictLabel(report.verdict) }),
      '',
      ...block(tr('summary'), report.summary),
      ...block(tr('findings'), report.findings),
      ...block('IOCs', report.iocs),
    );
  }
  return lines.join('\n');
}

/**
 * Baixa um arquivo gerado pela API. Sem o atributo `download`: o nome e o tipo
 * vem do Content-Disposition da resposta (attachment), e a pagina continua.
 */
export function downloadUrl(url: string) {
  const link = document.createElement('a');
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Baixa um texto como arquivo (sem ida ao servidor). */
export function downloadText(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
