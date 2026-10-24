// Visoes da equipe (62): "Compartilhar visão" no Historico Global (so
// analistas), pasta "Visões da equipe" no navegador com contador, quem
// compartilhou no title, menu de contexto (renomear, remover) so para quem pode,
// visao repetida e usuario comum sem a pasta nem o botao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.teamViews = [
  { id: 'tv1', label: 'Maliciosas da semana', url: '/history?verdict=MALICIOUS', createdAt: '2026-10-20T10:00:00.000Z', createdBy: { id: 'u2', displayName: 'Bruno Lima' }, count: 7, canEdit: false },
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
const folder = page.locator('#hpsm-tree-equipe');
const leaf = (label) => folder.locator(`.hpsm-tree__leaf:has-text("${label}")`);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim());
const modal = page.locator('[role=alertdialog], [role=dialog]').last();

// 1. Pasta com a visao de outro analista.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('pasta Visões da equipe', (await page.locator('.hpsm-tree__folder:has-text("Visões da equipe")').count()) === 1);
expect('visão com contador', (await leaf('Maliciosas da semana').innerText()).replace(/\s+/g, ' ').trim() === 'Maliciosas da semana (7)');
expect('title com quem compartilhou (sem menu)', (await leaf('Maliciosas da semana').getAttribute('title')) === 'Maliciosas da semana — compartilhada por Bruno Lima');
await leaf('Maliciosas da semana').click({ button: 'right' });
await settle(200);
expect('sem menu para quem não pode alterar', (await page.locator('.hpsm-ctxmenu').count()) === 0);
await leaf('Maliciosas da semana').click();
await settle();
expect('abre a visão', new URL(page.url()).pathname + new URL(page.url()).search === '/history?verdict=MALICIOUS');
expect('folha ativa', (await leaf('Maliciosas da semana').getAttribute('class')).includes('is-active'));

// 2. Compartilhar a visao atual.
await page.goto(ORIGIN + '/history?status=PENDING', { waitUntil: 'networkidle' });
const share = page.locator('.hpsm-filterbar button:has-text("Compartilhar visão")');
expect('botão no Histórico Global', (await share.count()) === 1);
await share.click();
await settle(300);
expect('nome sugerido pelos filtros', (await modal.locator('input').inputValue()) === 'Pendente');
await modal.locator('input').fill('Fila pendente');
await modal.locator('button:has-text("Compartilhar")').click();
await settle();
expect('enviado', JSON.stringify(state.teamViewCalls.at(-1)) === JSON.stringify({ method: 'POST', body: { label: 'Fila pendente', url: '/history?status=PENDING' } }), JSON.stringify(state.teamViewCalls.at(-1)));
expect('aviso', (await messages()).includes('Visão "Fila pendente" compartilhada com a equipe.'));
expect('aparece na pasta', (await leaf('Fila pendente').count()) === 1);
await page.screenshot({ path: `${OUT}/visoes-equipe.png`, clip: { x: 0, y: 0, width: 1440, height: 520 } });

// 3. Repetida.
await share.click();
await settle(300);
await modal.locator('button:has-text("Compartilhar")').click();
await settle();
expect('visão repetida avisa', (await messages()).some((t) => t.includes('já está nas Visões da equipe como "Fila pendente"')), (await messages()).join(' | '));

// 4. Renomear e remover a propria (menu de contexto e teclado).
await leaf('Fila pendente').click({ button: 'right' });
await settle(200);
await page.locator('.hpsm-ctxmenu button:has-text("Renomear")').click();
await settle(300);
await modal.locator('input').fill('Pendentes da equipe');
await modal.locator('button:has-text("Renomear")').click();
await settle();
expect('renomeada', (await leaf('Pendentes da equipe').count()) === 1 && state.teamViewCalls.at(-1)?.method === 'PATCH');
await leaf('Pendentes da equipe').focus();
await page.keyboard.press('Delete');
await settle(300);
expect('confirmação fala de todos', (await modal.innerText()).includes('some do navegador de todos os analistas'));
await modal.locator('button:has-text("Remover")').click();
await settle();
expect('removida', (await leaf('Pendentes da equipe').count()) === 0 && state.teamViewCalls.at(-1)?.method === 'DELETE');

// 5. Fora do Historico Global e usuario comum.
await page.goto(ORIGIN + '/me', { waitUntil: 'networkidle' });
expect('sem compartilhar em Meus Uploads', (await page.locator('.hpsm-filterbar button:has-text("Compartilhar visão")').count()) === 0);
state.role = 'USER';
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('usuário comum: sem botão', (await page.locator('.hpsm-filterbar button:has-text("Compartilhar visão")').count()) === 0);
expect('usuário comum: sem pasta', (await page.locator('.hpsm-tree__folder:has-text("Visões da equipe")').count()) === 0);
expect('usuário comum não consulta', !state.teamViewGetsAsUser);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nvisões da equipe: tudo ok');
process.exit(failures ? 1 : 0);
