// Navegacao (131, 132, 133): titulo da aba do navegador, "Pular para o conteudo" no
// primeiro Tab e menu no celular com estado, foco e Esc.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const open = async (width, loggedIn = true) => {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await setupMock(context, createState({ loggedIn }));
  const page = await context.newPage();
  watchErrors(page);
  return { context, page };
};
const focused = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    return { id: e.id, tag: e.tagName, text: (e.textContent || '').trim().slice(0, 40), inSidebar: !!e.closest('#dl-sidebar') };
  });

// 1. Titulo da aba.
{
  const { context, page } = await open(1440);
  await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
  expect('título com a tela', (await page.title()) === 'Histórico Global · DeepLook', await page.title());
  await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
  expect('título com a amostra', (await page.title()) === `${entries[0].title} · DeepLook`, await page.title());
  await page.locator('.hpsm-tree__leaf:has-text("Meus Uploads")').first().click();
  await page.waitForTimeout(300);
  expect('título acompanha a navegação', (await page.title()) === 'Meus Uploads · DeepLook', await page.title());
  await context.close();
}
{
  const { context, page } = await open(1440, false);
  await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
  expect('sem sessão: só DeepLook', (await page.title()) === 'DeepLook', await page.title());
  await context.close();
}

// 2. Pular para o conteudo.
{
  const { context, page } = await open(1440);
  await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
  const skip = page.locator('.dl-skip');
  const hiddenBox = await skip.boundingBox();
  expect('escondido sem foco', hiddenBox.y + hiddenBox.height <= 0, JSON.stringify(hiddenBox));
  await page.keyboard.press('Tab');
  const first = await focused(page);
  expect('primeiro Tab', first.text === 'Pular para o conteúdo', JSON.stringify(first));
  const box = await skip.boundingBox();
  expect('aparece com o foco', box.y >= 0);
  await page.screenshot({ path: `${OUT}/pular-conteudo.png` });
  await page.keyboard.press('Enter');
  expect('leva ao conteúdo', (await focused(page)).id === 'dl-conteudo');
  expect('não muda o endereço', new URL(page.url()).hash === '' && new URL(page.url()).pathname === '/history');
  let tabs = 0;
  for (; tabs < 40; tabs++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => !!document.activeElement.closest('tbody'))) break;
  }
  // Filtros e cabecalhos de ordenacao vem antes; sem o link eram mais de 70.
  expect('chega à lista em menos Tabs', tabs < 30, `${tabs + 1} Tabs`);
  await context.close();
}

// 3. Menu no celular.
{
  const { context, page } = await open(390);
  await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
  const toggle = page.locator('.hpsm-menu-toggle');
  expect('botão diz que está fechado', (await toggle.getAttribute('aria-expanded')) === 'false' && (await toggle.getAttribute('aria-label')) === 'Abrir navegação');
  let reached = false;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    if ((await focused(page)).inSidebar) reached = true;
  }
  expect('fechado: links não recebem foco', !reached);
  await toggle.click();
  await page.waitForTimeout(300);
  expect('botão diz que está aberto', (await toggle.getAttribute('aria-expanded')) === 'true' && (await toggle.getAttribute('aria-label')) === 'Fechar navegação');
  expect('o foco entra no menu', (await focused(page)).inSidebar);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect('Esc fecha', !(await page.locator('#dl-sidebar').evaluate((el) => el.classList.contains('is-open'))));
  expect('o foco volta ao botão', (await page.evaluate(() => document.activeElement.classList.contains('hpsm-menu-toggle'))));
  await toggle.click();
  await page.waitForTimeout(300);
  await page.locator('#dl-sidebar .hpsm-tree__leaf:has-text("Meus Uploads")').first().click();
  await page.waitForTimeout(300);
  expect('navegar fecha o menu', !(await page.locator('#dl-sidebar').evaluate((el) => el.classList.contains('is-open'))));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nnavegação: tudo ok');
process.exit(failures ? 1 : 0);
