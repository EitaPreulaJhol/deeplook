// Politica de senha (51): regra no cadastro e em Alterar senha (destaque e
// mensagem antes de enviar), validade na aba Senha (e "sem validade" para admin),
// aviso "Sua senha expira em N dias" no topo, senha vencida leva a "Definir nova
// senha" com o motivo e a regra, e "senha expirada" na aba Usuarios.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const inDays = (n) => new Date(Date.now() + n * 86400000 + 3600000).toISOString();

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: false });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const settle = (ms = 400) => page.waitForTimeout(ms);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ');

// 1. Cadastro: a regra aparece e barra antes de enviar.
await page.goto(ORIGIN + '/register', { waitUntil: 'networkidle' });
expect('cadastro: regra no campo', (await page.locator('.dl-field:has(#password)').innerText()).includes('Mínimo de 8 caracteres, com ao menos um número e um caractere especial.'));
await page.fill('#displayName', 'Nova Pessoa');
await page.fill('#email', 'nova@deeplook.test');
await page.fill('#password', 'semnumero!');
await page.fill('#confirmPassword', 'semnumero!');
await page.fill('#activationKey', 'DL-AAAA-BBBB-CCCC');
await page.click('button[type=submit]');
await settle();
expect('cadastro: senha fora da regra destacada', (await page.locator('.dl-field:has(#password)').getAttribute('class')).includes('invalid') && (await messages()).includes('Senha (8+ caracteres, com número e caractere especial)'), await messages());
expect('cadastro: nada foi enviado', !state.calls.includes('POST /api/auth/register'));

// 2. Login: aba Senha com validade e regra.
users[0].passwordExpiresAt = inDays(30);
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
expect('30 dias: sem aviso no topo', !(await messages()).includes('Sua senha expira'));
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
const validity = (await page.locator('.hpsm-field:has(.hpsm-field__label:text-is("Validade:")) .hpsm-readonly').innerText()).trim();
expect('aba Senha: validade', validity.startsWith('Sua senha vale até') && validity.includes('(30 dias)') && validity.endsWith('Ao trocar, ganha mais 90 dias.'), validity);
await page.fill('#pwd-current', 'senha-atual');
await page.fill('#pwd-new', 'semespecial1');
await page.fill('#pwd-confirm', 'semespecial1');
await page.click('.hpsm-form__buttons button:text-is("Salvar")');
await settle();
expect('troca: regra barra antes de enviar', (await messages()).includes('Nova senha (8+ caracteres, com número e caractere especial)') && !state.calls.includes('POST /api/me/password'), await messages());
await page.screenshot({ path: `${OUT}/politica-senha.png`, fullPage: true });

// 3. Aviso no topo nos ultimos 7 dias.
users[0].passwordExpiresAt = inDays(3);
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
expect('3 dias: aviso no topo', (await messages()).includes('Sua senha expira em 3 dias. Alterar senha'), await messages());
await page.screenshot({ path: `${OUT}/politica-aviso.png`, clip: { x: 0, y: 0, width: 1440, height: 160 } });
await page.click('.hpsm-msg a:has-text("Alterar senha")');
await settle();
expect('link do aviso abre a aba Senha', new URL(page.url()).pathname + new URL(page.url()).search === '/user?tab=senha');
users[0].passwordExpiresAt = inDays(0);
await page.reload({ waitUntil: 'networkidle' });
expect('vence hoje', (await messages()).includes('Sua senha expira hoje.'), await messages());

// 4. Admin: sem validade.
users[0].passwordExpiresAt = null;
await page.reload({ waitUntil: 'networkidle' });
expect('admin: sem validade e sem aviso', (await page.locator('.hpsm-field:has(.hpsm-field__label:text-is("Validade:")) .hpsm-readonly').innerText()).startsWith('Sem validade') && !(await messages()).includes('Sua senha expira'));

// 5. Aba Usuarios: senha expirada.
users[2].passwordExpired = true;
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
const carla = (await page.locator('tbody tr:has-text("Carla Dias") td').nth(3).innerText()).replace(/\s+/g, ' ').trim();
expect('Usuários: senha expirada', carla === 'Suspenso · senha expirada', carla);

// 6. Senha vencida: tela de nova senha com o motivo e a regra.
users[0].mustChangePassword = true;
users[0].passwordChangeReason = 'expired';
await page.click('.hpsm-topbar__user-name');
await page.click('[role=menuitem]:has-text("Sair")');
await page.waitForURL('**/login');
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await settle(800);
expect('vencida: texto do motivo', (await page.locator('.dl-auth__subtitle').innerText()).includes('sua senha expirou (validade de 90 dias)'));
expect('vencida: regra no campo', (await page.locator('.dl-field:has(#force-new)').innerText()).includes('Mínimo de 8 caracteres, com ao menos um número e um caractere especial. Diferente da atual.'));
await page.fill('#force-new', 'semnumero!');
await page.fill('#force-confirm', 'semnumero!');
await page.click('button[type=submit]');
await settle();
expect('vencida: regra barra', (await messages()).includes('Nova senha: inclua ao menos um número.'), await messages());
await page.screenshot({ path: `${OUT}/politica-vencida.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npolítica de senha: tudo ok');
process.exit(failures ? 1 : 0);
