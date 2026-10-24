// "Ir para…" do masthead: Ctrl+K, SHA-256 abre a amostra, hash sem amostra abre a
// ficha do indicador, texto abre a lista filtrada.
import { createHash } from 'node:crypto';

import { chromium } from 'playwright';

import { createState, DUPLICATE_SAMPLE, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
const input = page.locator('#dl-quick-search');

await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('campo "Ir para" no masthead', await input.isVisible());

// 1. Ctrl+K foca o campo.
await page.locator('.dl-page-head').click();
await page.keyboard.press('Control+KeyK');
expect('Ctrl+K foca o "Ir para"', await page.evaluate(() => document.activeElement?.id === 'dl-quick-search'));
await page.screenshot({ path: `${OUT}/ir-para.png`, clip: { x: 0, y: 0, width: 1440, height: 60 } });

// 2. SHA-256 de uma amostra unica abre a ficha direto.
const sha = createHash('sha256').update(DUPLICATE_SAMPLE).digest('hex');
await input.fill(sha.toUpperCase());
await input.press('Enter');
await page.waitForURL('**/entries/e1');
expect('SHA-256 abre a amostra', url() === '/entries/e1', url());
expect('campo é limpo depois de ir', (await input.inputValue()) === '');

// 3. SHA-256 sem amostra abre a ficha do indicador (31).
const unknown = 'f'.repeat(64);
await input.fill(unknown);
await input.press('Enter');
await page.waitForURL('**/iocs/**');
expect('hash desconhecido abre a ficha do indicador', url() === `/iocs/sha256/${unknown}`, url());

// 4. Texto livre abre a Busca (68) com o termo.
await input.fill('driver');
await input.press('Enter');
await page.waitForTimeout(800);
expect('texto abre a Busca com ?q=', url() === '/busca?q=driver', url());
expect('campo da Busca preenchido', (await page.inputValue('#search-q')) === 'driver');
expect('amostra encontrada', (await page.locator('.dl-search-list li').count()) === 1);

await browser.close();
process.exit(failures ? 1 : 0);
