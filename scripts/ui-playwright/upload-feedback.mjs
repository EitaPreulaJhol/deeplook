// Retorno do envio (128, 129, 130): limite real na ajuda, arquivo maior recusado
// sem chamar a API, queda de rede em portugues (o percentual esta em smoke.mjs) e as
// mensagens da API em 413 e 503. O arquivo escolhido nunca se perde.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const MB = 1024 * 1024;
const file = (name, size = 2048) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, 65) });

const open = async ({ maxUploadMb = 2, handler } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupMock(context, createState({ loggedIn: true }));
  await context.route('**/api/me/upload-quota', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ limit: null, used: 0, remaining: null, resetAt: null, maxUploadMb }) }),
  );
  const calls = [];
  if (handler) {
    await context.route('**/api/entries/file', (route) => {
      calls.push(route.request().url());
      return handler(route);
    });
  }
  const page = await context.newPage();
  watchErrors(page);
  await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
  return { context, page, calls };
};
const messages = async (page) => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const send = async (page, btn = 'Enviar arquivo') => {
  await page.click(`button:has-text("${btn}")`);
  await page.waitForTimeout(800);
};

// 1. Limite.
{
  const { context, page, calls } = await open({ handler: (r) => r.abort() });
  const help = await page.locator('.hpsm-field__help').first().innerText();
  expect('ajuda com o limite real', help.includes('com até 2 MB cada'), help);
  expect('sem o texto vago', !help.includes('conforme configurado'));
  await page.setInputFiles('input[type=file]', file('grande.exe', 3 * MB));
  await send(page);
  expect('arquivo maior: não chama a API', calls.length === 0, String(calls.length));
  expect('arquivo maior: diz qual e o limite', (await messages(page)).includes('grande.exe passa de 2 MB'), await messages(page));
  // A selecao acumula: grande.exe continua na lista.
  await page.setInputFiles('input[type=file]', [file('a.exe', 3 * MB), file('c.exe')]);
  await send(page, 'Enviar 3 arquivos');
  expect('lote: não chama a API e conta os demais', calls.length === 0 && (await messages(page)).includes('grande.exe e mais 1 passam de 2 MB'), await messages(page));
  await context.close();
}

// 2. Falhas: mensagem certa e arquivo mantido.
for (const [name, handler, expected] of [
  ['queda de rede', (r) => r.abort('connectionfailed'), 'Não foi possível falar com o servidor. Confira a sua conexão e tente de novo.'],
  ['413', (r) => r.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: 'Arquivo maior que o limite de 2 MB.' }) }), 'Arquivo maior que o limite de 2 MB.'],
  ['503', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Muitos envios ao mesmo tempo. Tente de novo em instantes.' }) }), 'Muitos envios ao mesmo tempo. Tente de novo em instantes.'],
]) {
  const { context, page } = await open({ handler });
  await page.setInputFiles('input[type=file]', file('a.exe'));
  await page.waitForTimeout(300);
  await send(page);
  expect(`${name}: mensagem`, (await messages(page)).includes(expected), await messages(page));
  expect(`${name}: arquivo mantido`, (await page.locator('body').innerText()).includes('a.exe'));
  expect(`${name}: pode tentar de novo`, await page.locator('button:has-text("Enviar arquivo")').isEnabled());
  await context.close();
}

// 3. Queda de rede fora do envio tambem em portugues.
{
  const { context, page } = await open();
  await context.route('**/api/entries/url', (r) => r.abort('connectionfailed'));
  await page.locator('[role=tab]:has-text("Link")').first().click();
  await page.fill('#url', 'http://exemplo.top/a');
  await send(page, 'Enviar link');
  expect('queda de rede no link', (await messages(page)).includes('Não foi possível falar com o servidor'), await messages(page));
  await context.close();
}

// 4. Sucesso pelo novo caminho: abre a ficha.
{
  const { context, page } = await open();
  await page.setInputFiles('input[type=file]', file('ok.exe'));
  await page.waitForTimeout(300);
  await page.click('button:has-text("Enviar arquivo")');
  await page.waitForURL(/\/entries\//, { timeout: 5000 });
  expect('envio abre a ficha', /\/entries\//.test(page.url()));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nretorno do envio: tudo ok');
process.exit(failures ? 1 : 0);
