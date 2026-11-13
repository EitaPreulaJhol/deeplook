import type { Entry } from '../api/types';
import { intlLocale } from '../i18n';
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
    `Exportado do DeepLook por ${exportedBy} em ${fmtDate(new Date().toISOString())}.`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| ID | ${cell(entry.id)} |`,
    `| Tipo | ${entry.type === 'FILE' ? 'Arquivo' : 'Link'} |`,
    `| Enviado por | ${cell(entry.owner.displayName)} |`,
    `| Enviado em | ${fmtDate(entry.createdAt)} |`,
    `| Status | ${statusLabel(entry.status)} |`,
    `| Veredito | ${verdictLabel(entry.verdict)} |`,
    ...(entry.type === 'FILE'
      ? [
          `| Arquivo | ${cell(entry.originalFilename)} (${formatFileSize(entry.fileSize)}) |`,
          `| SHA-256 | ${cell(entry.sha256)} |`,
        ]
      : [`| URL | ${cell(entry.url)} |`]),
    ...(entry.tags.length ? [`| Tags | ${cell(entry.tags.map((t) => t.name).join(', '))} |`] : []),
    '',
    `## Relatórios publicados (${published.length})`,
    '',
  ];
  for (const report of published) {
    lines.push(
      `### ${report.analyst.displayName} — ${fmtDate(report.createdAt)}`,
      '',
      `Veredito: **${verdictLabel(report.verdict)}**`,
      '',
      ...block('Resumo', report.summary),
      ...block('Achados', report.findings),
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
