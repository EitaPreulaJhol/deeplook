// "Sair" com alteracoes nao salvas (47): com formulario alterado o Sair pergunta
// (Continuar editando mantem tudo; Sair encerra sem perguntar de novo); sem
// alteracao, ou depois de salvar, sai direto.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const path = () => new URL(page.url()).pathname;
const dialog = page.locator('[role=alertdialog]:has-text("Alterações não salvas")');
const logouts = () => state.calls.filter((c) => c === 'POST /api/auth/logout').length;
const clickSair = async () => {
  await page.click('.hpsm-topbar__user-name');
  await page.click('[role=menuitem]:has-text("Sair")');
  await settle();
};

// 1. Formulario alterado: pergunta.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.fill('#file-description', 'Anexo recebido hoje');
await clickSair();
expect('Sair pergunta', await dialog.isVisible());
expect('texto e botões', (await dialog.innerText()).includes('Deseja sair mesmo assim e descartá-las?') &&
  (await dialog.locator('button').allInnerTexts()).map((t) => t.trim()).sort().join('|') === 'Continuar editando|Sair');

// 2. Continuar editando: nada muda.
await dialog.locator('button:has-text("Continuar editando")').click();
await settle();
expect('continua na tela, logado', path() === '/submit' && logouts() === 0 && state.loggedIn);
expect('o texto continua lá', (await page.inputValue('#file-description')) === 'Anexo recebido hoje');

// 3. Sair: encerra sem um segundo aviso.
await clickSair();
await dialog.locator('button.dl-btn--danger').click();
await page.waitForURL('**/login');
await settle();
expect('saiu', path() === '/login' && logouts() === 1);
expect('sem segundo aviso', (await dialog.count()) === 0);

// 4. Sem alteracao: sai direto.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await clickSair();
expect('sem alteração: sai sem perguntar', path() === '/login' && logouts() === 2 && (await dialog.count()) === 0);

// 5. Alteracao desfeita: tambem sai direto.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
await page.fill('#pwd-current', 'x');
await page.fill('#pwd-current', '');
await clickSair();
expect('alteração desfeita: sai sem perguntar', path() === '/login' && logouts() === 3 && (await dialog.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nsair com alterações: tudo ok');
process.exit(failures ? 1 : 0);
