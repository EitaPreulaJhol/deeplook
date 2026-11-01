// Nome longo e tela estreita (125, 126, 127): nome de 200 caracteres sem espaco nao
// empurra as colunas nem a ficha; em 390 px nenhuma tela rola de lado; a faixa de
// abas rola sozinha e mantem a ativa a vista, sem mexer na rolagem da pagina.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const open = async (width, role = 'ADMIN') => {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const state = createState({ loggedIn: true });
  state.role = role;
  await setupMock(context, state);
  const page = await context.newPage();
  watchErrors(page);
  return { context, page };
};
const sideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// 1. Telas estreitas: nada rola de lado, com nomes normais.
const NARROW = {
  ADMIN: ['/inicio', '/user', '/history', '/me', '/submit', '/entries/e1', '/entries/e1?tab=analise', '/entries/e1?tab=historico', '/inbox', '/casos', '/kb', '/painel', '/gerencial', '/regras-triagem', '/yara', '/admin?tab=users', '/admin?tab=audit', '/admin?tab=backup'],
  USER: ['/inicio', '/user', '/history', '/me', '/submit', '/entries/e1', '/inbox', '/kb', '/painel'],
};
for (const [role, routes] of Object.entries(NARROW)) {
  const { context, page } = await open(390, role);
  for (const route of routes) {
    await page.goto(ORIGIN + route, { waitUntil: 'networkidle' });
    const extra = await sideScroll(page);
    expect(`${role} em 390 px sem rolar de lado: ${route}`, extra <= 0, `${extra} px`);
  }
  await context.close();
}

// 2. A aba ativa aparece, e trocar de aba nao mexe na rolagem da pagina.
{
  const { context, page } = await open(390);
  await page.goto(ORIGIN + '/admin?tab=backup', { waitUntil: 'networkidle' });
  const inView = () =>
    page.evaluate(() => {
      const bar = document.querySelector('.hpsm-tabbar').getBoundingClientRect();
      const tab = document.querySelector('.hpsm-tabbar .is-active').getBoundingClientRect();
      return tab.left >= bar.left - 1 && tab.right <= bar.right + 1;
    });
  expect('aba ativa à vista ao abrir no fim da faixa', await inView());
  await page.evaluate(() => window.scrollTo(0, 60));
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('.hpsm-tabbar .hpsm-tab').first().click();
  await page.waitForTimeout(200);
  expect('aba ativa à vista ao voltar ao começo', await inView());
  expect('a página não rola junto', (await page.evaluate(() => window.scrollY)) <= before);
  await page.screenshot({ path: `${OUT}/celular-abas.png` });
  await context.close();
}
{
  const { context, page } = await open(1024);
  await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
  for (const name of ['Painel', 'Busca', 'Base de conhecimento', 'Regras YARA', 'Indicadores permitidos', 'Regras de triagem', 'Domínios da empresa', 'Relatório gerencial', 'Atribuição automática', 'Avisos gerais', 'Histórico Global', 'Meus Uploads']) {
    await page.locator(`.hpsm-tree__leaf:has-text("${name}")`).first().click();
    await page.waitForTimeout(80);
  }
  const shown = await page.evaluate(() => {
    const bar = document.querySelector('.hpsm-doctabs').getBoundingClientRect();
    const tab = document.querySelector('.hpsm-doctab.is-active').getBoundingClientRect();
    return tab.right <= bar.right + 1 && tab.left >= bar.left - 1;
  });
  expect('muitas abas: a ativa inteira à vista', shown);
  await context.close();
}

// 3. Nome de 200 caracteres sem espaco.
const LONG = `fatura_${'x'.repeat(189)}.exe`;
const URL_LONG = `http://login.empresa.com.br.secure-verify.top/${'a1b2c3'.repeat(26)}`;
entries[0].title = LONG;
entries[0].originalFilename = LONG;
entries[1].title = URL_LONG;
entries[1].url = URL_LONG;
{
  const { context, page } = await open(1440);
  await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
  expect('lista não rola de lado', (await sideScroll(page)) <= 0);
  const columns = await page.evaluate(() => {
    const row = document.querySelector('tbody tr').getBoundingClientRect();
    const last = document.querySelector('thead th:last-child').getBoundingClientRect();
    const text = document.querySelector('.dl-cell-text');
    return { rowH: row.height, right: last.right, width: innerWidth, full: text.title, lineH: parseFloat(getComputedStyle(text).lineHeight) };
  });
  expect('todas as colunas à vista', columns.right <= columns.width, JSON.stringify(columns));
  expect('no máximo duas linhas', columns.rowH <= columns.lineH * 2 + 20, JSON.stringify(columns));
  expect('nome inteiro ao passar o mouse', columns.full === LONG);
  await page.screenshot({ path: `${OUT}/nome-longo-lista.png` });

  await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
  expect('ficha não rola de lado', (await sideScroll(page)) <= 0);
  const head = await page.locator('h1').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { right: b.right, width: innerWidth, text: el.textContent };
  });
  expect('título inteiro, em várias linhas', head.right <= head.width && head.text === LONG, JSON.stringify(head.right));
  await page.screenshot({ path: `${OUT}/nome-longo-ficha.png` });

  await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
  expect('link longo não rola de lado', (await sideScroll(page)) <= 0);
  await context.close();
}
{
  const { context, page } = await open(390, 'USER');
  for (const route of ['/history', '/me', '/entries/e1', '/entries/e2']) {
    await page.goto(ORIGIN + route, { waitUntil: 'networkidle' });
    expect(`nome longo em 390 px: ${route}`, (await sideScroll(page)) <= 0);
  }
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nnome longo e tela estreita: tudo ok');
process.exit(failures ? 1 : 0);
