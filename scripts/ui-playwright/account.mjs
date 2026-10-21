// Fluxo de conta: login -> Pagina Inicial -> menu do usuario -> Minha Conta ->
// preferencias aplicadas -> troca de senha (erros e sucesso) -> novo login.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: false });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const path = () => new URL(page.url()).pathname;
const messages = () => page.locator('.hpsm-msg__text').allTextContents();

// 1. Login leva a Pagina Inicial (preferencia padrao).
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
expect('login abre a Página Inicial', path() === '/inicio');

// 2. Menu do usuario: abre com foco no 1o item, setas navegam, Esc fecha.
await page.click('.hpsm-topbar__user-name');
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
expect('menu abre com foco em "Minha conta"', (await focused()) === 'Minha conta');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
expect('setas navegam até "Preferências"', (await focused()) === 'Preferências');
await page.keyboard.press('Escape');
expect(
  'Esc fecha e devolve o foco ao nome',
  (await page.locator('[role=menu]').count()) === 0 &&
    (await page.evaluate(() => document.activeElement?.classList.contains('hpsm-topbar__user-name'))),
);

// 3. Preferencias: pagina inicial = Historico e 25 registros por pagina.
await page.click('.hpsm-topbar__user-name');
await page.click('[role=menuitem]:has-text("Preferências")');
await page.selectOption('#pref-start', 'history');
await page.selectOption('#pref-pagesize', '25');
await page.click('.hpsm-toolbar__action:has-text("Salvar preferências")');
await page.waitForTimeout(500);
expect('preferências salvas', (await messages()).includes('Preferências salvas.'));
await page.screenshot({ path: `${OUT}/conta-preferencias.png` });

await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
expect('raiz abre o Histórico', path() === '/history');
expect('lista pede 25 registros', state.lastLimit === '25', `limit=${state.lastLimit}`);

// 4. Senha: atual errada, confirmacao diferente e sucesso.
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
await page.fill('#pwd-current', 'errada');
await page.fill('#pwd-new', 'nova-senha-123');
await page.fill('#pwd-confirm', 'nova-senha-123');
await page.click('.hpsm-toolbar__action:has-text("Salvar senha")');
await page.waitForTimeout(400);
expect('senha atual errada é recusada', (await messages()).includes('Senha atual incorreta.'));

await page.fill('#pwd-current', 'senha-atual');
await page.fill('#pwd-confirm', 'outra-coisa');
await page.click('.hpsm-toolbar__action:has-text("Salvar senha")');
await page.waitForTimeout(300);
expect(
  'confirmação diferente é recusada',
  (await messages()).includes('A confirmação não confere com a nova senha.'),
);

await page.fill('#pwd-confirm', 'nova-senha-123');
await page.click('.hpsm-toolbar__action:has-text("Salvar senha")');
await page.waitForURL('**/login');
await page.waitForTimeout(300);
expect(
  'troca encerra a sessão e mostra o aviso no login',
  !state.loggedIn &&
    (await messages()).includes('Senha alterada. Entre novamente com a nova senha.'),
);

// 5. Login com a senha nova vai para a pagina inicial escolhida.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'nova-senha-123');
await page.click('button[type=submit]');
await page.waitForURL('**/history');
expect('login com a senha nova abre o Histórico', path() === '/history');

await browser.close();
process.exit(failures ? 1 : 0);
