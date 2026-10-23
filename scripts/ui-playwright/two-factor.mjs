// 2FA opcional (50): aba 2FA em Minha Conta (desativado, ativar com QR e chave,
// codigo errado no campo, codigos de recuperacao uma vez com Copiar/Baixar),
// login em duas etapas (codigo errado, Voltar, codigo certo, codigo de
// recuperacao leva a aba com aviso), gerar novos codigos e desativar (senha +
// codigo, confirmacao) e o "Desativar 2FA" do admin.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const state = createState({ loggedIn: true });
users[1].twoFactorEnabledAt = '2026-10-01T10:00:00.000Z';
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ');
const situation = () => text('.hpsm-field:has(.hpsm-field__label:text-is("Situação:")) .hpsm-readonly');
const login = async () => {
  await page.fill('#email', 'ana@deeplook.test');
  await page.fill('#password', 'senha-atual');
  await page.click('button[type=submit]');
  await settle(600);
};

// 1. Aba 2FA: desativado.
await page.goto(ORIGIN + '/user?tab=2fa', { waitUntil: 'networkidle' });
expect('aba 2FA na Minha Conta', (await page.locator('[role=tab][aria-selected=true]').innerText()).trim() === '2FA');
expect('desativado por padrão', (await situation()) === 'Desativado');

// 2. Ativar.
await page.click('button:has-text("Ativar 2FA")');
await settle();
expect('QR code', await page.locator('img.dl-2fa__qr').isVisible() && (await page.locator('img.dl-2fa__qr').getAttribute('src')).startsWith('data:image/svg+xml'));
expect('chave em grupos de 4', (await text('.hpsm-field:has(.hpsm-field__label:text-is("ou digite a chave:")) .hpsm-readonly')).startsWith('JBSW Y3DP EHPK 3PXP'));
await page.screenshot({ path: `${OUT}/2fa-ativar.png`, fullPage: true });
await page.fill('#tfa-code', '12');
await page.click('button:has-text("Confirmar e ativar")');
await settle();
expect('código incompleto: campo destacado', (await page.locator('.hpsm-field:has(#tfa-code)').getAttribute('class')).includes('invalid'));
await page.fill('#tfa-code', '999999');
await page.keyboard.press('Enter');
await settle();
expect('código errado: erro da API no campo', (await messages()).includes('código inválido'), await messages());
await page.fill('#tfa-code', '123456');
await page.click('button:has-text("Confirmar e ativar")');
await settle();
expect('ativado', (await situation()).startsWith('Ativo desde') && (await messages()).includes('2FA ativado'));
expect('sem aviso de validação depois de ativar', !(await messages()).includes('Preencha'), await messages());
expect('10 códigos de recuperação', (await page.locator('.dl-2fa__codes li').count()) === 10 && (await text('.dl-2fa__codes li')) === 'k7tm-q2x0');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Baixar (.txt)")')]);
expect('baixar os códigos', download.suggestedFilename() === 'deeplook-codigos-de-recuperacao.txt');
await page.screenshot({ path: `${OUT}/2fa-codigos.png`, fullPage: true });
await page.click('button:has-text("Guardei os códigos")');
expect('códigos somem depois', (await page.locator('.dl-2fa__codes').count()) === 0);
expect('restantes', (await text('.hpsm-field:has(.hpsm-field__label:text-is("Recuperação:")) .hpsm-readonly')) === '10 código(s) de recuperação restante(s)');

// 3. Login em duas etapas.
await page.click('.hpsm-topbar__user-name');
await page.click('[role=menuitem]:has-text("Sair")');
await page.waitForURL('**/login');
await login();
expect('pede o código', (await text('#dl-auth-title')) === 'Verificação em duas etapas' && !state.loggedIn);
await page.screenshot({ path: `${OUT}/2fa-login.png`, fullPage: true });
await page.fill('#tfa-login-code', '000000');
await page.click('button:has-text("Verificar")');
await settle();
expect('código errado', (await messages()).includes('Código inválido.') && !state.loggedIn);
await page.click('.dl-auth__actions a:has-text("Voltar")');
expect('Voltar volta à senha', (await text('#dl-auth-title')) === 'Entrar' && (await page.inputValue('#password')) === '');
await login();
await page.fill('#tfa-login-code', '123456');
await page.click('button:has-text("Verificar")');
await page.waitForURL('**/inicio');
expect('código certo entra', state.loggedIn && state.twoFactorCalls.at(-1)?.challenge === 'desafio-1');

// 4. Codigo de recuperacao: entra e vai para a aba 2FA com aviso.
await page.click('.hpsm-topbar__user-name');
await page.click('[role=menuitem]:has-text("Sair")');
await page.waitForURL('**/login');
await login();
await page.fill('#tfa-login-code', 'abcd-efgh');
await page.click('button:has-text("Verificar")');
await page.waitForURL('**/user?tab=2fa');
await settle();
expect('recuperação: aviso com os restantes', (await messages()).includes('Você entrou com um código de recuperação. Restam 9.'), await messages());

// 5. Gerar novos codigos e desativar.
await page.click('button.dl-btn:text-is("Gerar novos códigos")');
await settle();
expect('pede senha e código', (await messages()).includes('Senha atual') && (await messages()).includes('Código'), await messages());
await page.fill('#tfa-password', 'errada');
await page.fill('#tfa-confirm-code', '123456');
await page.click('button.dl-btn:text-is("Gerar novos códigos")');
await settle();
expect('senha errada no campo', (await page.locator('.hpsm-field:has(#tfa-password)').getAttribute('class')).includes('invalid'));
await page.fill('#tfa-password', 'senha-atual');
await page.click('button.dl-btn:text-is("Gerar novos códigos")');
await settle();
expect('novos códigos', (await text('.dl-2fa__codes li')) === 'zz99-q2x0' && (await page.inputValue('#tfa-password')) === '');
await page.click('button:has-text("Guardei os códigos")');
await page.fill('#tfa-password', 'senha-atual');
await page.fill('#tfa-confirm-code', '123456');
await page.click('button:has-text("Desativar 2FA")');
const dialog = page.locator('[role=alertdialog]:has-text("Desativar 2FA")');
expect('desativar pede confirmação', (await dialog.innerText()).includes('volta a pedir só a senha'));
await dialog.locator('button.dl-btn--danger').click();
await settle();
expect('desativado', (await situation()) === 'Desativado' && users[0].twoFactorEnabled === false);
expect('sem aviso de validação depois de desativar', !(await messages()).includes('Preencha'), await messages());

// 6. Admin.
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
const bruno = page.locator('tbody tr:has-text("Bruno Lima")');
expect('coluna 2FA', (await page.locator('thead th').allInnerTexts()).map((t) => t.trim()).includes('2FA') && (await bruno.locator('td').nth(5).innerText()).trim() === 'Ativo');
await bruno.locator('button:has-text("Desativar 2FA")').click();
await page.locator('[role=alertdialog] button.dl-btn--danger').click();
await settle();
expect('admin desativa', state.calls.includes('POST /api/admin/users/u2/disable-2fa') && (await bruno.locator('td').nth(5).innerText()).trim() === '—');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\n2FA: tudo ok');
process.exit(failures ? 1 : 0);
