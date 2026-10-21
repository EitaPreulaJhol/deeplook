// Novidades desde a ultima visita (13), atalhos de teclado (15) e exportar CSV (17).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: true });
state.updates = {
  since: '2026-10-19T10:00:00.000Z',
  completed: [
    { entryId: 'e2', title: 'Página de login falsa do banco', verdict: 'MALICIOUS', completedAt: '2026-10-20T15:30:00.000Z' },
  ],
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const path = () => new URL(page.url()).pathname;

// 13. Novidades na Pagina Inicial.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('aviso na barra de mensagens', (await messages()).includes('1 amostra sua foi concluída desde a sua última visita.'));
const news = page.locator('.hpsm-section', { hasText: 'Novidades desde a sua última visita' });
expect('seção de novidades com a amostra', (await news.locator('tbody tr').count()) === 1);
await page.screenshot({ path: `${OUT}/novidades.png` });
await news.locator('a.dl-link').click();
await page.waitForURL('**/entries/e2');
expect('link abre a amostra', path() === '/entries/e2');

// 15. Atalhos.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('.dl-page-head').click(); // foco fora de campos
await page.keyboard.press('/');
expect('"/" foca a busca', await page.evaluate(() => document.activeElement?.id === 'q'));
await page.locator('.dl-page-head').click();
await page.keyboard.press('Alt+KeyN');
await page.waitForURL('**/submit');
expect('Alt+N abre Enviar Amostra', path() === '/submit');
await page.fill('#file-title', 'rascunho');
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(300);
expect('Ctrl+S aciona o envio (pede o arquivo)', (await messages()).includes('Selecione um arquivo para enviar.'));
await page.keyboard.press('Alt+KeyW');
expect('Alt+W com rascunho pede confirmação', await page.locator('[role=alertdialog]').isVisible());
await page.locator('[role=alertdialog] button:has-text("Descartar")').click();
await page.waitForTimeout(300);
expect(
  'Alt+W fecha a aba de documento',
  !(await page.locator('.hpsm-doctab__link').allTextContents()).includes('Enviar Amostra') && path() !== '/submit',
  path(),
);

await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-pagesize', '100');
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(500);
expect('Ctrl+S salva as preferências', (await messages()).includes('Preferências salvas.') && state.preferences.pageSize === 100);

// 17. Exportar CSV com os filtros atuais.
await page.goto(ORIGIN + '/history?status=COMPLETED&sort=title&dir=asc', { waitUntil: 'networkidle' });
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.hpsm-filterbar a:has-text("Exportar CSV")'),
]);
expect('download do CSV', /^deeplook-amostras-\d{8}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
const sent = new URLSearchParams(state.lastExport ?? '');
expect(
  'exportação leva filtros e ordenação, sem paginação',
  sent.get('status') === 'COMPLETED' && sent.get('sort') === 'title' && sent.get('dir') === 'asc' && !sent.has('offset') && !sent.has('limit'),
  state.lastExport,
);
await page.screenshot({ path: `${OUT}/exportar-csv.png` });

await browser.close();
process.exit(failures ? 1 : 0);
