// Botoes de copiar (SHA-256, IOCs) e grade navegavel pelo teclado.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

// 1. Copiar o SHA-256 na ficha da amostra.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const sha = (await page.locator('.hpsm-readonly--copyable .hpsm-readonly__text').first().textContent()).trim();
await page.click('button[aria-label="Copiar SHA-256"]');
await page.waitForTimeout(200);
expect('SHA-256 vai para a área de transferência', (await clipboard()) === sha, sha.slice(0, 16));
expect(
  'botão confirma "Copiado"',
  (await page.locator('button[aria-label="Copiar SHA-256"] .hpsm-copy__status').textContent()) === 'Copiado',
);
await page.screenshot({ path: `${OUT}/copiar-sha256.png` });

// 2. Copiar os IOCs de um relatorio (texto de varias linhas).
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.click('button[aria-label="Copiar IOCs"]');
await page.waitForTimeout(200);
expect('IOCs copiados com as quebras de linha', (await clipboard()) === 'updater-cdn.example\n185.0.2.10');

// 3. Grade: uma linha no Tab, setas/Home/End movem, Enter abre.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('só uma linha entra no Tab', (await page.locator('tbody tr[tabindex="0"]').count()) === 1);
await page.locator('tbody tr').first().focus();
const focusedRow = () =>
  page.evaluate(() => [...document.querySelectorAll('tbody tr')].indexOf(document.activeElement));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
expect('↓↓ vai para a 3ª linha', (await focusedRow()) === 2);
await page.screenshot({ path: `${OUT}/grade-foco.png` });
await page.keyboard.press('End');
expect('End vai para a última linha', (await focusedRow()) === 3);
await page.keyboard.press('Home');
expect('Home volta para a 1ª linha', (await focusedRow()) === 0);
await page.keyboard.press('ArrowUp');
expect('↑ na 1ª linha não sai da grade', (await focusedRow()) === 0);
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.waitForURL('**/entries/e4');
expect('Enter abre a amostra da linha', new URL(page.url()).pathname === '/entries/e4');

await browser.close();
process.exit(failures ? 1 : 0);
