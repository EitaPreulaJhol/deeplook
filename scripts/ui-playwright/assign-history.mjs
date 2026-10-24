// Atribuicao de amostras (Assumir analise, Responsavel, fila "Atribuidas a mim")
// e aba Historico da amostra.
import { chromium } from 'playwright';

import { createState, events, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const summary = () => page.locator('.dl-summary').textContent();
const mineCount = async () =>
  (await page.locator('.hpsm-tree__leaf', { hasText: 'Atribuídas a mim' }).locator('.hpsm-tree__count').textContent())?.trim();

// 1. "Assumir análise" torna o usuario responsavel e alimenta a fila.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('sem responsável no início', (await summary()).includes('Responsável: —'));
expect('fila "Atribuídas a mim (0)"', (await mineCount()) === '(0)');
await page.click('.hpsm-toolbar__action:has-text("Assumir análise")');
await page.waitForTimeout(700);
expect('resumo mostra o responsável', (await summary()).includes('Responsável: Ana Souza'), await summary());
expect('botão some depois de assumir', (await page.locator('.hpsm-toolbar__action:has-text("Assumir análise")').count()) === 0);
expect('fila passa a "(1)"', (await mineCount()) === '(1)');

// 2. Trocar o responsavel pelo campo da triagem.
await page.click('.hpsm-tab:has-text("Análise")');
await page.selectOption('#triage-assignee', 'u2');
await page.waitForTimeout(700);
expect('responsável trocado para Bruno Lima', (await summary()).includes('Responsável: Bruno Lima'));
expect('fila volta a "(0)"', (await mineCount()) === '(0)');
await page.screenshot({ path: `${OUT}/atribuicao.png` });

// 3. Aba Historico: linha do tempo com os eventos.
await page.click('.hpsm-tab:has-text("Histórico")');
await page.waitForTimeout(500);
const rows = await page.locator('tbody tr td:nth-child(3)').allTextContents();
expect(
  'histórico com envio e as duas atribuições',
  JSON.stringify(rows) ===
    JSON.stringify(['Amostra enviada', 'Responsável: — → Ana Souza', 'Responsável: Ana Souza → Bruno Lima']),
  rows.join(' | '),
);
await page.screenshot({ path: `${OUT}/historico.png` });

// 4. Lista: coluna e filtro "Responsável"; fila "Atribuídas a mim".
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
const assigneeIdx = (await page.locator('thead th').allTextContents()).findIndex((t) => t.includes('Responsável'));
const assigneeCol = await page.locator(`tbody tr td:nth-child(${assigneeIdx + 1})`).allTextContents();
expect('coluna Responsável na lista', assigneeCol.includes('Bruno Lima') && assigneeCol.includes('—'), assigneeCol.join(' | '));
await page.selectOption('#assignee', 'none');
await page.waitForTimeout(600);
expect('filtro "Sem responsável"', (await page.locator('tbody tr').count()) === 3);
await page.click('.hpsm-tree__leaf:has-text("Atribuídas a mim")');
await page.waitForTimeout(600);
expect('fila abre o Histórico com assignee=me', new URL(page.url()).search === '?assignee=me', new URL(page.url()).search);

// 5. Falha de provisionamento do sandbox aparece no historico (autor: Sistema).
await page.goto(ORIGIN + '/entries/e4?tab=historico', { waitUntil: 'networkidle' });
const failRow = page.locator('tbody tr', { hasText: 'Falha ao preparar o ambiente isolado' });
expect(
  'falha do sandbox no histórico, autor "Sistema"',
  (await failRow.count()) === 1 &&
    (await failRow.locator('td').nth(1).textContent()) === 'Sistema' &&
    (await failRow.locator('td').nth(2).textContent()).includes('Template 9000 nao encontrado'),
);
await page.screenshot({ path: `${OUT}/historico-falha-sandbox.png` });

// 6. Inclusao/retirada de caso com texto (e nao o codigo do evento).
events.e4.push(
  { id: 'e4-ca', entryId: 'e4', type: 'CASE_ADDED', detail: 'CASO-0007', createdAt: '2026-10-22T10:00:00.000Z', actor: { id: 'u2', displayName: 'Bruno Lima' } },
  { id: 'e4-cr', entryId: 'e4', type: 'CASE_REMOVED', detail: 'CASO-0007', createdAt: '2026-10-22T11:00:00.000Z', actor: { id: 'u2', displayName: 'Bruno Lima' } },
);
await page.goto(ORIGIN + '/entries/e4?tab=historico', { waitUntil: 'networkidle' });
const historyText = await page.locator('.hpsm-tabpanel tbody').innerText();
expect(
  'caso no histórico com texto',
  historyText.includes('Incluída no caso CASO-0007') && historyText.includes('Retirada do caso CASO-0007') && !historyText.includes('CASE_'),
  historyText,
);

await browser.close();
process.exit(failures ? 1 : 0);
