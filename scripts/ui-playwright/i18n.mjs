// Idioma da interface (revisao de novembro, 2.5): seletor nas paginas publicas (guardado nesta
// maquina), preferencia da conta (vale ao entrar), troca na hora em Preferencias e volta ao
// portugues. Por enquanto so a moldura (menu, barra superior, login, preferencias, rotulos) traduz.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: false });
const browser = await chromium.launch();
// Navegador em ingles de proposito: sem escolha, a interface continua em portugues.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const leaves = () => page.locator('.hpsm-tree__label').allInnerTexts();

// 1. Navegador em ingles, sem escolha: portugues.
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
expect('sem escolha: português, mesmo com o navegador em inglês', (await page.locator('button[type=submit]').innerText()) === 'Entrar');
expect('html lang em português', (await page.evaluate(() => document.documentElement.lang)) !== 'en');

// 2. Seletor da pagina publica: ingles na hora, e lembra ao recarregar.
await page.selectOption('.dl-lang select', 'en');
expect('login em inglês', (await page.locator('button[type=submit]').innerText()) === 'Sign in' && (await page.locator('label[for=password]').innerText()).includes('Password'));
await page.reload({ waitUntil: 'networkidle' });
expect('lembra nesta máquina', (await page.locator('button[type=submit]').innerText()) === 'Sign in');
await page.screenshot({ path: `${OUT}/login-en.png` });

// 3. Entrar: a preferencia da conta (portugues) vale sobre a escolha desta maquina.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await page.waitForTimeout(300);
expect('logado: vale a preferência da conta (português)', (await leaves()).includes('Página Inicial'), (await leaves()).slice(0, 3).join(' | '));

// 4. Preferencias: escolhe ingles e salva; menu, papel e rotulos mudam na hora.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-language', 'en');
await page.click('.hpsm-toolbar__action:has-text("Salvar preferências")');
await page.waitForTimeout(500);
expect('preferência gravada na conta', state.preferences.language === 'en', JSON.stringify(state.preferences));
const labels = await leaves();
expect('menu em inglês', labels.includes('Home') && labels.includes('Global history') && labels.includes('Submit sample'), labels.join(' | '));
expect('mensagem de salvo no idioma novo', (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' ').includes('Preferences saved.'));
// O usuario do mock e administrador ("Admin" nos dois idiomas): o papel muda com o analista.
state.role = 'ANALYST';
await page.reload({ waitUntil: 'networkidle' });
expect('papel na barra superior em inglês', (await page.locator('.hpsm-topbar__role').innerText()).includes('Analyst'), await page.locator('.hpsm-topbar__role').innerText());
state.role = undefined;
await page.reload({ waitUntil: 'networkidle' });
await page.click('.hpsm-topbar__user-name');
const menu = (await page.locator('.hpsm-usermenu__item').allInnerTexts()).map((s) => s.trim());
expect('menu do usuário em inglês', menu.join('|') === 'My account|Change password|Preferences|Keyboard shortcuts|Sign out', menu.join('|'));
await page.keyboard.press('Escape');
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
const statuses = await page.locator('.hpsm-status').allInnerTexts();
expect('rótulos de status e veredito nas listas', statuses.some((s) => ['Pending', 'In review', 'Completed'].includes(s.trim())) && statuses.some((s) => ['Malicious', 'Suspicious', 'Clean', 'Unknown'].includes(s.trim())), statuses.slice(0, 6).join(' | '));
await page.screenshot({ path: `${OUT}/historico-en.png` });

// 5. De volta ao portugues.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-language', 'pt-BR');
await page.click('.hpsm-toolbar__action:has-text("Save preferences")');
await page.waitForTimeout(500);
expect('volta ao português', (await leaves()).includes('Página Inicial') && state.preferences.language === 'pt-BR');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nidioma: tudo ok');
process.exit(failures ? 1 : 0);
