// Ficha de URL (166): o link colado no "Ir para:" vai no corpo (resolve) e a ficha abre
// pela chave, sem o link no endereco; a ficha mostra o link e o host; seguir e deixar
// de seguir pela chave; a lista de Indicadores da Minha Conta abre a mesma ficha.
import { createHash } from 'node:crypto';

import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const LINK = 'https://golpe.top/Entrar?token=SEGREDO-166';
const KEY = createHash('sha256').update(LINK).digest('hex');
const requested = [];
page.on('request', (r) => requested.push(r.url()));

await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const input = page.locator('#dl-quick-search');
await input.fill(`${LINK}#vitima@empresa.com`);
await input.press('Enter');
await page.waitForURL(`**/iocs/url/${KEY}`);
await settle();
expect('abre a ficha pela chave', new URL(page.url()).pathname === `/iocs/url/${KEY}`);
expect('o link não vai na query de nenhum pedido', !requested.some((u) => u.includes('SEGREDO-166')));
expect('resolve no corpo', state.calls.includes('POST /api/iocs/resolve'));
expect('título com o link', (await page.locator('.dl-page-head').innerText()).includes(LINK));
const hostLink = page.locator('.dl-summary a:has-text("golpe.top")');
expect('link para o host', (await hostLink.getAttribute('href')) === '/iocs/domain/golpe.top');
await page.screenshot({ path: `${OUT}/ioc-url.png`, fullPage: true });

await page.locator('.hpsm-toolbar__action:has-text("Seguir")').click();
await settle();
expect('seguir pela chave', state.calls.includes(`POST /api/iocs/url/${KEY}/watch`) && Boolean(state.watches[`URL:${LINK}`]));

await page.goto(ORIGIN + '/user?tab=indicadores', { waitUntil: 'networkidle' });
const row = page.locator('a.dl-mono', { hasText: 'golpe.top/Entrar' });
expect('Minha Conta lista a URL seguida', (await row.getAttribute('href')) === `/iocs/url/${KEY}`);
await page.locator('button:has-text("Deixar de seguir")').first().click();
await settle();
expect('deixar de seguir pela chave', state.calls.includes(`DELETE /api/iocs/url/${KEY}/watch`) && !state.watches[`URL:${LINK}`]);

await page.goto(ORIGIN + `/iocs/url/${'0'.repeat(64)}`, { waitUntil: 'networkidle' });
expect('chave desconhecida explica', (await page.locator('.hpsm-msg__text').innerText()).includes('não encontrado'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nficha de URL: tudo ok');
process.exit(failures ? 1 : 0);
