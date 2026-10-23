// "Ir para:" centralizado no masthead: rotulo e campo no centro da barra (em
// varias larguras), no meio da altura e sem encostar no logo nem no usuario.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

for (const width of [1440, 1024, 900]) {
  const context = await browser.newContext({ viewport: { width, height: 700 } });
  await setupMock(context, createState({ loggedIn: true }));
  const page = await context.newPage();
  watchErrors(page);
  await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
  const box = (sel) => page.locator(sel).boundingBox();
  const bar = await box('.hpsm-topbar');
  const qs = await box('.hpsm-quicksearch');
  const label = await box('.hpsm-quicksearch__label');
  const input = await box('#dl-quick-search');
  const brand = await box('.hpsm-topbar__brand');
  const user = await box('.hpsm-topbar__links');
  const middle = bar.y + bar.height / 2;
  expect(`${width}px: centro horizontal da barra`, Math.abs(qs.x + qs.width / 2 - (bar.x + bar.width / 2)) <= 1);
  expect(`${width}px: rótulo e campo no meio da altura`, Math.abs(label.y + label.height / 2 - middle) < 2 && Math.abs(input.y + input.height / 2 - middle) < 2);
  expect(`${width}px: não encosta no logo nem no usuário`, brand.x + brand.width < qs.x && qs.x + qs.width < user.x);
  if (width === 1440) await page.screenshot({ path: `${OUT}/busca-centralizada.png`, clip: { x: 0, y: 0, width, height: 60 } });
  await context.close();
}

// Tela estreita: o campo sai do masthead (como antes).
const narrow = await browser.newContext({ viewport: { width: 700, height: 700 } });
await setupMock(narrow, createState({ loggedIn: true }));
const p2 = await narrow.newPage();
await p2.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('tela estreita: sem o campo no masthead', !(await p2.locator('.hpsm-quicksearch').isVisible()));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nbusca centralizada: tudo ok');
process.exit(failures ? 1 : 0);
