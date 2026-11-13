import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { MESSAGES_EN } from '../../src/lib/messages-en';
import { openApiDocument } from '../../src/lib/openapi';
import { localizeOpenApi, OPENAPI_EN } from '../../src/lib/openapi-en';
import { scanTexts } from './source-texts';

/**
 * Especificacao OpenAPI em ingles (plano pos-revisao, item 1.4, parte 4): todo titulo, resumo e
 * descricao do lib/openapi.ts tem par em OPENAPI_EN (ou em MESSAGES_EN, para as respostas de
 * erro), e o documento traduzido nao muda caminhos, esquemas nem exemplos.
 */

const ROOT = join(__dirname, '..', '..');
const SAME = new Set(['DeepLook API']);

function texts(doc: unknown, key: string | null = null, out: string[] = []): string[] {
  if (typeof doc === 'string') {
    if (key === 'summary' || key === 'description' || key === 'title') out.push(doc);
  } else if (Array.isArray(doc)) {
    doc.forEach((item) => texts(item, null, out));
  } else if (doc && typeof doc === 'object') {
    for (const [k, v] of Object.entries(doc)) texts(v, k, out);
  }
  return out;
}

test('todo título, resumo e descrição da especificação tem tradução', () => {
  const known = new Set([...OPENAPI_EN, ...MESSAGES_EN].map(([pt]) => pt));
  const missing = [...new Set(texts(openApiDocument()))].filter(
    (t) => !known.has(t) && !SAME.has(t),
  );
  assert.deepEqual(missing, [], 'Texto da especificação sem par em src/lib/openapi-en.ts.');
});

test('openapi-en.ts não tem pares que o código não usa mais', () => {
  const used = new Set(scanTexts(join(ROOT, 'src/lib/openapi.ts'), () => true).map((f) => f.text));
  assert.deepEqual(
    OPENAPI_EN.map(([pt]) => pt).filter((pt) => !used.has(pt)),
    [],
  );
});

test('em inglês, só os textos mudam', () => {
  const doc = openApiDocument() as { paths: Record<string, unknown>; info: { title: string } };
  const en = localizeOpenApi(doc, 'en');
  assert.equal(localizeOpenApi(doc, 'pt-BR'), doc);
  assert.deepEqual(Object.keys(en.paths), Object.keys(doc.paths));
  assert.equal(en.info.title, 'DeepLook API');
  const accented = texts(en).filter((t) => /[ãõçáéíóúâêôà]/i.test(t));
  assert.deepEqual(accented, [], 'texto em português no documento em inglês');
});
