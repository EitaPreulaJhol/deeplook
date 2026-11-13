// Documentacao da API (93): link na aba Tokens de API, exemplos em curl com o
// endereco do DeepLook e Copiar, rotas lidas do /api/openapi.json (metodo,
// caminho, campos de caminho/query/JSON/formulario com tipos e obrigatorios,
// respostas), baixar a especificacao, sem nada que chame a API, e aviso sem
// acesso liberado.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const state = createState({ loggedIn: true });
users[0].apiAccess = true;
await setupMock(context, state);
const spec = {
  openapi: '3.1.0',
  info: { title: 'DeepLook API', version: '1.0.0', description: 'x' },
  paths: {
    '/api/entries/file': {
      post: {
        summary: 'Enviar arquivo',
        description: 'Um arquivo por envio.',
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, tags: { type: 'string', description: 'Tags separadas por vírgula (até 20).' } }, required: ['file'] } } } },
        responses: { 201: { description: 'Amostra criada.' }, 429: { description: 'Limite de envios do dia.' } },
      },
    },
    '/api/entries': {
      get: {
        summary: 'Listar amostras',
        parameters: [
          { name: 'scope', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'mine'], default: 'all' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'number', maximum: 100, default: 25 } },
        ],
        responses: { 200: { description: 'Página de amostras.' } },
      },
    },
    '/api/entries/{id}/iocs/export': {
      get: {
        summary: 'Baixar os indicadores (CSV, STIX 2.1 ou MISP)',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Id da amostra.', schema: { type: 'string' } },
          { name: 'format', in: 'query', required: true, schema: { type: 'string', enum: ['csv', 'stix', 'misp'] } },
        ],
        responses: { 200: { description: 'Arquivo para download.' }, 404: { description: 'Amostra não encontrada.' } },
      },
    },
  },
};
let specGets = 0;
const sideEffects = [];
await context.route((url) => url.pathname === '/api/openapi.json', (route) => {
  specGets += 1;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spec) });
});
const page = await context.newPage();
watchErrors(page);
page.on('request', (r) => {
  if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/entries')) sideEffects.push(r.url());
});

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);

// 1. Link na aba Tokens de API.
await page.goto(ORIGIN + '/user?tab=tokens', { waitUntil: 'networkidle' });
await page.click('a:has-text("Documentação da API")');
await settle();
expect('abre pela aba Tokens de API', new URL(page.url()).pathname === '/user/api');
expect('título da aba de documento', (await page.locator('.hpsm-doctab__link').allInnerTexts()).some((t) => t.includes('Documentação da API')));

// 2. Exemplos em curl.
const examples = page.locator('.dl-apidoc__example');
expect('quatro exemplos', (await examples.count()) === 4);
const titles = await page.locator('.dl-apidoc__example-head strong').allInnerTexts();
expect('enviar, consultar e baixar IOCs', ['Enviar um arquivo', 'Enviar um link', 'Consultar o resultado', 'Baixar os indicadores'].every((t) => titles.some((x) => x.startsWith(t))), titles.join(' | '));
const first = await examples.first().locator('pre').innerText();
expect('curl com o endereço e o token', first.includes(`${ORIGIN}/api/entries/file`) && first.includes('Authorization: Bearer $DEEPLOOK_TOKEN') && first.includes('-F file=@'), first);
expect('baixar IOCs com o formato', (await examples.nth(3).locator('pre').innerText()).includes('/iocs/export?format=csv'));
await examples.nth(2).locator('button[aria-label^="Copiar"]').click();
await settle(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
expect('Copiar copia o exemplo', clip.startsWith('curl -H "Authorization: Bearer $DEEPLOOK_TOKEN"') && clip.includes('/api/entries/<id>'), clip);

// 3. Rotas da especificacao.
expect('lê a especificação', specGets >= 1);
const routes = page.locator('.dl-apidoc__route');
expect('uma por operação', (await routes.count()) === 3);
const upload = page.locator('[data-route="POST /api/entries/file"]');
const up = (await upload.innerText()).replace(/\s+/g, ' ');
expect('método, caminho e resumo', up.includes('POST /api/entries/file — Enviar arquivo') && up.includes('Um arquivo por envio.'), up);
expect('campos do formulário com obrigatório', up.includes('file * formulário string (arquivo)') && up.includes('tags formulário string Tags separadas por vírgula'), up);
expect('respostas', up.includes('Respostas: 201 Amostra criada. · 429 Limite de envios do dia.'), up);
const list = (await page.locator('[data-route="GET /api/entries"]').innerText()).replace(/\s+/g, ' ');
expect('query com valores e padrão', list.includes('scope query all | mine') && list.includes('limit query number (máx. 100, padrão 25)'), list);
const exp = (await page.locator('[data-route="GET /api/entries/{id}/iocs/export"]').innerText()).replace(/\s+/g, ' ');
expect('caminho e query obrigatórios', exp.includes('id * caminho string Id da amostra.') && exp.includes('format * query csv | stix | misp'), exp);
await page.screenshot({ path: `${OUT}/api-docs.png`, fullPage: true });

// 4. Baixar a especificacao; nada chama a API pela pessoa.
const dl = page.locator('a:has-text("Baixar a especificação")');
expect('baixar a especificação', (await dl.getAttribute('href')) === '/api/openapi.json?lang=pt-BR' && (await dl.getAttribute('download')) === 'deeplook-openapi.json');
expect('sem "experimentar"', (await page.locator('.dl-apidoc__route button').count()) === 0 && sideEffects.length === 0, sideEffects.join(', '));

// 5. Sem acesso liberado.
users[0].apiAccess = false;
await page.goto(ORIGIN + '/user/api', { waitUntil: 'networkidle' });
expect('aviso sem acesso', (await page.locator('.hpsm-msg__text').allInnerTexts()).some((t) => t.includes('não está liberado')));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndocumentação da API: tudo ok');
process.exit(failures ? 1 : 0);
