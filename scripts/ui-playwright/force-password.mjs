// Troca obrigatoria de senha (48): login com a senha redefinida pelo admin abre
// so a tela "Definir nova senha" (sem o shell, sem outras chamadas a API),
// validacoes, senha igual a temporaria recusada, troca entra direto; depois de
// recarregar pede a temporaria; Sair; pendencia na aba Usuarios.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: false });
// Temporaria dentro da politica de senha (item 51), para testar "igual a temporaria".
state.password = 'temp-1234!';
users[0].mustChangePassword = true;
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const title = () => page.locator('#dl-auth-title').innerText();
const error = async () => (await page.locator('.hpsm-msg__text').allTextContents()).join(' / ');
const apiCalls = [];
page.on('request', (r) => {
  const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/')) apiCalls.push(`${r.method()} ${p}`);
});

// 1. Login com a senha temporaria.
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'temp-1234!');
await page.click('button[type=submit]');
await settle(800);
expect('abre "Definir nova senha"', (await title()) === 'Definir nova senha');
expect('sem o shell', (await page.locator('.hpsm-tree').count()) === 0);
expect('sem "Voltar para o início"', (await page.locator('.dl-public__link:has-text("Voltar para o início")').count()) === 0);
expect('explica o motivo', (await page.locator('.dl-auth__subtitle').innerText()).includes('primeiro acesso ou senha redefinida por um administrador'));
expect('temporária já veio do login (sem pedir de novo)', (await page.locator('#force-current').count()) === 0);
const others = () => apiCalls.filter((c) => !/\/api\/auth\/|\/api\/me\/password/.test(c));
expect('nenhuma outra chamada à API', others().length === 0, others().join(', '));
await page.screenshot({ path: `${OUT}/troca-obrigatoria.png`, fullPage: true });

// 2. Outra rota continua na troca.
await page.evaluate(() => window.history.pushState({}, '', '/history'));
await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
await settle();
expect('outra rota: continua na troca', (await title()) === 'Definir nova senha');

// 3. Validacoes.
await page.fill('#force-new', 'curta');
await page.fill('#force-confirm', 'curta');
await page.click('button[type=submit]');
await settle();
expect('mínimo de 8', (await error()).includes('Nova senha: mínimo de 8 caracteres.') && (await page.locator('.dl-field:has(#force-new)').getAttribute('class')).includes('invalid'));
await page.fill('#force-new', 'nova-senha-123');
await page.fill('#force-confirm', 'outra-coisa');
await page.click('button[type=submit]');
await settle();
expect('confirmação diferente', (await error()).includes('igual à nova senha'));
await page.fill('#force-new', 'temp-1234!');
await page.fill('#force-confirm', 'temp-1234!');
await page.click('button[type=submit]');
await settle();
expect('igual à temporária: recusada pela API', (await error()).includes('A nova senha deve ser diferente da atual.'), await error());

// 4. Troca valida: entra direto.
await page.fill('#force-new', 'nova-senha-123');
await page.fill('#force-confirm', 'nova-senha-123');
await page.click('button[type=submit]');
await page.waitForSelector('.hpsm-tree', { timeout: 8000 });
expect('enviou a temporária do login', state.lastPasswordBody?.currentPassword === 'temp-1234!' && state.lastPasswordBody?.newPassword === 'nova-senha-123');
expect('entrou com o shell', new URL(page.url()).pathname === '/inicio' && users[0].mustChangePassword === false && state.loggedIn);

// 5. Recarregada no meio da troca: pede a temporaria.
users[0].mustChangePassword = true;
await page.reload({ waitUntil: 'networkidle' });
expect('após recarregar: pede a temporária', (await title()) === 'Definir nova senha' && (await page.locator('#force-current').count()) === 1);

// 6. Sair.
await page.click('.dl-auth__actions a:has-text("Sair")');
await page.waitForURL('**/login');
expect('Sair volta ao login', !state.loggedIn);

// 7. Pendencia na aba Usuarios.
users[0].mustChangePassword = false;
users[2].mustChangePassword = true;
state.password = 'nova-senha-123';
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'nova-senha-123');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
const carla = (await page.locator('tbody tr:has-text("Carla Dias") td').nth(3).innerText()).replace(/\s+/g, ' ').trim();
expect('Usuários: troca de senha pendente', carla === 'Suspenso · troca de senha pendente', carla);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntroca obrigatória: tudo ok');
process.exit(failures ? 1 : 0);
