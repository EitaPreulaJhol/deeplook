// Mede a largura que a tabela de amostras precisa (com e sem as colunas secundarias).
import { chromium } from 'playwright';
import { createState, ORIGIN, setupMock } from './mock-api.mjs';
const browser = await chromium.launch();
for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await setupMock(context, createState({ loggedIn: true }));
  const page = await context.newPage();
  await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => {
    const box = document.querySelector('.dl-entries .cds--data-table-content');
    const table = box.querySelector('table');
    const cols = [...table.querySelectorAll('thead th')].map((th) => `${th.innerText.trim() || '☐'}:${Math.round(th.getBoundingClientRect().width)}`);
    return { container: box.clientWidth, table: table.scrollWidth, cols: cols.join(' ') };
  });
  console.log(`${w}x${h} container ${m.container} tabela ${m.table} | ${m.cols}`);
  await context.close();
}
await browser.close();
