// "Pegar a proxima" (52): botao nas filas (Historico/Pendentes) e na Pagina
// Inicial dos analistas; abre a ficha da amostra pega; fila vazia avisa e fica
// na tela; usuario comum nao ve o botao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.nextQueue = ['e3', 'e1'];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const path = () => new URL(page.url()).pathname + new URL(page.url()).search;
const button = () => page.locator('.hpsm-toolbar__action:has-text("Pegar a próxima")');
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim()).join(' / ');

// 1. Fila Pendentes: o botao pega e abre a ficha.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Pendentes")');
await settle();
expect('botão na fila Pendentes', (await button().count()) === 1 && (await button().getAttribute('title')).startsWith('Atribui a você'));
await page.screenshot({ path: `${OUT}/pegar-proxima.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
await button().click();
await page.waitForURL('**/entries/e3');
await settle();
expect('abre a ficha da amostra pega', path() === '/entries/e3' && state.calls.includes('POST /api/entries/next'));
expect('ficha já mostra em análise e responsável', (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ').includes('Responsável: Ana Souza'));

// 2. Pagina Inicial: o link tambem pega.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('button.dl-link-button:has-text("Pegar a próxima")');
await page.waitForURL('**/entries/e1');
expect('Página Inicial: pega e abre', path() === '/entries/e1');

// 3. Fila vazia: avisa e fica na tela.
await page.goto(ORIGIN + '/history?status=PENDING', { waitUntil: 'networkidle' });
await button().click();
await settle();
expect('fila vazia: aviso e continua na lista', path() === '/history?status=PENDING' && (await messages()).includes('Nenhuma amostra pendente sem responsável.'), await messages());

// 4. Usuario comum: sem o botao.
state.role = 'USER';
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('usuário comum: sem botão na lista', (await button().count()) === 0);
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('usuário comum: sem link na Página Inicial', (await page.locator('button.dl-link-button:has-text("Pegar a próxima")').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npegar a próxima: tudo ok');
process.exit(failures ? 1 : 0);
