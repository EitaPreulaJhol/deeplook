// Atualizacao em massa: coluna de selecao, barra de acoes, confirmacao e resultado.
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
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const rowCheck = (i) => page.locator('tbody tr').nth(i).locator('input[type=checkbox]');
const bar = page.locator('.hpsm-bulkbar');

await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('analista vê a coluna de seleção', (await page.locator('thead th.hpsm-grid-check').count()) === 1);
expect('sem seleção, sem barra', (await bar.count()) === 0);

// 1. Marca duas linhas: barra aparece; cabecalho fica indeterminado.
await rowCheck(0).check();
await rowCheck(2).check();
expect('barra com "2 selecionadas"', (await bar.locator('.hpsm-bulkbar__count').textContent())?.includes('2 selecionadas'));
expect('cabeçalho indeterminado', await page.locator('thead th.hpsm-grid-check input').evaluate((el) => el.indeterminate));
expect('marcar não abre a amostra', new URL(page.url()).pathname === '/history');

// 2. Aplicar sem escolher campo avisa.
await bar.locator('button:has-text("Aplicar")').click();
await page.waitForTimeout(300);
expect('aplicar sem campo pede escolha', (await messages()).includes('Escolha ao menos um campo para alterar.'));

// 3. Status Concluído + responsável Bruno: confirmação e resultado.
await page.selectOption('#bulk-status', 'COMPLETED');
await page.selectOption('#bulk-assignee', 'u2');
await bar.locator('button:has-text("Aplicar")').click();
const dialog = page.locator('[role=alertdialog]');
expect('confirmação lista as mudanças', (await dialog.textContent()).includes('Atualizar 2 amostras: status → Concluído; responsável → Bruno Lima?'), await dialog.textContent());
await page.screenshot({ path: `${OUT}/massa-confirmacao.png` });
await dialog.locator('button:has-text("Atualizar")').click();
await page.waitForTimeout(800);
expect('chamada à API em massa', state.calls.includes('POST /api/entries/bulk'));
expect('resultado "2 amostras atualizadas."', (await messages()).includes('2 amostras atualizadas.'));
expect('seleção limpa após aplicar', (await bar.count()) === 0);
const statusIdx = (await page.locator('thead th').allTextContents()).findIndex((t) => t.includes('Status'));
const statuses = await page.locator(`tbody tr td:nth-child(${statusIdx + 1})`).allTextContents();
expect('lista atualizada (linhas 1 e 3 concluídas)', statuses[0].includes('Concluído') && statuses[2].includes('Concluído'), statuses.join(' | '));

// 3b. Resolucao: vazia mantem (nao vai na chamada); escrita aparece na confirmacao.
const RESOLUTION = 'É golpe: não clique nos links, não abra os anexos e apague a mensagem.';
await rowCheck(1).check();
expect('modelos como sugestão', (await page.locator('#bulk-resolution-templates option').first().getAttribute('value')) === RESOLUTION);
await page.fill('#bulk-resolution', '   ');
await bar.locator('button:has-text("Aplicar")').click();
await page.waitForTimeout(300);
expect('só espaços não conta como mudança', (await messages()).includes('Escolha ao menos um campo para alterar.'));
await page.fill('#bulk-resolution', `  ${RESOLUTION}  `);
await bar.locator('button:has-text("Aplicar")').click();
expect('confirmação mostra a resolução', (await dialog.textContent()).includes(`Atualizar 1 amostra: resolução → "${RESOLUTION}"?`), await dialog.textContent());
await page.screenshot({ path: `${OUT}/massa-resolucao.png` });
await dialog.locator('button:has-text("Atualizar")').click();
await page.waitForTimeout(800);
expect('envia aparada e só ela', JSON.stringify(state.lastBulk?.patch) === JSON.stringify({ resolution: RESOLUTION }), JSON.stringify(state.lastBulk?.patch));

// 4. Selecionar todas e trocar o filtro limpa a seleção.
await page.locator('thead th.hpsm-grid-check input').check();
expect('selecionar todas desta página', (await bar.locator('.hpsm-bulkbar__count').textContent())?.includes('4 selecionadas'));
await page.screenshot({ path: `${OUT}/massa-barra.png` });
await page.selectOption('#verdict', 'CLEAN');
await page.waitForTimeout(700);
expect('trocar o filtro limpa a seleção', (await bar.count()) === 0);

// 5. Teclado: Espaco marca a linha, Enter abre.
await page.selectOption('#verdict', '');
await page.waitForTimeout(600);
await page.locator('tbody tr').first().focus();
await page.keyboard.press(' ');
expect('Espaço marca a linha', await rowCheck(0).isChecked());
await page.keyboard.press('Enter');
await page.waitForURL('**/entries/e1');
expect('Enter abre a amostra', new URL(page.url()).pathname === '/entries/e1');

// 6. Usuario comum nao ve a selecao.
state.role = 'USER';
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('usuário comum sem coluna de seleção', (await page.locator('thead th.hpsm-grid-check').count()) === 0);

await browser.close();
process.exit(failures ? 1 : 0);
