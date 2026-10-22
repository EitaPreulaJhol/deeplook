// Retencao e lixeira (45): ficha com o arquivo expurgado (resumo, campo
// Armazenamento, Baixar desabilitado, sandbox e reanalise indisponiveis,
// historico), "Mover para a lixeira" so para admin (confirmacao, aba vira a
// Lixeira), Lixeira com busca, Restaurar e Excluir definitivamente.
import { chromium } from 'playwright';

import { createState, entries, events, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.retentionDays = 90;
Object.assign(entries.find((e) => e.id === 'e4'), { storageKey: null, filePurgedAt: '2026-10-01T12:00:00.000Z' });
events.e4 = [
  ...(events.e4 ?? []),
  { id: 'ev-p', type: 'FILE_PURGED', actor: null, detail: 'retenção de 90 dias após a conclusão', createdAt: '2026-10-01T12:00:00.000Z' },
];
state.trash = [
  { id: 't1', title: 'fatura_antiga.pdf', type: 'FILE', verdict: 'CLEAN', sha256: 'cc33', url: null, fileSize: 52000, filePurgedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z', deletedAt: '2026-10-20T10:00:00.000Z', owner: { id: 'u2', displayName: 'Bruno Lima' }, deletedBy: { id: 'u1', displayName: 'Ana Souza' }, _count: { reports: 1 } },
];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const openMore = async () => {
  await page.click('.hpsm-toolbar button:has-text("Mais")');
  await settle(200);
};

// 1. Ficha com o arquivo expurgado.
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('resumo: arquivo expurgado', (await text('.dl-summary')).includes('Arquivo: expurgado em 01/10/2026'), await text('.dl-summary'));
const storage = await text('.hpsm-field:has(.hpsm-field__label:text-is("Armazenamento:")) .hpsm-readonly');
expect('campo Armazenamento', storage.startsWith('Arquivo expurgado em 01/10/2026') && storage.includes('(90 dias após a conclusão)') && storage.endsWith('A ficha, os relatórios, os IOCs e o hash continuam disponíveis.'), storage);
const download = page.locator('.hpsm-toolbar__action:has-text("Baixar amostra")');
expect('Baixar desabilitado com o motivo', (await download.getAttribute('aria-disabled')) === 'true' || (await download.isDisabled().catch(() => false)), await download.evaluate((el) => el.outerHTML.slice(0, 160)));
expect('dica do Baixar', (await download.getAttribute('title')) === 'O arquivo foi expurgado pela política de retenção.');
const staticText = await text('.hpsm-section:has-text("Análise estática") .dl-static-empty');
expect('análise estática: motivo e sem "Analisar agora"', staticText.startsWith('Sem análise estática: o arquivo foi expurgado') && (await page.locator('button:has-text("Analisar agora")').count()) === 0, staticText);
await page.screenshot({ path: `${OUT}/retencao-ficha.png`, fullPage: true });
await page.goto(ORIGIN + '/entries/e4?tab=analise', { waitUntil: 'networkidle' });
expect('sandbox indisponível', (await text('.hpsm-section:has-text("Ambiente isolado")')).includes('Indisponível: o arquivo desta amostra foi expurgado'));
expect('sem botão Abrir ambiente', (await page.locator('button:has-text("Abrir ambiente isolado")').count()) === 0);
await page.goto(ORIGIN + '/entries/e4?tab=historico', { waitUntil: 'networkidle' });
expect('histórico: expurgo', (await page.locator('tbody tr:has-text("Arquivo expurgado")').count()) === 1, await text('tbody'));

// 2. Mover para a lixeira: so admin.
state.role = 'ANALYST';
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await openMore();
expect('analista não vê "Mover para a lixeira"', (await page.locator('.hpsm-ctxmenu button:has-text("Mover para a lixeira")').count()) === 0);
await page.keyboard.press('Escape');
state.role = undefined;
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await openMore();
await page.click('.hpsm-ctxmenu button:has-text("Mover para a lixeira")');
const dialog = page.locator('[role=alertdialog]:has-text("Mover para a lixeira")');
expect('pede confirmação', (await dialog.innerText()).includes('"relatorio_trimestral.docm" vai sumir das listas'));
await dialog.locator('button:has-text("Cancelar")').click();
await settle();
expect('cancelar não move', !state.calls.includes('POST /api/entries/e3/trash'));
await openMore();
await page.click('.hpsm-ctxmenu button:has-text("Mover para a lixeira")');
await dialog.locator('button.dl-btn--danger').click();
await settle(800);
expect('moveu', state.calls.includes('POST /api/entries/e3/trash'));
expect('foi para a Lixeira', new URL(page.url()).search === '?tab=trash', page.url());
expect('aviso na Lixeira', (await messages()).includes('"relatorio_trimestral.docm" foi movida para a lixeira.'), (await messages()).join(' / '));
const tabs = await page.locator('.hpsm-doctabs .hpsm-doctab__link').allInnerTexts();
expect('aba da amostra substituída pela Administração', !tabs.some((t) => t.includes('relatorio_trimestral')) && tabs.some((t) => t.includes('Administração')), tabs.join('|'));

// 3. Lixeira: lista, busca, restaurar, excluir.
const rows = page.locator('table[aria-label="Lixeira"] tbody tr');
expect('duas na lixeira', (await rows.count()) === 2);
const first = (await rows.first().locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('linha: título, tipo, quem enviou e quem moveu', first[0].startsWith('relatorio_trimestral.docm') && first[3] === 'Ana Souza' && first[4] === 'Ana Souza', first.join(' | '));
const old = (await rows.nth(1).locator('td').first().innerText()).replace(/\s+/g, ' ');
expect('detalhe: tamanho, expurgado, relatórios', old.includes('50.8 KB · arquivo já expurgado · 1 relatório'), old);
await page.screenshot({ path: `${OUT}/lixeira.png`, fullPage: true });
await page.fill('#trash-q', 'fatura');
await settle(900);
expect('busca', (await rows.count()) === 1);
await page.click('.hpsm-filterbar button:has-text("Limpar")');
await settle(900);
await rows.filter({ hasText: 'relatorio_trimestral' }).locator('button:has-text("Restaurar")').click();
await settle(700);
expect('restaurou', state.calls.includes('POST /api/admin/trash/e3/restore') && (await rows.count()) === 1);
expect('aviso de restauração', (await messages()).includes('"relatorio_trimestral.docm" foi restaurada e voltou às listas.'));
await rows.first().locator('button:has-text("Excluir definitivamente")').click();
const del = page.locator('[role=alertdialog]:has-text("Excluir definitivamente")');
expect('excluir avisa que não tem volta', (await del.innerText()).includes('Não há como desfazer.'));
await del.locator('button.dl-btn--danger').click();
await settle(700);
expect('excluiu', state.calls.includes('DELETE /api/admin/trash/t1'));
expect('lixeira vazia', (await messages()).includes('A lixeira está vazia.'), (await messages()).join(' / '));

// 4. Navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Lixeira")');
await settle();
expect('navegador abre a Lixeira', new URL(page.url()).search === '?tab=trash');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nretenção e lixeira: tudo ok');
process.exit(failures ? 1 : 0);
