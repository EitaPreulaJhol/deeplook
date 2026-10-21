// Filas com contadores no navegador e Anterior/Proxima na ficha da amostra.
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
const leaf = (label) => page.locator('.hpsm-tree__leaf', { hasText: label });
const countOf = async (label) => (await leaf(label).locator('.hpsm-tree__count').textContent())?.trim();
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
const docTabs = () => page.locator('.hpsm-doctab__link').allTextContents();

// 1. Filas com contadores (dados do mock: 1 pendente, 1 em analise, 2 concluidas).
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('Pendentes (1)', (await countOf('Pendentes')) === '(1)');
expect('Em análise (1)', (await countOf('Em análise')) === '(1)');
expect('Concluídas (2)', (await countOf('Concluídas')) === '(2)');

// 2. Clicar numa fila abre o Historico filtrado e destaca a fila (nao o Historico).
await leaf('Pendentes').click();
await page.waitForTimeout(600);
expect('fila abre o Histórico filtrado', url() === '/history?status=PENDING', url());
expect('lista mostra só as pendentes', (await page.locator('tbody tr').count()) === 1);
expect(
  'destaque na fila, não no Histórico Global',
  (await leaf('Pendentes').getAttribute('aria-current')) === 'page' &&
    (await leaf('Histórico Global').getAttribute('aria-current')) === null,
);
await page.screenshot({ path: `${OUT}/filas.png` });

// 3. A triagem atualiza os contadores.
await page.goto(ORIGIN + '/entries/e3?tab=analise', { waitUntil: 'networkidle' });
await page.selectOption('#triage-status', 'IN_REVIEW');
await page.waitForTimeout(800);
expect(
  'triagem atualiza as filas',
  (await countOf('Pendentes')) === '(0)' && (await countOf('Em análise')) === '(2)',
  `${await countOf('Pendentes')} / ${await countOf('Em análise')}`,
);

// 4. Anterior / Proxima: navega na sequencia da lista na mesma aba de documento.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr').nth(1).click();
await page.waitForURL('**/entries/e2');
expect('posição "Registro 2 de 4"', (await page.locator('.hpsm-toolbar__info').textContent()) === 'Registro 2 de 4');
const tabsBefore = (await docTabs()).length;
await page.click('.hpsm-tab:has-text("Relatórios")');
await page.click('.hpsm-toolbar__action:has-text("Próxima")');
await page.waitForTimeout(500);
expect('Próxima abre o registro seguinte mantendo a aba interna', url() === '/entries/e3?tab=relatorios', url());
expect(
  'troca o registro na mesma aba (a do anterior fecha; nenhuma aba nova)',
  (await docTabs()).length <= tabsBefore && !(await docTabs()).includes('Página de login falsa do banco'),
  (await docTabs()).join(' | '),
);
expect('aba de documento com o título do novo registro', (await docTabs()).includes('relatorio_trimestral.docm'));
await page.screenshot({ path: `${OUT}/anterior-proxima.png` });
const tabsAtE3 = (await docTabs()).length;
await page.click('.hpsm-toolbar__action:has-text("Próxima")');
await page.waitForTimeout(400);
expect(
  'registro sem aba própria: a aba troca de título no lugar',
  (await docTabs()).length === tabsAtE3 &&
    (await docTabs()).includes('driver_update.msi') &&
    !(await docTabs()).includes('relatorio_trimestral.docm'),
  (await docTabs()).join(' | '),
);
expect('Próxima desabilitada no último registro', await page.locator('.hpsm-toolbar__action:has-text("Próxima")').isDisabled());
await page.click('.hpsm-toolbar__action:has-text("Anterior")');
await page.click('.hpsm-toolbar__action:has-text("Anterior")');
await page.click('.hpsm-toolbar__action:has-text("Anterior")');
await page.waitForTimeout(400);
expect(
  'Anterior desabilitada no primeiro registro',
  url().startsWith('/entries/e1') &&
    (await page.locator('.hpsm-toolbar__action:has-text("Anterior")').isDisabled()),
  url(),
);

await browser.close();
process.exit(failures ? 1 : 0);
