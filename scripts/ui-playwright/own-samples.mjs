// Restricao de amostras (140): aba Configuracoes com confirmacao; o usuario comum
// fica sem Historico Global no menu e na Pagina Inicial, e o endereco leva a Meus
// Uploads; analista nao muda. A regra em si esta na API (own-samples.test.ts).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const state = createState({ loggedIn: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const go = (path) => page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
const box = page.locator('#setting-own-samples');
const click = () => page.locator('label[for="setting-own-samples"]').click();
const dialog = page.locator('[role=alertdialog]');
const historyLeaf = page.locator('.hpsm-tree__leaf:has-text("Histórico Global")');

// 1. Admin: tela e confirmacao.
await go('/inicio');
await page.locator('.hpsm-tree__leaf:has-text("Configurações")').click();
await page.waitForTimeout(300);
expect('abre pela pasta Administração', new URL(page.url()).search === '?tab=settings');
expect('desligada por padrão', !(await box.isChecked()));
await click();
expect('confirma explicando', (await dialog.innerText()).includes('só as amostras que eles mesmos enviaram'));
await dialog.locator('button:has-text("Cancelar")').click();
await page.waitForTimeout(200);
expect('cancelar não muda', !(await box.isChecked()) && !state.ownSamplesOnly);
await click();
await dialog.locator('button:has-text("Restringir")').click();
await page.waitForSelector('.hpsm-msg--success');
expect('liga', (await box.isChecked()) && state.ownSamplesOnly === true);
await page.screenshot({ path: `${OUT}/configuracoes.png` });

// 2. Analista nao muda.
state.role = 'ANALYST';
await go('/history');
expect('analista: Histórico Global aberto', new URL(page.url()).pathname === '/history');

// 3. Usuario comum.
state.role = 'USER';
await go('/inicio');
await page.waitForTimeout(200);
expect('sem Histórico Global no menu', (await historyLeaf.count()) === 0);
expect('Meus Uploads continua', (await page.locator('.hpsm-tree__leaf:has-text("Meus Uploads")').count()) === 1);
expect('sem Histórico Global na Página Inicial', !(await page.locator('.dl-welcome').innerText()).includes('Histórico Global'));
await go('/history?status=PENDING');
await page.waitForTimeout(300);
expect('endereço leva a Meus Uploads', new URL(page.url()).pathname === '/me', page.url());
await go('/admin?tab=settings');
expect('sem acesso à configuração', new URL(page.url()).pathname !== '/admin');

// 4. Desligar.
state.role = 'ADMIN';
await go('/admin?tab=settings');
expect('continua ligada ao voltar', await box.isChecked());
await click();
await dialog.locator('button:has-text("Abrir")').click();
await page.waitForSelector('.hpsm-msg--success');
expect('desliga', !(await box.isChecked()) && state.ownSamplesOnly === false);
state.role = 'USER';
await go('/inicio');
expect('usuário comum volta a ter o Histórico Global', (await historyLeaf.count()) === 1);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nrestrição de amostras: tudo ok');
process.exit(failures ? 1 : 0);
