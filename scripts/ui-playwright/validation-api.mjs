// Sobras do 26: formulario de chave do Admin com validacao HPSM e erros de
// validacao da API (details por campo) destacando o campo certo, com a mensagem
// do servidor, foco no campo e destaque que some ao corrigir. Cobre chave,
// envio de URL, relatorio, troca de senha, atualizacao e cadastro.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

async function open(loggedIn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const state = createState({ loggedIn });
  await setupMock(context, state);
  const page = await context.newPage();
  watchErrors(page);
  return { state, page };
}

const { state, page } = await open(true);
const settle = (ms = 300) => page.waitForTimeout(ms);
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const invalidIds = () =>
  page.locator('.hpsm-field--invalid').evaluateAll((els) => els.map((el) => el.querySelector('input, textarea, select, button')?.id));
const focusedId = () => page.evaluate(() => document.activeElement?.id);
const keyPosts = () => state.calls.filter((c) => c === 'POST /api/admin/activation-keys').length;

// 1. Chave de ativacao: validacao no navegador.
await page.goto(ORIGIN + '/admin?tab=keys', { waitUntil: 'networkidle' });
await page.fill('#key-maxuses', '0');
await page.fill('#key-days', '2.5');
await page.click('.hpsm-toolbar__action:has-text("Gerar chave")');
await settle();
expect('chave: campos destacados', (await invalidIds()).join(',') === 'key-maxuses,key-days', (await invalidIds()).join(','));
expect(
  'chave: mensagem lista os campos',
  (await messages()).includes('Preencha ou corrija os campos destacados: Máximo de usos (1 a 1000), Validade (em branco ou 1 a 3650 dias).'),
  (await messages()).join(' | '),
);
expect('chave: foco no 1º inválido', (await focusedId()) === 'key-maxuses');
expect('chave: nada enviado à API', keyPosts() === 0);
await page.screenshot({ path: `${OUT}/validacao-chave.png` });
await page.fill('#key-maxuses', '5');
await page.fill('#key-days', '');
await settle();
expect('chave: corrigir remove o destaque', (await invalidIds()).length === 0);
await page.keyboard.press('Control+KeyS');
await settle();
expect('chave: Ctrl+S gera a chave', keyPosts() === 1 && (await messages()).some((t) => t.includes('DL-NEW1-NEW2-NEW3')));
expect('chave: envia números (sem validade)', JSON.stringify(state.lastKeyBody) === JSON.stringify({ role: 'USER', maxUses: 5 }), JSON.stringify(state.lastKeyBody));

// 2. Chave: erro por campo vindo da API.
state.validationErrors['/api/admin/activation-keys'] = { expiresInDays: ['máximo 3650'] };
await page.fill('#key-days', '30');
await page.click('.hpsm-toolbar__action:has-text("Gerar chave")');
await settle();
expect('API: campo da API destacado', (await invalidIds()).join(',') === 'key-days');
expect('API: mensagem do servidor', (await messages()).includes('Corrija os campos destacados: Validade (máximo 3650).'), (await messages()).join(' | '));
expect('API: sem o erro genérico', !(await messages()).includes('Dados invalidos.'));
expect('API: foco no campo', (await focusedId()) === 'key-days');
const labelColor = await page.locator('.hpsm-field--invalid .hpsm-field__label').evaluate((el) => getComputedStyle(el).color);
expect('API: rótulo vermelho', labelColor === 'rgb(212, 42, 31)', labelColor);
await page.fill('#key-days', '31');
await settle();
expect('API: mudar o valor tira o destaque e a mensagem', (await invalidIds()).length === 0 && !(await messages()).some((t) => t.startsWith('Corrija')));
delete state.validationErrors['/api/admin/activation-keys'];

// 3. Envio de URL: titulo recusado pela API.
state.validationErrors['/api/entries/url'] = { title: ['mínimo de 2 caracteres'] };
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.click('.hpsm-tab:has-text("Link")');
await page.fill('#url', 'https://phish.example/login');
await page.fill('#url-title', 'a');
await page.click('.hpsm-toolbar__action:has-text("Enviar link")');
await settle();
expect('URL: título destacado com a mensagem', (await invalidIds()).join(',') === 'url-title' && (await messages()).includes('Corrija os campos destacados: Título (mínimo de 2 caracteres).'));
expect('URL: continua na tela', new URL(page.url()).pathname === '/submit');
await page.screenshot({ path: `${OUT}/validacao-api-url.png` });
await page.fill('#url-title', 'ab');
await settle();
expect('URL: corrigir tira o destaque', (await invalidIds()).length === 0);
await page.fill('#url', '');
await page.fill('#url-title', '');
delete state.validationErrors['/api/entries/url'];

