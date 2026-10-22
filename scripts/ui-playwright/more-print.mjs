// Menu "Mais" da toolbar da amostra (28) e ficha para impressao (29): abrir pelo
// mouse e teclado, Esc devolve o foco, copiar link, abrir em nova janela, exportar
// relatorios em Markdown (desabilitado sem relatorio publicado) e a ficha impressa
// (dados, relatorios, historico, "Impresso por / em", impressao automatica, sem
// dados do sandbox, toolbar oculta no papel, PDF em A4).
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
// A caixa de impressao do navegador nao existe no headless: conta as chamadas.
await context.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const more = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]:has-text("Mais")');
const menu = page.locator('.hpsm-ctxmenu');
const item = (label) => menu.locator(`button:has-text("${label}")`);
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());

// 1. Abrir/fechar.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('botão "Mais ▾" na toolbar', (await more.textContent())?.replace(/\s+/g, '') === 'Mais▾');
await more.click();
expect('clique abre o menu', await menu.isVisible() && (await more.getAttribute('aria-expanded')) === 'true');
const labels = (await menu.locator('button').allTextContents()).map((t) => t.trim());
expect(
  'itens do menu',
  labels.join('|') ===
    'Copiar link do registro|Abrir em nova janela|Marcar como duplicata…|Imprimir ficha…|Exportar relatórios (Markdown)|Exportar IOCs (CSV)|Exportar IOCs (STIX 2.1)|Exportar IOCs (MISP)',
  labels.join('|'),
);
const box = await menu.boundingBox();
const btn = await more.boundingBox();
expect('menu abre logo abaixo do botão', Math.abs(box.y - (btn.y + btn.height)) <= 3 && Math.abs(box.x - btn.x) <= 3, `${box.x},${box.y} vs ${btn.x},${btn.y + btn.height}`);
await page.screenshot({ path: `${OUT}/mais-menu.png` });
await more.click();
expect('clicar de novo fecha', !(await menu.isVisible()));
await more.focus();
await page.keyboard.press('ArrowDown');
expect('seta para baixo abre com foco no 1º item', (await menu.isVisible()) && (await focused()) === 'Copiar link do registro');
await page.keyboard.press('Escape');
expect('Esc fecha e devolve o foco ao botão', !(await menu.isVisible()) && (await focused())?.startsWith('Mais'));
await page.keyboard.press('Enter');
expect('Enter no botão abre', await menu.isVisible());
await page.keyboard.press('Escape');

// 2. Copiar link.
await more.click();
await item('Copiar link do registro').click();
await settle();
const clip = await page.evaluate(() => navigator.clipboard.readText());
expect('link copiado', clip === `${ORIGIN}/entries/e1`, clip);
expect('mensagem de cópia', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Link do registro copiado.'));

// 3. Abrir em nova janela.
await more.click();
const [popup] = await Promise.all([context.waitForEvent('page'), item('Abrir em nova janela').click()]);
await popup.waitForLoadState();
expect('nova janela com o registro', new URL(popup.url()).pathname === '/entries/e1');
await popup.close();

// 4. Exportar relatorios (Markdown).
await more.click();
const [download] = await Promise.all([page.waitForEvent('download'), item('Exportar relatórios (Markdown)').click()]);
expect('nome do arquivo', download.suggestedFilename() === 'deeplook-e1-relatorios.md', download.suggestedFilename());
const md = readFileSync(await download.path(), 'utf8');
expect('Markdown com título e dados', md.startsWith('# instalador_suspeito.exe') && md.includes('| SHA-256 |') && md.includes('Exportado do DeepLook por Ana Souza'));
expect('Markdown com o relatório publicado', md.includes('## Relatórios publicados (1)') && md.includes('Executável empacotado com UPX') && md.includes('185.0.2.10'));
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await more.click();
expect('sem relatório publicado: exportar desabilitado', await item('Exportar relatórios (Markdown)').isDisabled());
await page.keyboard.press('Escape');

// 5. Imprimir ficha.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
const [print] = await Promise.all([context.waitForEvent('page'), item('Imprimir ficha…').click()]);
await print.waitForLoadState('networkidle');
await print.waitForTimeout(600);
const printUrl = new URL(print.url());
expect('ficha abre fora da casca', printUrl.pathname === '/entries/e1/imprimir' && (await print.locator('.dl-shell').count()) === 0);
expect('impressão automática (uma vez)', (await print.evaluate(() => window.__printed)) === 1);
expect('título da janela', (await print.title()) === 'Ficha — instalador_suspeito.exe', await print.title());
const meta = (await print.locator('.dl-print__meta').innerText()).replace(/\s+/g, ' ');
expect('"Impresso por / em"', /^Impresso por Ana Souza em \d{2}\/\d{2}\/\d{4}/.test(meta), meta);
const sections = await print.locator('.dl-print h2').allTextContents();
expect('dados, relatórios e histórico de uma vez', sections.join('|') === 'Dados da amostra|Relatórios publicados (1)|Histórico (1)', sections.join('|'));
const text = await print.locator('.dl-print').innerText();
expect('SHA-256 e relatório na ficha', text.includes('Executável empacotado com UPX') && text.includes('Cria HKCU'));
expect('nada do ambiente isolado', !/console|vnc|senha|sandbox|ambiente isolado/i.test(text.replace('Manuseie arquivos e links apenas em ambiente isolado.', '')));
await print.screenshot({ path: `${OUT}/ficha-tela.png`, fullPage: true });

// No papel: toolbar some; gera o PDF em A4 para conferencia.
await print.emulateMedia({ media: 'print' });
expect('toolbar oculta na impressão', !(await print.locator('.dl-print__toolbar').isVisible()));
await print.pdf({ path: `${OUT}/ficha.pdf`, format: 'A4', printBackground: true });
await print.emulateMedia({ media: 'screen' });
await print.click('.hpsm-toolbar__action:has-text("Imprimir")');
expect('botão Imprimir', (await print.evaluate(() => window.__printed)) === 2);

// Sem ?auto=1 nao imprime sozinha.
const manual = await context.newPage();
await manual.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
await manual.waitForTimeout(600);
expect('sem ?auto=1 não imprime sozinha', (await manual.evaluate(() => window.__printed)) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmais/imprimir: tudo ok');
process.exit(failures ? 1 : 0);
