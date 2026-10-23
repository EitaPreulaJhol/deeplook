// Prioridade P1-P4 (53): coluna e prazo pela prioridade nas listas (P1 de 5 h
// ja atrasada, P3 de 5 h no prazo), filtro e ordenacao, campo na triagem com o
// prazo dela, atualizacao em massa e o evento no historico.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
Object.assign(entries.find((e) => e.id === 'e3'), { priority: 'P1', status: 'PENDING', statusChangedAt: fiveHoursAgo });
Object.assign(entries.find((e) => e.id === 'e1'), { status: 'IN_REVIEW', statusChangedAt: fiveHoursAgo });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const row = (title) => page.locator(`tbody tr:has-text("${title}")`).first();
const headers = async () => (await page.locator('thead th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const col = async (name) => (await headers()).indexOf(name);
const cell = async (title, name) => {
  const all = await page.locator('thead th').allInnerTexts();
  const idx = all.map((t) => t.trim()).indexOf(name);
  return (await row(title).locator('td').nth(idx).innerText()).trim();
};

// 1. Lista: coluna e prazo pela prioridade.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('coluna Prioridade depois de Status', (await col('Prioridade')) === (await col('Status')) + 1, (await headers()).join('|'));
expect('padrão P3 Média', (await cell('instalador_suspeito.exe', 'Prioridade')) === 'P3 Média');
expect('P1 marcada', (await cell('relatorio_trimestral.docm', 'Prioridade')) === 'P1 Crítica');
const ageIdx = (await page.locator('thead th').allInnerTexts()).map((t) => t.trim()).indexOf('Idade');
const p1Age = row('relatorio_trimestral.docm').locator('td').nth(ageIdx);
const p3Age = row('instalador_suspeito.exe').locator('td').nth(ageIdx);
expect('P1 com 5 h: atrasada (vermelho)', (await p1Age.locator('.hpsm-status--red').count()) === 1);
expect('P3 com 5 h: no prazo', (await p3Age.locator('.hpsm-status--red, .hpsm-status--orange').count()) === 0);
expect('dica com o prazo do P1', (await p1Age.locator('.dl-age').getAttribute('title')).includes('(P1: alerta acima de 2 h, atraso acima de 4 h)'));
await page.screenshot({ path: `${OUT}/prioridade-lista.png`, fullPage: true });

// 2. Filtro e ordenacao.
await page.selectOption('#priority', 'P1');
await settle();
expect('filtro por prioridade', new URLSearchParams(state.lastListQuery).get('priority') === 'P1' && (await page.locator('tbody tr').count()) === 1);
await page.selectOption('#priority', '');
await settle();
await page.locator('thead th button:has-text("Prioridade")').click();
await settle();
expect('ordenar por prioridade: mais urgente primeiro', new URLSearchParams(state.lastListQuery).get('sort') === 'priority' && new URLSearchParams(state.lastListQuery).get('dir') === 'desc' && (await page.locator('tbody tr').first().innerText()).includes('P1 Crítica'), state.lastListQuery);

// 3. Atualizacao em massa.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.locator('tbody tr').nth(0).locator('input[type=checkbox]').check();
await page.locator('tbody tr').nth(1).locator('input[type=checkbox]').check();
await page.selectOption('#bulk-priority', 'P4');
await page.locator('.hpsm-bulkbar button:has-text("Aplicar")').click();
const dialog = page.locator('[role=alertdialog]:has-text("Atualização em massa")');
expect('confirmação cita a prioridade', (await dialog.innerText()).includes('prioridade → P4 Baixa'));
await dialog.locator('button:has-text("Atualizar")').click();
await settle();
expect('massa: envia a prioridade', state.lastBulk?.patch?.priority === 'P4' && state.lastBulk.ids.length === 2, JSON.stringify(state.lastBulk));

// 4. Ficha: resumo e triagem.
Object.assign(entries.find((e) => e.id === 'e1'), { priority: 'P3' });
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
expect('resumo: prioridade', (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ').includes('Prioridade: P3 Média'));
expect('triagem: prazo da prioridade', (await page.locator('.hpsm-field:has(#triage-priority) .hpsm-field__help').innerText()).startsWith('Prazo: alerta acima de 24 h e atraso acima de 72 h'));
await page.selectOption('#triage-priority', 'P2');
await settle();
expect('triagem: grava a prioridade', state.lastPatch?.priority === 'P2');
expect('prazo do P2 depois de salvar', (await page.locator('.hpsm-field:has(#triage-priority) .hpsm-field__help').innerText()).startsWith('Prazo: alerta acima de 8 h e atraso acima de 24 h'));
await page.screenshot({ path: `${OUT}/prioridade-ficha.png`, fullPage: true });
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
expect('histórico: mudança de prioridade', (await page.locator('tbody tr:has-text("Prioridade: P3 Média → P2 Alta")').count()) === 1);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nprioridade: tudo ok');
process.exit(failures ? 1 : 0);
