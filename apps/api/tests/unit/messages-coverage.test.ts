import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

import { MESSAGES_EN } from '../../src/lib/messages-en';

/**
 * Cobertura do dicionario de erros em ingles (plano pos-revisao, item 1.2).
 *
 * Le o codigo da API e separa os textos em portugues que tem cara de mensagem de erro: o valor de
 * `error`/`message`, o argumento de `new XxxError(...)`, as mensagens do zod, as constantes
 * `*_MESSAGE`/`*_ERROR` e o retorno de funcoes `*message*`, `*reason*`, `*problem*`, `*error*` e
 * `*hint*`. Logs ficam de fora. Trechos variaveis (`${...}` e o que nao e texto numa concatenacao
 * com `+`) viram `{0}`, `{1}`... na ordem em que aparecem, como no dicionario.
 *
 * Cada texto achado precisa ter par em MESSAGES_EN ou estar em NOT_SENT, com o motivo. E o
 * contrario: par do dicionario que nenhum texto usa mais, ou excecao que nao casa com nada,
 * tambem reprova, para as duas listas nao acumularem entradas mortas.
 */

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Arquivos inteiros cujas mensagens nunca chegam a uma resposta da API. */
const FILES_NOT_SENT: Record<string, string> = {
  'src/env.ts': 'validacao do .env na partida: a API nem sobe',
  'src/seed.ts': 'seed do admin, roda no entrypoint',
  'src/restore.ts': 'restauracao pela linha de comando (scripts/restore.sh)',
  'src/lib/restore.ts': 'restauracao pela linha de comando (scripts/restore.sh)',
  'src/lib/zip-file-reader.ts': 'leitor do ZIP do backup, so usado pela restauracao',
  'src/lib/proxmox-mock.ts': 'simulador do Proxmox para testes e desenvolvimento',
};

const DATA = 'dado gravado ou calculado, nao resposta de erro (item 1.4 do plano)';
const INTERNAL = 'erro interno sem statusCode: o cliente recebe o 500 generico';

/**
 * Textos que casam com o padrao de erro mas nao saem em `error`/`details`: [texto, motivo]. Vale
 * para o texto em qualquer arquivo (as analises em segundo plano repetem as mesmas frases).
 */
const NOT_SENT: [text: string, reason: string][] = [
  // Analises em segundo plano (capa, ghidra, oletools, unpack, reputacao, links): o motivo da
  // falha fica gravado na analise e aparece na ficha.
  ['falha interna na análise', DATA],
  ['o arquivo não está mais disponível', DATA],
  ['não foi possível ler o arquivo no armazenamento', DATA],
  ['resposta do serviço em formato inesperado', DATA],
  ['o capa não produziu resultado', DATA],
  ['a análise falhou', DATA],
  ['falha interna ao desempacotar', DATA],
  ['UPX sem a marca UPX! (disfarçado): o upx não desempacota sem ela', DATA],
  ['sem manifest.json', DATA],
  ['falha ao criar as amostras filhas ({0} de {1} criadas)', DATA],
  ['não é OLE', DATA],
  ['setor fora do arquivo', DATA],
  ['container VBA inválido', DATA],
  ['O certificado de quem assinou não veio no arquivo.', DATA],
  ['resposta inválida', DATA],
  // Artefatos do sandbox (print e processos): o motivo da falha fica no ambiente.
  [
    'sem permissão para usar o agente da VM no Proxmox (VM.GuestAgent.Unrestricted no PVE 9, VM.Monitor no 8)',
    DATA,
  ],
  ['o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)', DATA],
  ['o agente da VM falhou: {0}', DATA],
  ['a listagem de processos não terminou a tempo', DATA],
  ['o console fechou a conexão', DATA],
  ['o console não respondeu a tempo', DATA],
  ['o console não falou RFB', DATA],
  ['segurança do console não suportada ({0})', DATA],
  ['senha do console recusada', DATA],
  ['tela de tamanho inesperado ({0}x{1})', DATA],
  ['mensagem inesperada do console ({0})', DATA],
  ['codificação inesperada ({0})', DATA],
  // Status do sistema: calculado a cada pedido, numa resposta 200.
  ['sem resposta em {0} s', DATA],
  ['servidor inalcançável', DATA],
  ['acesso negado (confira as credenciais)', DATA],
  ['não encontrado (bucket inexistente?)', DATA],
  ['o clamd não respondeu ao PING', DATA],
  ['o serviço respondeu {0}', DATA],
  // Motivos de uma atualizacao de regras ter ficado retida: gravados na versao.
  ['A licença da fonte mudou: é preciso ler antes de aceitar.', DATA],
  ['Mudança grande: {0} de {1} conjuntos alterados ou removidos.', DATA],
  ['Regra nova dispara em amostra Limpa: {0}.', DATA],
  ['Compilação mais lenta: de {0} ms para {1} ms.', DATA],
  // AD: o motivo vai para a Auditoria (login recusado) e para o status do sistema.
  ['LDAP_URL deve começar com ldaps:// ou ldap://', DATA],
  ['sem TLS: use ldaps:// ou LDAP_STARTTLS=true', DATA],
  ['LDAP_USER_FILTER sem {login}', DATA],
  ['AD não configurado', DATA],
  // Erros internos.
  ['a chave de dados que cifrou este valor não está no ambiente', INTERNAL],
  ['formato de segredo desconhecido', INTERNAL],
  ['[s3] Nao foi possivel garantir o bucket apos varias tentativas.', 'partida da API'],
];

const PT =
  /[ãõçáéíóúâêôàÃÇÁÉÍÓÚ]|\b(de|da|do|das|dos|para|com|sem|uma|um|não|nao|que|por|na|no|ou|em|ao|os|as)\b/i;
