// Barra de filtros das listas: nenhuma combinacao pode deixar a tela branca
// (regressao do DataTable do Carbon com ids antigos ao trocar o filtro).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const check = async (label, expectedRows) => {
  await page.waitForTimeout(900);
  const blank = await page.evaluate(() => !document.getElementById('root').innerHTML);
  const rows = blank ? -1 : await page.locator('tbody tr').count();
  const ok = !blank && rows === expectedRows;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}: linhas=${rows} (esperado ${expectedRows})${blank ? ' TELA BRANCA' : ''}`);
};

await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await check('inicial', 4);
await page.selectOption('#status', 'COMPLETED');
await check('status = Concluído', 2);
await page.fill('#q', 'driver');
await check('busca "driver"', 1);
await page.selectOption('#type', 'URL');
await check('tipo = Link (zera a lista)', 0);
await page.click('.hpsm-filterbar button:has-text("Limpar")');
await check('Limpar', 4);
await page.selectOption('#verdict', 'MALICIOUS');
await check('veredito = Malicioso', 1);
await page.screenshot({ path: `${OUT}/filtros.png` });

await page.goto(ORIGIN + '/me', { waitUntil: 'networkidle' });
await page.fill('#q', 'abc');
await check('Meus Uploads com busca', 0);

await browser.close();
process.exit(failures ? 1 : 0);
