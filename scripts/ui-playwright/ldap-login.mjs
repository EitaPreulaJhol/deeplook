// Login pelo AD/LDAP (94): sem AD, a tela continua igual (campo de e-mail);
// com AD, o campo aceita o usuario da rede e explica; conta do AD sem a troca
// de senha em Minha Conta; na Administracao, marcacao "AD" e sem redefinir.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: false });
await setupMock(context, state);
const logins = [];
context.on('request', (r) => {
  if (new URL(r.url()).pathname === '/api/auth/login') logins.push(JSON.parse(r.postData() ?? '{}'));
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const field = page.locator('#email');
const labelOf = async () => (await page.locator('label[for="email"]').innerText()).trim();

// 1. Sem AD: igual a antes.
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
expect('sem AD: campo de e-mail', (await labelOf()).startsWith('E-mail') && !(await labelOf()).includes('rede') && (await field.getAttribute('type')) === 'email');
expect('sem AD: sem explicação', (await page.locator('.dl-auth__hint').count()) === 0);

// 2. Com AD: usuario da rede.
state.ldap = true;
await page.reload({ waitUntil: 'networkidle' });
expect('com AD: e-mail ou usuário da rede', (await labelOf()).includes('E-mail ou usuário da rede') && (await field.getAttribute('type')) === 'text' && (await field.getAttribute('autocomplete')) === 'username');
expect('com AD: explicação', (await page.locator('.dl-auth__hint').innerText()).includes('usuário e a senha da rede'));
await page.screenshot({ path: `${OUT}/ldap-login.png` });
await field.fill('jsilva');
await page.fill('#password', state.password);
await page.click('button[type=submit]');
await settle(600);
expect('envia o usuário da rede', logins.at(-1)?.email === 'jsilva', JSON.stringify(logins.at(-1)));
expect('entra', !new URL(page.url()).pathname.startsWith('/login'), page.url());

// 3. Conta do AD: sem trocar a senha aqui.
users[0].ldap = true;
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
const bar = (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
expect('aba Senha explica o AD', bar.includes('Sua conta é da rede (AD)') && (await page.locator('input[type=password]').count()) === 0, bar);
users[0].ldap = false;

// 4. Administracao: marcacao "AD" e sem redefinir a senha.
users[1].authSource = 'LDAP';
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
const row = page.locator('tbody tr', { hasText: users[1].displayName }).first();
expect('marcação AD', (await row.locator('.dl-dup-tag').innerText()).trim() === 'AD');
await row.locator('button[aria-haspopup="menu"]').click();
const reset = page.locator('.hpsm-ctxmenu [role=menuitem]', { hasText: 'Redefinir senha' });
// A dica fica no involucro do item (botao desativado nao mostra title em todo navegador).
expect('sem redefinir a senha do AD', (await reset.isDisabled()) && (await reset.locator('xpath=..').getAttribute('title')) === 'Conta do AD: a senha é redefinida no AD');
await page.keyboard.press('Escape');
expect('papel do AD não se edita na tela', await row.locator('select').first().isDisabled());
const other = page.locator('tbody tr', { hasText: users[2].displayName }).first();
expect('conta local sem marcação', (await other.locator('.dl-dup-tag').count()) === 0);
expect('papel da conta local se edita', !(await other.locator('select').first().isDisabled()));
users[1].authSource = undefined;

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nlogin pelo AD: tudo ok');
process.exit(failures ? 1 : 0);
