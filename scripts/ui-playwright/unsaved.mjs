// Aviso de alteracoes nao salvas: navegar, trocar de aba interna ou fechar a aba
// de documento com um formulario preenchido pede confirmacao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const dialog = page.locator('[role=alertdialog]');
const path = () => new URL(page.url()).pathname + new URL(page.url()).search;
const docTabs = () => page.locator('.hpsm-doctab__link').allTextContents();

// 1. Enviar Amostra com titulo digitado -> clicar no navegador pede confirmacao.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.fill('#file-title', 'rascunho importante');
await page.click('.hpsm-tree__leaf:has-text("Histórico Global")');
expect('sair com rascunho abre o diálogo', await dialog.isVisible());
await page.screenshot({ path: `${OUT}/nao-salvo-dialogo.png` });
await dialog.locator('button:has-text("Continuar editando")').click();
expect(
  '"Continuar editando" mantém a tela e o texto',
  path() === '/submit' && (await page.inputValue('#file-title')) === 'rascunho importante',
);

// 2. Fechar a aba de documento ativa: cancelar mantem a aba; descartar fecha.
const submitTab = page.locator('.hpsm-doctab', { hasText: 'Enviar Amostra' });
await submitTab.locator('.hpsm-doctab__close').click();
expect('fechar a aba com rascunho abre o diálogo', await dialog.isVisible());
await dialog.locator('button:has-text("Continuar editando")').click();
expect('cancelar mantém a aba aberta', (await docTabs()).includes('Enviar Amostra'));
await submitTab.locator('.hpsm-doctab__close').click();
await dialog.locator('button:has-text("Descartar")').click();
await page.waitForTimeout(300);
expect(
  'descartar fecha a aba e sai da tela',
  !(await docTabs()).includes('Enviar Amostra') && path() !== '/submit',
  path(),
);

// 3. Sem alteracoes, navegar nao pede nada.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree__leaf:has-text("Meus Uploads")');
await page.waitForTimeout(300);
expect('formulário vazio navega sem diálogo', !(await dialog.count()) && path() === '/me');

// 4. Rascunho de relatorio: trocar de aba interna pede confirmacao.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.fill('#report-summary', 'achados preliminares');
await page.click('.hpsm-tab:has-text("Detalhes")');
expect('trocar de aba com relatório em rascunho abre o diálogo', await dialog.isVisible());
await dialog.locator('button:has-text("Descartar")').click();
await page.waitForTimeout(300);
expect('descartar troca para a aba Detalhes', path() === '/entries/e1');

// 5. Preferencias alteradas e nao salvas tambem avisam.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-pagesize', '100');
await page.click('.hpsm-tab:has-text("Dados")');
expect('preferências não salvas abrem o diálogo', await dialog.isVisible());
await page.keyboard.press('Escape');
expect('Esc mantém as preferências na tela', path() === '/user?tab=preferencias');

await browser.close();
process.exit(failures ? 1 : 0);
