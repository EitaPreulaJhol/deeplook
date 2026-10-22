// Ajuda de atalhos: ? (fora de campos) e F1 (em qualquer lugar, sem a ajuda do
// navegador) abrem a caixa "Atalhos de teclado"; Esc/Fechar fecham; menu do usuario;
// Dicas da Pagina Inicial vindas da mesma lista.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const help = page.locator('[role=dialog]:has-text("Atalhos de teclado")');
const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim());
const path = () => new URL(page.url()).pathname;

// 1. Dicas da Pagina Inicial saem da lista compartilhada.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const tip = (await page.locator('.dl-welcome li:has-text("Atalhos:")').textContent()) ?? '';
expect('Dicas listam Ctrl+K e Alt+N', tip.includes('Ctrl+K ir para uma amostra') && tip.includes('Alt+N enviar amostra'), tip);
expect('Dicas indicam ? / F1', tip.includes('salvar o formulário aberto. Pressione ? / F1 para ver todos os atalhos.'));

// 2. "?" fora de campo abre a caixa, com foco em Fechar.
await page.locator('body').click({ position: { x: 900, y: 700 } });
await page.keyboard.press('?');
expect('? abre "Atalhos de teclado"', await help.isVisible());
const groups = await help.locator('.dl-shortcuts__group th').allTextContents();
expect('grupos Geral / Listas / Formulários', groups.join('|') === 'Geral|Listas|Formulários e caixas', groups.join('|'));
const rows = await help.locator('tbody th[scope=row]').allTextContents();
expect('lista traz Ctrl+S e Esc', rows.includes('Ctrl+S') && rows.includes('Esc'), rows.join(', '));
expect('foco em Fechar', (await focusedText()) === 'Fechar');
await page.screenshot({ path: `${OUT}/atalhos-ajuda.png` });

// 3. Com a caixa aberta, outros atalhos nao agem; Tab fica em Fechar; Esc fecha.
await page.keyboard.press('Alt+KeyN');
expect('Alt+N não age com a caixa aberta', path() === '/inicio');
await page.keyboard.press('Tab');
expect('Tab continua em Fechar', (await focusedText()) === 'Fechar');
await page.keyboard.press('Escape');
expect('Esc fecha', !(await help.isVisible()));

// 4. F1 abre (sem a ajuda do navegador), inclusive dentro de um campo.
await page.evaluate(() => {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') window.__f1Prevented = e.defaultPrevented;
  });
});
await page.keyboard.press('F1');
expect('F1 abre a caixa', await help.isVisible());
expect('F1 não abre a ajuda do navegador', await page.evaluate(() => window.__f1Prevented === true));
await page.click('.hpsm-modal button:has-text("Fechar")');
expect('Fechar fecha', !(await help.isVisible()));

await page.click('#dl-quick-search');
await page.keyboard.type('a?b');
expect('? dentro de campo é texto', !(await help.isVisible()) && (await page.inputValue('#dl-quick-search')) === 'a?b');
await page.keyboard.press('F1');
expect('F1 dentro de campo abre a caixa', await help.isVisible());
await page.keyboard.press('Escape');
expect('foco volta ao campo ao fechar', await page.evaluate(() => document.activeElement?.id === 'dl-quick-search'));
await page.fill('#dl-quick-search', '');

// 5. Menu do usuario > Atalhos de teclado.
await page.click('.hpsm-topbar__user-name');
await page.click('.hpsm-usermenu__item:has-text("Atalhos de teclado")');
expect('menu do usuário abre a caixa', await help.isVisible());
await page.keyboard.press('Escape');

// 6. Numa lista, ? abre a ajuda e / continua focando a busca.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('body').click({ position: { x: 900, y: 850 } });
await page.keyboard.press('?');
expect('? na lista abre a caixa', await help.isVisible());
await page.keyboard.press('Escape');
await page.keyboard.press('/');
expect('/ ainda foca a busca', await page.evaluate(() => document.activeElement?.id === 'q'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\natalhos: tudo ok');
process.exit(failures ? 1 : 0);