// 4. Relatorio: Achados recusado pela API.
state.validationErrors['/api/entries/e1/reports'] = { findings: ['máximo de 20000 caracteres'] };
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.fill('#report-summary', 'Resumo válido');
await page.fill('#report-findings', 'texto longo');
await page.keyboard.press('Control+KeyS');
await settle();
expect('relatório: Achados destacado', (await invalidIds()).join(',') === 'report-findings' && (await messages()).includes('Corrija os campos destacados: Achados (máximo de 20000 caracteres).'));
expect('relatório: texto mantido', (await page.inputValue('#report-summary')) === 'Resumo válido');
await page.fill('#report-summary', '');
await page.fill('#report-findings', '');
delete state.validationErrors['/api/entries/e1/reports'];

// 5. Atualizacao: texto recusado pela API.
state.validationErrors['/api/entries/e1/comments'] = { text: ['máximo de 4000 caracteres'] };
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
await page.fill('#comment-text', 'nota');
await page.keyboard.press('Control+KeyS');
await settle();
expect('atualização: campo destacado', (await invalidIds()).join(',') === 'comment-text' && (await messages()).includes('Corrija os campos destacados: Atualização (máximo de 4000 caracteres).'));
await page.fill('#comment-text', '');
delete state.validationErrors['/api/entries/e1/comments'];

// 6. Troca de senha: senha atual recusada pela API.
state.validationErrors['/api/me/password'] = { currentPassword: ['obrigatório'], newPassword: ['mínimo de 8 caracteres'] };
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
await page.fill('#pwd-current', 'x');
await page.fill('#pwd-new', 'nova-senha-123');
await page.fill('#pwd-confirm', 'nova-senha-123');
await page.keyboard.press('Control+KeyS');
await settle();
expect('senha: os dois campos da API destacados', (await invalidIds()).join(',') === 'pwd-current,pwd-new', (await invalidIds()).join(','));
expect(
  'senha: rótulo sem a dica entre parênteses',
  (await messages()).includes('Corrija os campos destacados: Senha atual (obrigatório), Nova senha (mínimo de 8 caracteres).'),
  (await messages()).join(' | '),
);
expect('senha: continua logado', state.loggedIn);
await page.fill('#pwd-current', '');
await page.fill('#pwd-new', '');
await page.fill('#pwd-confirm', '');

// 7. Cadastro (sem sessao).
const reg = await open(false);
await reg.page.goto(ORIGIN + '/register', { waitUntil: 'networkidle' });
await reg.page.fill('#displayName', 'Novo Usuário');
await reg.page.fill('#email', 'novo@x.test');
await reg.page.fill('#password', 'senha-123');
await reg.page.fill('#confirmPassword', 'outra-senha');
await reg.page.fill('#activationKey', 'DL1234ABCD5678');
await reg.page.click('button[type=submit]');
await reg.page.waitForTimeout(300);
const regInvalid = () => reg.page.locator('.dl-field--invalid input').evaluateAll((els) => els.map((el) => el.id));
const regMsgs = () => reg.page.locator('.hpsm-msg__text').allTextContents();
expect('cadastro: confirmação diferente destacada', (await regInvalid()).join(',') === 'confirmPassword');
expect('cadastro: mensagem HPSM', (await regMsgs()).includes('Preencha ou corrija os campos destacados: Confirme a senha (igual à senha).'), (await regMsgs()).join(' | '));
await reg.page.fill('#confirmPassword', 'senha-123');
reg.state.validationErrors['/api/auth/register'] = { email: ['e-mail inválido'] };
await reg.page.click('button[type=submit]');
await reg.page.waitForTimeout(300);
expect('cadastro: e-mail da API destacado', (await regInvalid()).join(',') === 'email' && (await regMsgs()).includes('Corrija os campos destacados: E-mail (e-mail inválido).'), (await regMsgs()).join(' | '));
expect('cadastro: aria-invalid', (await reg.page.getAttribute('#email', 'aria-invalid')) === 'true');
await reg.page.screenshot({ path: `${OUT}/validacao-cadastro.png` });
delete reg.state.validationErrors['/api/auth/register'];
await reg.page.fill('#email', 'novo2@x.test');
await reg.page.click('button[type=submit]');
await reg.page.waitForTimeout(300);
expect('cadastro: erro sem campo continua na barra', (await regMsgs()).includes('Chave de ativacao invalida.') && (await regInvalid()).length === 0, (await regMsgs()).join(' | '));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nvalidação da API: tudo ok');
process.exit(failures ? 1 : 0);
