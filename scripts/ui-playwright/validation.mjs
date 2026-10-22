// Validacao no estilo HPSM: campo destacado, mensagem na barra, foco no primeiro
// invalido e destaque que some ao corrigir.
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
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const invalidLabels = () => page.locator('.hpsm-field--invalid .hpsm-field__label').allTextContents();
const focusedId = () => page.evaluate(() => document.activeElement?.id);

// 1. Enviar Amostra (arquivo) sem arquivo.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.click('.hpsm-toolbar__action:has-text("Enviar arquivo")');
await page.waitForTimeout(300);
expect('mensagem lista o campo', (await messages()).includes('Preencha ou corrija os campos destacados: Arquivo.'));
expect('campo Arquivo destacado', (await invalidLabels()).some((t) => t.startsWith('Arquivo')));
const labelColor = await page
  .locator('.hpsm-field--invalid .hpsm-field__label')
  .first()
  .evaluate((el) => getComputedStyle(el).color);
expect('rótulo do campo inválido em vermelho', labelColor === 'rgb(212, 42, 31)', labelColor);
expect('foco no "Selecionar arquivo"', (await focusedId()) === 'file-pick');
await page.screenshot({ path: `${OUT}/validacao-arquivo.png` });
await page.setInputFiles('input[type=file]', { name: 'a.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
await page.waitForTimeout(300);
expect('corrigir remove destaque e mensagem', (await invalidLabels()).length === 0 && !(await messages()).join(' ').includes('Preencha ou corrija'));

// 2. Link com URL invalida.
await page.click('.hpsm-tab:has-text("Link")');
await page.fill('#url', 'exemplo sem protocolo');
await page.click('.hpsm-toolbar__action:has-text("Enviar link")');
await page.waitForTimeout(300);
expect('URL inválida destacada', (await invalidLabels()).some((t) => t.startsWith('URL suspeita')));
expect('foco na URL', (await focusedId()) === 'url');
expect('campo marcado aria-invalid? (rótulo vermelho)', (await page.locator('.hpsm-field--invalid').count()) === 1);
await page.fill('#url', 'https://phish.example/login');
await page.waitForTimeout(200);
expect('URL corrigida limpa o destaque', (await invalidLabels()).length === 0);

// 3. Novo relatorio sem resumo (via Ctrl+S).
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.fill('#report-findings', 'algo');
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(300);
expect('relatório: Resumo destacado', (await invalidLabels()).some((t) => t.startsWith('Resumo')));
expect('relatório: foco no Resumo', (await focusedId()) === 'report-summary');
const borderColor = await page.locator('#report-summary').evaluate((el) => getComputedStyle(el).borderTopColor);
expect('borda vermelha mesmo com foco', borderColor === 'rgb(212, 42, 31)', borderColor);
await page.screenshot({ path: `${OUT}/validacao-relatorio.png` });

// 4. Senha: tres campos com regras diferentes.
await page.goto(ORIGIN + '/user?tab=senha', { waitUntil: 'networkidle' });
await page.fill('#pwd-new', 'curta');
await page.click('.hpsm-toolbar__action:has-text("Salvar senha")');
await page.waitForTimeout(300);
const labels = await invalidLabels();
expect('senha: os três campos destacados', labels.length === 3, labels.join(' | '));
expect('senha: foco na senha atual', (await focusedId()) === 'pwd-current');

await browser.close();
process.exit(failures ? 1 : 0);