const LOG_METHOD = /\.(log|info|warn|error|debug|trace|fatal)$|^console\./;
const ZOD_CALL =
  /\.(min|max|length|regex|refine|superRefine|email|url|int|positive|nonnegative|nonempty|startsWith|endsWith)$/;

interface Found {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

const unparen = (node: ts.Node): ts.Node =>
  ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
/** O primeiro ancestral que nao e um parentese. */
function outerParent(node: ts.Node): ts.Node | undefined {
  let up: ts.Node | undefined = node.parent;
  while (up && ts.isParenthesizedExpression(up)) up = up.parent;
  return up;
}
const isPlus = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
const isText = (node: ts.Node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

/** Concatenacao que tem algum texto (e nao uma soma de numeros). */
function hasText(node: ts.Node): boolean {
  const n = unparen(node);
  if (isText(n)) return true;
  return isPlus(n) && (hasText(n.left) || hasText(n.right));
}

/** O texto como a API o monta, com `{n}` no lugar de cada trecho variavel. */
function build(node: ts.Node, slot: { next: number }): string {
  const n = unparen(node);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    return n.head.text + n.templateSpans.map((s) => `{${slot.next++}}${s.literal.text}`).join('');
  }
  if (isPlus(n) && hasText(n)) return build(n.left, slot) + build(n.right, slot);
  return `{${slot.next++}}`;
}

function inLogOrImport(node: ts.Node): boolean {
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isImportDeclaration(up)) return true;
    if (ts.isCallExpression(up)) {
      const callee = up.expression.getText();
      if (LOG_METHOD.test(callee) && /log|console/.test(callee)) return true;
    }
    if (ts.isStatement(up)) return false;
  }
  return false;
}

function errorContext(node: ts.Node, file: string): boolean {
  if (/validation\.ts$/.test(file)) return true;
  for (let up = node.parent; up; up = up.parent) {
    if (ts.isPropertyAssignment(up) && /^(error|message)$/.test(up.name.getText())) return true;
    if (ts.isNewExpression(up) && /Error$/.test(up.expression.getText())) return true;
    if (ts.isCallExpression(up) && ZOD_CALL.test(up.expression.getText())) return true;
    if (ts.isVariableDeclaration(up) && /(MESSAGE|ERROR|_MSG)$/.test(up.name.getText()))
      return true;
    if (
      ts.isFunctionDeclaration(up) &&
      up.name &&
      /message|reason|problem|error|hint/i.test(up.name.text)
    ) {
      return true;
    }
    if (ts.isSourceFile(up)) return false;
  }
  return false;
}

function extract(): Found[] {
  const found: Found[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = relative(ROOT, path).split('\\').join('/');
    if (file === 'src/lib/messages-en.ts' || FILES_NOT_SENT[file]) continue;
    const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      // Um texto dentro de uma concatenacao e lido pelo topo dela.
      const up = outerParent(node);
      const inChain = up !== undefined && isPlus(up);
      if ((isText(node) || (isPlus(node) && hasText(node))) && !inChain) {
        const text = build(node, { next: 0 });
        // O portugues pode estar so dentro de um `${...}` (ex.: `${msg || 'sem detalhes'}`).
        const portuguese = PT.test(text) || PT.test(node.getText());
        if (
          portuguese &&
          /[A-Za-zÀ-ú]{3}/.test(text) &&
          !inLogOrImport(node) &&
          errorContext(node, file)
        ) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          found.push({ file, line, text });
        }
        // Textos dentro de `${...}` ou de uma concatenacao nao contam sozinhos.
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

const found = extract();
const dictionary = new Set(MESSAGES_EN.map(([pt]) => pt));
const exempt = new Map(NOT_SENT);

test('extrator: acha as mensagens conhecidas, inclusive as concatenadas com +', () => {
  const texts = new Set(found.map((f) => f.text));
  assert.ok(texts.has('Amostra não encontrada.'));
  assert.ok(texts.has('Rota nao encontrada.'));
  assert.ok(
    [...texts].some(
      (t) => t.startsWith('Esta conta usa a senha padrão') && t.includes('ADMIN_PASSWORD'),
    ),
    'a concatenacao de auth.ts deveria sair como um texto so',
  );
});

test('toda mensagem de erro da API tem tradução em messages-en.ts', () => {
  const missing = found.filter((f) => !dictionary.has(f.text) && !exempt.has(f.text));
  assert.deepEqual(
    missing.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`),
    [],
    'Mensagem sem par em src/lib/messages-en.ts. Inclua a tradução; se o texto não sai numa ' +
      'resposta de erro, inclua-o em NOT_SENT neste teste, com o motivo.',
  );
});

test('o dicionário não tem pares que o código não usa mais', () => {
  const used = new Set(found.map((f) => f.text));
  const unused = [...dictionary].filter((pt) => !used.has(pt));
  assert.deepEqual(unused, [], 'Par de messages-en.ts que nenhuma mensagem da API usa mais.');
});

test('as exceções ainda casam com algum texto do código', () => {
  const seen = new Set(found.map((f) => f.text));
  const stale = NOT_SENT.filter(([text]) => !seen.has(text));
  assert.deepEqual(stale, [], 'Exceção em NOT_SENT que não casa com mais nada: apague-a.');
  for (const file of Object.keys(FILES_NOT_SENT)) {
    assert.ok(statSync(join(ROOT, file), { throwIfNoEntry: false }), `${file} não existe mais`);
  }
});

test('nenhum texto do código é traduzido e isento ao mesmo tempo', () => {
  const both = NOT_SENT.filter(([text]) => dictionary.has(text));
  assert.deepEqual(both, []);
});
