// Casos (55): pasta "Casos" no navegador com contadores, "Adicionar a caso…" na
// ficha (caso novo) e na lista (marcadas, caso existente), casos no topo da
// ficha, lista /casos, tela do caso (editar com Ctrl+S, incluir por ID,
// retirar com confirmacao, ultima amostra nao sai, comentario, linha do tempo)
// e usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const more = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]');
const menuItem = (label) => page.locator(`.hpsm-ctxmenu button:has-text("${label}")`);
const dialog = page.locator('[role=dialog]:has-text("Adicionar a caso")');
const folder = page.locator('#hpsm-tree-casos');

// 1. Pasta no navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const leaves = (await folder.locator('.hpsm-tree__leaf').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('pasta Casos com contadores', JSON.stringify(leaves) === '["Casos ativos (0)","Meus casos (0)","Todos os casos"]', JSON.stringify(leaves));

// 2. Ficha: caso novo.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
await menuItem('Adicionar a caso…').click();
await settle(300);
expect('caixa abre com o título sugerido', (await dialog.isVisible()) && (await dialog.locator('input[aria-label="Título do caso novo"]').inputValue()) === 'instalador_suspeito.exe');
await dialog.locator('input[aria-label="Título do caso novo"]').fill('x');
await dialog.locator('button:has-text("Criar caso")').click();
await settle(300);
expect('título curto avisa', (await dialog.locator('.dl-dup-error').textContent()).includes('mínimo de 3 caracteres') && state.caseCalls.length === 0);
await dialog.locator('input[aria-label="Título do caso novo"]').fill('Campanha do instalador falso');
await dialog.locator('button:has-text("Criar caso")').click();
await settle();
expect('cria o caso com a amostra', JSON.stringify(state.caseCalls.at(-1)) === JSON.stringify({ method: 'POST', path: '/api/cases', body: { title: 'Campanha do instalador falso', entryIds: ['e1'] } }), JSON.stringify(state.caseCalls.at(-1)));
expect('aviso com o código', (await messages()).some((t) => t.startsWith('Caso CASO-0001 criado com esta amostra')), (await messages()).join(' | '));
const casesSummary = page.locator('.dl-summary__cases');
expect('topo da ficha mostra o caso', (await casesSummary.innerText()).replace(/\s+/g, ' ').trim() === 'Casos: CASO-0001' && (await casesSummary.locator('a').getAttribute('href')) === '/casos/cs1');

// 3. Lista: marcadas num caso existente.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr:has-text("Página de login falsa do banco") input[type=checkbox]').check();
await page.locator('tbody tr:has-text("relatorio_trimestral.docm") input[type=checkbox]').check();
await page.locator('.hpsm-bulkbar button:has-text("Adicionar a caso…")').click();
await settle(300);
expect('mensagem fala das 2 amostras', (await dialog.locator('.hpsm-modal__message').innerText()).includes('as 2 amostras'));
await dialog.locator('label:has-text("CASO-0001") input').check();
await dialog.locator('button:has-text("Incluir no caso")').click();
await settle();
expect('inclui as marcadas', state.caseCalls.at(-1)?.path === '/api/cases/cs1/entries' && state.caseCalls.at(-1).body.entryIds.length === 2);
expect('aviso da inclusão', (await messages()).some((t) => t.startsWith('2 amostras incluídas no caso CASO-0001')), (await messages()).join(' | '));

// 4. Lista de casos e contadores.
await page.goto(ORIGIN + '/casos?status=active', { waitUntil: 'networkidle' });
const rows = page.locator('table[aria-label="Casos"] tbody tr');
expect('lista de casos', (await rows.count()) === 1 && (await rows.first().innerText()).includes('3'));
expect('contador atualizado', (await folder.locator('.hpsm-tree__leaf').first().innerText()).includes('(1)'));
expect('folha ativa', (await folder.locator('.hpsm-tree__leaf.is-active').innerText()).includes('Casos ativos'));
await rows.first().locator('a').first().click();
await settle();

// 5. Tela do caso.
expect('abre o caso', new URL(page.url()).pathname === '/casos/cs1');
expect('aba do workspace', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('CASO-0001'));
await page.selectOption('#case-status', 'IN_PROGRESS');
await page.fill('#case-description', 'Instaladores falsos enviados por e-mail.');
await page.keyboard.press('Control+s');
await settle();
const patch = state.caseCalls.at(-1);
expect('Ctrl+S salva', patch?.method === 'PATCH' && patch.body.status === 'IN_PROGRESS' && patch.body.assigneeId === 'u1', JSON.stringify(patch));
expect('status no resumo', (await page.locator('.dl-summary').innerText()).includes('Em andamento'));
await page.fill('#case-add-entry', 'https://deeplook.test/entries/e4');
await page.locator('.dl-case-add button:has-text("Incluir")').click();
await settle();
expect('incluir por link', state.caseCalls.at(-1)?.body?.entryIds?.[0] === 'e4' && (await page.locator('table[aria-label="Amostras do caso"] tbody tr').count()) === 4);
await page.locator('table[aria-label="Amostras do caso"] tbody tr:has-text("driver_update.msi") button:has-text("Retirar")').click();
await settle(300);
await page.locator('[role=alertdialog] button:has-text("Retirar")').click();
await settle();
expect('retirar com confirmação', state.caseCalls.at(-1)?.method === 'DELETE' && (await page.locator('table[aria-label="Amostras do caso"] tbody tr').count()) === 3);
await page.fill('#case-comment', 'Mesmo instalador nas três.');
await page.locator('.dl-case-comment button:has-text("Comentar")').click();
await settle();
const timeline = (await page.locator('.dl-case-timeline li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
expect('linha do tempo', timeline.some((t) => t.includes('criou o caso')) && timeline.some((t) => t.includes('mudou o status: Aberto → Em andamento')) && timeline.some((t) => t.includes('retirou a amostra driver_update.msi')) && timeline.at(-1).includes('Mesmo instalador nas três.'), JSON.stringify(timeline));
await page.screenshot({ path: `${OUT}/caso.png`, fullPage: true });

// 6. Ultima amostra nao sai.
state.cases[0].entries = state.cases[0].entries.slice(0, 1);
await page.goto(ORIGIN + '/casos/cs1', { waitUntil: 'networkidle' });
expect('última amostra: Retirar desabilitado', await page.locator('table[aria-label="Amostras do caso"] tbody tr button:has-text("Retirar")').isDisabled());

// 7. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/casos', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/casos');
expect('sem pasta Casos', (await page.locator('#hpsm-tree-casos').count()) === 0);
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
expect('sem "Adicionar a caso…"', (await menuItem('Adicionar a caso…').count()) === 0);
expect('sem casos no topo', (await page.locator('.dl-summary__cases').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncasos: tudo ok');
process.exit(failures ? 1 : 0);
