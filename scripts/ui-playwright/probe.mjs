// Mede elementos de uma tela (posicao, tamanho, margens): node probe.mjs <rota> <seletor> [...]
// PROBE_SIZE=1366x768 (padrao). Ferramenta da varredura visual.
import { chromium } from 'playwright';
import { createState, ORIGIN, setupMock } from './mock-api.mjs';
const [path, ...selectors] = process.argv.slice(2);
const [w, h] = (process.env.PROBE_SIZE || '1366x768').split('x').map(Number);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: w, height: h } });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
for (const sel of selectors) {
  const rows = await page.$$eval(sel, (els) =>
    els.slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} margin ${cs.marginTop}/${cs.marginBottom} padding ${cs.paddingTop}/${cs.paddingBottom} "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
    }),
  );
  console.log(`== ${sel}\n${rows.join('\n') || '(nada)'}`);
}
await browser.close();
