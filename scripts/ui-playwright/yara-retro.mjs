// YARA retroativo (67): "Aplicar às existentes…" com confirmacao, secao
// "Varreduras retroativas" com progresso que atualiza sozinho, acertos com
// link, botoes desabilitados com uma varredura em andamento e cancelar.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.yaraRules = [
  { id: 'y1', name: 'Dropper XYZ', description: null, source: 'rule a { condition: true }', enabled: true, createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z', createdBy: null, updatedBy: { id: 'u1', displayName: 'Ana Souza' } },
  { id: 'y2', name: 'Genéricas', description: null, source: 'rule b { condition: true }', enabled: true, createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z', createdBy: null, updatedBy: null },
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
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim());
const ruleRow = (name) => page.locator(`table[aria-label="Regras YARA"] tbody tr:has-text("${name}")`);
const retroRows = page.locator('table[aria-label="Varreduras retroativas"] tbody tr');

await page.goto(ORIGIN + '/yara', { waitUntil: 'networkidle' });
expect('sem varreduras: sem seção', (await page.locator('.hpsm-section__head:has-text("Varreduras retroativas")').count()) === 0);

// 1. Iniciar com confirmacao.
await ruleRow('Dropper XYZ').locator('button:has-text("Aplicar às existentes")').click();
await settle(300);
const dialog = page.locator('[role=alertdialog]:has-text("Aplicar às amostras existentes")');
expect('pede confirmação', (await dialog.innerText()).includes('Dropper XYZ'));
await dialog.locator('button:has-text("Aplicar")').click();
await settle();
expect('inicia', JSON.stringify(state.yaraCalls.at(-1)) === '{"retroscan":"y1"}');
expect('aviso com o total', (await messages()).includes('Varredura retroativa de "Dropper XYZ" iniciada: 3.000 amostra(s).'), (await messages()).join(' | '));
expect('linha em andamento', (await retroRows.first().innerText()).includes('Em andamento') && (await retroRows.first().innerText()).includes('0 de 3.000 (0%)'));
expect('outros botões desabilitados', await ruleRow('Genéricas').locator('button:has-text("Aplicar às existentes")').isDisabled());

// 2. Progresso atualiza sozinho e os acertos aparecem.
Object.assign(state.retroscans[0], { scanned: 1240, matched: 2, failed: 1 });
state.retroHits.rs1 = [
  { identifiers: ['Dropper_XYZ'], entry: { id: 'e1', title: 'instalador_suspeito.exe', verdict: 'SUSPICIOUS', status: 'IN_REVIEW' } },
  { identifiers: ['Dropper_XYZ', 'Outra'], entry: { id: 'e3', title: 'relatorio_trimestral.docm', verdict: 'UNKNOWN', status: 'PENDING' } },
];
await page.waitForTimeout(2600);
const row = (await retroRows.first().innerText()).replace(/\s+/g, ' ');
expect('progresso atualizado', row.includes('1.240 de 3.000 (41%)') && row.includes('1 ilegível(is)') && row.includes('2 acima de 100 MB'), row);
const bar = await retroRows.first().locator('.dl-retro-progress__bar').evaluate((el) => el.style.width);
expect('barra proporcional', bar === '41%', bar);
await retroRows.first().locator('button:has-text("Ver acertos (2)")').click();
await settle();
const hits = page.locator('.dl-retro-hits li');
expect('acertos com link', (await hits.count()) === 2 && (await hits.first().locator('a').getAttribute('href')) === '/entries/e1');
expect('identificadores', (await hits.nth(1).innerText()).includes('Dropper_XYZ, Outra'));
await page.screenshot({ path: `${OUT}/yara-retro.png`, fullPage: true });

// 3. Cancelar.
await retroRows.first().locator('button:has-text("Cancelar")').click();
await settle(2600);
expect('cancelada', state.retroscans[0].status === 'CANCELLED' && (await retroRows.first().innerText()).includes('Cancelada'));
expect('botões liberados', !(await ruleRow('Genéricas').locator('button:has-text("Aplicar às existentes")').isDisabled()));

// 4. Concluida sem acertos.
state.retroscans.unshift({ id: 'rs2', ruleId: 'y2', ruleName: 'Genéricas', status: 'DONE', total: 10, scanned: 10, matched: 0, failed: 0, skipped: 0, startedAt: '2026-10-24T15:00:00.000Z', finishedAt: '2026-10-24T15:01:00.000Z', error: null, startedBy: null });
await page.goto(ORIGIN + '/yara', { waitUntil: 'networkidle' });
await retroRows.first().locator('button:has-text("Ver acertos (0)")').click();
await settle();
expect('concluída sem acertos', (await retroRows.first().innerText()).includes('Concluída') && (await page.locator('.dl-retro-hits').innerText()).includes('Nenhuma amostra casou.'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nYARA retroativo: tudo ok');
process.exit(failures ? 1 : 0);
