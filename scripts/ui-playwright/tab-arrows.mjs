// Setas da faixa de abas (pendencias da varredura visual, item 3): quando as abas nao cabem, a seta
// aparece so do lado que tem aba escondida, rola a faixa, e a aba focada pelo teclado (ou a ativa)
// fica inteira a vista, fora de baixo da seta. Na tela larga, nenhuma seta.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const before = page.locator('.hpsm-tabstrip__arrow--before');
const after = page.locator('.hpsm-tabstrip__arrow--after');
/** A aba esta inteira dentro da faixa e fora de baixo das setas visiveis? */
const fullyShown = (name) =>
  page.evaluate((label) => {
    const bar = document.querySelector('.hpsm-tabbar').getBoundingClientRect();
    const tab = [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === label).getBoundingClientRect();
    const arrows = [...document.querySelectorAll('.hpsm-tabstrip__arrow')].map((a) => a.getBoundingClientRect());
    const covered = arrows.some((a) => tab.right > a.left && tab.left < a.right);
    return tab.left >= bar.left && tab.right <= bar.right && !covered;
  }, name);

// 1. 1024 px, primeira aba ativa: so a seta da direita.
await page.goto(ORIGIN + '/admin?tab=users', { waitUntil: 'networkidle' });
await settle();
expect('seta só do lado com aba escondida', (await after.count()) === 1 && (await before.count()) === 0);
expect('a seta é só do mouse', (await after.getAttribute('aria-hidden')) === 'true' && (await after.getAttribute('tabindex')) === '-1');

// 2. A seta rola a faixa: aparece a da esquerda.
await after.click();
await settle();
expect('clicar na seta rola a faixa', (await before.count()) === 1);
await page.screenshot({ path: `${OUT}/abas-setas.png`, clip: { x: 240, y: 130, width: 784, height: 50 } });

// 3. Teclado: a ultima aba focada fica inteira a vista.
await page.goto(ORIGIN + '/admin?tab=users', { waitUntil: 'networkidle' });
await settle();
await page.locator('[role=tab]', { hasText: 'Configurações' }).focus();
await settle();
expect('aba focada pelo teclado fica à vista', await fullyShown('Configurações'));

// 4. Aba ativa no fim da faixa: inteira, fora de baixo da seta.
await page.goto(ORIGIN + '/admin?tab=settings', { waitUntil: 'networkidle' });
await settle();
expect('aba ativa no fim fica inteira', await fullyShown('Configurações'));

// 5. Tela larga: tudo cabe, nenhuma seta.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(ORIGIN + '/admin?tab=users', { waitUntil: 'networkidle' });
await settle();
expect('1440 px: nenhuma seta', (await page.locator('.hpsm-tabstrip__arrow').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nsetas das abas: tudo ok');
process.exit(failures ? 1 : 0);
