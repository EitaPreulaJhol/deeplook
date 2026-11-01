// Pastas do Navegador (141): recolher e abrir ficam salvos nas preferencias, voltam
// ao recarregar e numa sessao nova; as Preferencias nao mexem nisso.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const state = createState({ loggedIn: true });
const patches = [];
const openSession = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupMock(context, state);
  await context.route('**/api/me/preferences', async (route) => {
    if (route.request().method() === 'PATCH') patches.push(JSON.parse(route.request().postData()));
    return route.fallback();
  });
  const page = await context.newPage();
  watchErrors(page);
  await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
  return { context, page };
};
const folder = (page, name) => page.locator(`.hpsm-tree button:has-text("${name}")`);
const isOpen = async (page, name) => (await folder(page, name).getAttribute('aria-expanded')) === 'true';
const settle = (page) => page.waitForTimeout(700);

// 1. Tudo aberto no comeco; recolher grava.
let { context, page } = await openSession();
expect('sem nada salvo, tudo aberto', (await isOpen(page, 'Filas')) && (await isOpen(page, 'Casos')));
await folder(page, 'Filas').click();
await folder(page, 'Casos').click();
await folder(page, 'Gestão').click();
expect('recolhe na hora', !(await isOpen(page, 'Filas')) && !(await page.locator('.hpsm-tree__leaf:has-text("Pendentes")').isVisible()));
await settle(page);
expect('cliques seguidos: uma gravação', patches.length === 1, JSON.stringify(patches));
expect('grava as três pastas', patches.at(-1)?.closedFolders?.join() === 'filas,casos,gestao', JSON.stringify(patches.at(-1)));
await folder(page, 'Gestão').click();
await settle(page);
expect('reabrir também grava', patches.at(-1)?.closedFolders?.join() === 'filas,casos', JSON.stringify(patches.at(-1)));

// 2. Recarregar e sessao nova.
await page.reload({ waitUntil: 'networkidle' });
expect('recarregar mantém', !(await isOpen(page, 'Filas')) && !(await isOpen(page, 'Casos')) && (await isOpen(page, 'Gestão')));
await context.close();
({ context, page } = await openSession());
expect('sessão nova mantém', !(await isOpen(page, 'Filas')) && (await isOpen(page, 'Amostras')));

// 3. Fechar logo depois do clique nao perde a mudanca.
await folder(page, 'Amostras').click();
await page.locator('.hpsm-tree__leaf:has-text("Página Inicial")').click();
await settle(page);
expect('navegar não reabre', !(await isOpen(page, 'Amostras')));
expect('navegar não perde', patches.at(-1)?.closedFolders?.includes('amostras'), JSON.stringify(patches.at(-1)));

// 4. Preferencias nao mexem nas pastas.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
const saveCount = patches.length;
await folder(page, 'Casos').click();
await settle(page);
const expected = patches.at(-1).closedFolders.join();
await page.locator('.hpsm-tree__leaf:has-text("Busca")').click();
await page.waitForTimeout(300);
expect('mudar pasta na tela de preferências não acusa alteração', (await page.locator('[role=alertdialog]').count()) === 0 && new URL(page.url()).pathname === '/busca');
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.locator('button:has-text("Restaurar padrão")').click();
await page.locator('button:has-text("Salvar preferências")').click();
await settle(page);
const fromScreen = patches.slice(saveCount + 1);
expect('salvar preferências grava sem as pastas', fromScreen.length === 1 && !('closedFolders' in fromScreen[0]), JSON.stringify(fromScreen));
expect('pastas continuam salvas', state.preferences.closedFolders.join() === expected, state.preferences.closedFolders.join());
await context.close();

// 5. Falha ao gravar nao atrapalha.
({ context, page } = await openSession());
await context.route('**/api/me/preferences', (route) => route.abort());
await folder(page, 'Detecção').click();
await settle(page);
expect('falha ao gravar: a pasta segue recolhida', !(await isOpen(page, 'Detecção')));
expect('falha ao gravar: sem erro na tela', (await page.locator('.hpsm-msg--error').count()) === 0);
await context.close();

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npastas do navegador: tudo ok');
process.exit(failures ? 1 : 0);
