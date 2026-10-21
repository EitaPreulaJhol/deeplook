// Painel de detalhe (preferencia): desligado o clique abre; ligado o clique
// seleciona e mostra o resumo, setas atualizam e duplo clique/Enter abrem.
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
const path = () => new URL(page.url()).pathname;
const paneTitle = () => page.locator('.dl-preview .hpsm-section__head').textContent();

// 1. Padrao (painel desligado): clique abre a amostra, sem painel.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('sem painel por padrão', (await page.locator('.dl-preview').count()) === 0);
await page.locator('tbody tr').nth(1).click();
await page.waitForURL('**/entries/e2');
expect('clique abre a amostra (padrão)', path() === '/entries/e2');

// 2. Liga a preferencia em Minha Conta.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.locator('label[for="pref-detail-pane"]').click();
await page.click('.hpsm-toolbar__action:has-text("Salvar preferências")');
await page.waitForTimeout(500);
expect('preferência salva', state.preferences.detailPane === true);

// 3. Ligado: clique seleciona e mostra o resumo, sem sair da lista.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr').first().click();
await page.waitForTimeout(500);
expect('clique mantém a lista', path() === '/history');
expect('painel com o resumo da 1ª amostra', (await paneTitle())?.includes('instalador_suspeito.exe'), await paneTitle());
expect('linha marcada como selecionada', (await page.locator('tbody tr').first().getAttribute('aria-selected')) === 'true');
expect('resumo traz o último relatório', (await page.locator('.dl-preview').textContent()).includes('Executável empacotado com UPX'));
await page.screenshot({ path: `${OUT}/painel-detalhe.png`, fullPage: true });

// 4. Setas atualizam o painel; Enter abre.
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
expect('↓ atualiza o painel', (await paneTitle())?.includes('Página de login falsa do banco'), await paneTitle());
await page.keyboard.press('Enter');
await page.waitForURL('**/entries/e2');
expect('Enter abre a amostra', path() === '/entries/e2');

// 5. Duplo clique e botão "Abrir amostra" também abrem.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr').nth(2).dblclick();
await page.waitForURL('**/entries/e3');
expect('duplo clique abre a amostra', path() === '/entries/e3');
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr').nth(3).click();
await page.click('.dl-preview .hpsm-toolbar__action:has-text("Abrir amostra")');
await page.waitForURL('**/entries/e4');
expect('"Abrir amostra" no painel abre', path() === '/entries/e4');

await browser.close();
process.exit(failures ? 1 : 0);
