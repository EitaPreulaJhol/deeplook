import { createTranslator, type Lang } from './error-language';

/**
 * Cabecalhos e rotulos dos CSVs em ingles (plano pos-revisao, item 1.4, parte 4): relatorio
 * gerencial e indicadores da amostra e do caso. O CSV sai no idioma da interface, que o link manda
 * em `?lang=`. A lista de amostras e a auditoria tem os rotulos nas proprias rotas.
 */
export const CSV_EN: readonly (readonly [pt: string, en: string])[] = [
  // Cabecalhos.
  ['Seção', 'Section'],
  ['Quantidade', 'Count'],
  ['Tempo médio (h)', 'Average time (h)'],
  ['Mediana (h)', 'Median (h)'],
  ['Relatórios', 'Reports'],
  ['Revisões', 'Reviews'],
  ['Tipo', 'Type'],
  ['Valor', 'Value'],
  ['Origem', 'Source'],
  ['Amostra', 'Sample'],
  ['ID da amostra', 'Sample ID'],
  ['Amostras', 'Samples'],
  ['IDs das amostras', 'Sample IDs'],
  ['Caso', 'Case'],
  // Relatorio gerencial.
  ['Período', 'Period'],
  ['Recebidas', 'Received'],
  ['Recebidas (arquivos)', 'Received (files)'],
  ['Recebidas (links)', 'Received (links)'],
  ['Concluídas', 'Completed'],
  ['Tempo até concluir', 'Time to complete'],
  ['Todas', 'All'],
  ['Vereditos', 'Verdicts'],
  ['Técnicas ATT&CK', 'ATT&CK techniques'],
  ['Casos', 'Cases'],
  ['Abertos no período', 'Opened in the period'],
  ['Encerrados no período', 'Closed in the period'],
  ['Em aberto agora', 'Open now'],
  ['Analistas', 'Analysts'],
  ['Malicioso', 'Malicious'],
  ['Suspeito', 'Suspicious'],
  ['Limpo', 'Clean'],
  ['Desconhecido', 'Unknown'],
  ['P1 Crítica', 'P1 Critical'],
  ['P2 Alta', 'P2 High'],
  ['P3 Média', 'P3 Medium'],
  ['P4 Baixa', 'P4 Low'],
  ['{0} a {1} ({2})', '{0} to {1} ({2})'],
  // Indicadores.
  ['Domínio', 'Domain'],
  ['Relatório publicado', 'Published report'],
  ['Própria amostra', 'The sample itself'],
];

const toEnglish = createTranslator(CSV_EN);

/** Tradutor das celulas de texto de um CSV, no idioma pedido. */
export function csvText(lang: Lang): (text: string) => string {
  return lang === 'en' ? toEnglish : (text) => text;
}
