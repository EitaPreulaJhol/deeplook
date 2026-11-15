import { createTranslator, type Lang } from './error-language';
import { MESSAGES_EN } from './messages-en';

/**
 * Especificacao OpenAPI em ingles (plano pos-revisao, item 1.4, parte 4): titulos, resumos e
 * descricoes das rotas, no idioma de quem pede. O teste tests/unit/openapi-language.test.ts le o
 * lib/openapi.ts e reprova texto sem par aqui.
 */
export const OPENAPI_EN: readonly (readonly [pt: string, en: string])[] = [
  ['Id da amostra (o `id` devolvido no envio).', 'Sample id (the `id` returned on submission).'],
  ['Dados inválidos (`details` traz os campos).', 'Invalid data (`details` lists the fields).'],
  ['Token ausente, inválido ou expirado.', 'Missing, invalid or expired token.'],
  [
    'Sem permissão (ou rota que não aceita token).',
    'No permission (or a route that does not accept a token).',
  ],
  ['Título (padrão: o nome do arquivo).', 'Title (default: the file name).'],
  ['Tags separadas por vírgula (até 20).', 'Comma-separated tags (up to 20).'],
  [
    'Envio e consulta de amostras com token de API (Minha Conta > Tokens de API). Envie `Authorization: Bearer <token>`. Só as rotas abaixo aceitam token; as demais respondem 403.',
    'Sample submission and lookup with an API token (My account > API tokens). Send `Authorization: Bearer <token>`. Only the routes below accept a token; the others answer 403.',
  ],
  ['Token criado em Minha Conta > Tokens de API.', 'Token created in My account > API tokens.'],
  ['Amostra (campos principais).', 'Sample (main fields).'],
  ['O que fazer, para quem enviou.', 'What to do, for the submitter.'],
  ['Esta especificação', 'This specification'],
  ['Documento OpenAPI 3.1.', 'OpenAPI 3.1 document.'],
  ['Enviar arquivo', 'Submit a file'],
  [
    'Um arquivo por envio (`.eml` vira e-mail com os anexos como amostras). Limite de envios por dia (429).',
    'One file per submission (`.eml` becomes an e-mail with the attachments as samples). Daily submission limit (429).',
  ],
  ['Envio anterior do mesmo arquivo.', 'Earlier submission of the same file.'],
  ['Amostra criada.', 'Sample created.'],
  [
    'Limite de envios do dia, ou envios grandes demais em andamento ao mesmo tempo.',
    'Daily submission limit, or too many large submissions in progress at the same time.',
  ],
  ['Enviar vários arquivos num .zip', 'Submit several files in a .zip'],
  [
    'Cada arquivo do .zip vira uma amostra (até 20). `password` para .zip protegido.',
    'Each file in the .zip becomes a sample (up to 20). `password` for a protected .zip.',
  ],
  ['Amostras criadas e arquivos ignorados.', 'Samples created and files skipped.'],
  ['Enviar link', 'Submit a link'],
  ['Listar amostras', 'List samples'],
  [
    '`scope=mine` traz só as do dono do token.',
    "`scope=mine` returns only the token owner's samples.",
  ],
  ['Amostra.', 'Sample.'],
  ['Eventos.', 'Events.'],
  ['Página de amostras.', 'Page of samples.'],
  [
    'Consultar a amostra (status, veredito, resolução)',
    'Get the sample (status, verdict, resolution)',
  ],
  ['Relatórios da amostra', 'Sample reports'],
  ['Usuário comum vê só os publicados.', 'A regular user sees only the published ones.'],
  ['Relatórios.', 'Reports.'],
  ['Histórico da amostra', 'Sample history'],
  ['Indicadores da amostra', 'Sample indicators'],
  [
    'Indicadores dos relatórios publicados e da própria amostra.',
    'Indicators from the published reports and from the sample itself.',
  ],
  [
    'Baixar os indicadores (CSV, STIX 2.1 ou MISP)',
    'Download the indicators (CSV, STIX 2.1 or MISP)',
  ],
  ['Arquivo para download.', 'File to download.'],
  ['Reputação (consultas externas já feitas)', 'Reputation (external lookups already done)'],
  ['Resultados por serviço.', 'Results per service.'],
  ['Resultado do antivírus', 'Antivirus result'],
  ['Varredura do arquivo.', 'File scan.'],
  ['Análise com o Ghidra', 'Ghidra analysis'],
  [
    'Pedida por um analista. Resumo do programa, as maiores funções, quem chama APIs sensíveis e o pseudo-C dessas funções e do ponto de entrada. `analysis` é null enquanto ninguém pedir.',
    'Requested by an analyst. Program summary, the largest functions, who calls sensitive APIs and the pseudo-C of those functions and of the entry point. `analysis` is null until someone asks.',
  ],
  ['Situação e resultado da análise.', 'Analysis status and result.'],
  ['Funções do pseudo-C completo (Ghidra)', 'Functions of the full pseudo-C (Ghidra)'],
  [
    'Lista paginada de todas as funções da análise com o Ghidra, na ordem de prioridade (ponto de entrada, as que chamam APIs sensíveis, as demais por tamanho, as de biblioteca por último). `hasCode` falso: a função ficou sem pseudo-C (`skipped` diz se foi o prazo ou o teto; `error`, a falha do descompilador).',
    'Paginated list of every function of the Ghidra analysis, in priority order (entry point, callers of sensitive APIs, the rest by size, library functions last). `hasCode` false: the function has no pseudo-C (`skipped` says whether the deadline or the cap cut it; `error`, the decompiler failure).',
  ],
  ['Parte do nome ou do endereço.', 'Part of the name or the address.'],
  ['`true`: só as que chamam APIs sensíveis.', '`true`: only callers of sensitive APIs.'],
  ['`true`: sem as funções de biblioteca.', '`true`: without library functions.'],
  [
    'Ordem: a de prioridade (padrão), nome, endereço, tamanho ou complexidade.',
    'Order: priority (default), name, address, size or complexity.',
  ],
  ['Página, a partir de 1.', 'Page, starting at 1.'],
  ['Funções por página (até 500).', 'Functions per page (up to 500).'],
  ['Funções da página e os totais.', 'The page of functions and the totals.'],
  ['Pseudo-C de uma função (Ghidra)', 'Pseudo-C of a function (Ghidra)'],
  [
    'A função pelo endereço (`0x...`, como na lista): o pseudo-C, as APIs que chama e os chamadores e chamadas, com o nome quando estão na lista.',
    'The function by address (`0x...`, as in the list): its pseudo-C, the APIs it calls and its callers and callees, with the name when they are in the list.',
  ],
  ['Endereço da função.', 'Function address.'],
  ['A função e o pseudo-C dela.', 'The function and its pseudo-C.'],
  ['Análise de funções (capa e FLOSS)', 'Function analysis (capa and FLOSS)'],
  [
    'O que as funções do executável fazem (regras do capa, com ATT&CK e MBC) e as strings que só aparecem na execução (FLOSS). `analysis` é null enquanto não houver análise.',
    'What the executable functions do (capa rules, with ATT&CK and MBC) and the strings that only show up at run time (FLOSS). `analysis` is null while there is no analysis.',
  ],
];

const toEnglish = createTranslator([...OPENAPI_EN, ...MESSAGES_EN]);
const TEXT_KEYS = new Set(['summary', 'description', 'title']);

function walk(value: unknown, key: string | null): unknown {
  if (typeof value === 'string')
    return key !== null && TEXT_KEYS.has(key) ? toEnglish(value) : value;
  if (Array.isArray(value)) return value.map((item) => walk(item, null));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]),
    );
  }
  return value;
}

/** O documento no idioma de quem pede: so titulo, resumo e descricao mudam. */
export function localizeOpenApi<T>(doc: T, lang: Lang): T {
  return lang === 'en' ? (walk(doc, null) as T) : doc;
}
