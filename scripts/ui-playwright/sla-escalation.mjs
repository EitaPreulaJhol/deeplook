// Escalonamento por prazo: avisos de alerta/atraso na caixa de entrada (painel
// e pagina, sem autor) e no historico da amostra (autor "Sistema", prazo e
// prioridade, prioridade subida pelo escalonamento).
import { chromium } from 'playwright';

import { createState, events, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.notifications = [
  { id: 'n1', type: 'SLA_LATE', detail: '72', readAt: null, createdAt: '2026-10-22T10:00:00.000Z', entry: { id: 'e1', title: 'instalador_suspeito.exe' }, actor: null },
  { id: 'n2', type: 'SLA_WARN', detail: '24', readAt: null, createdAt: '2026-10-22T09:00:00.000Z', entry: { id: 'e3', title: 'relatorio_trimestral.docm' }, actor: null },
];
events.e1.push(
  { id: 'e1-w', entryId: 'e1', type: 'SLA_WARN', fromValue: 'P3', toValue: null, detail: '24', createdAt: '2026-10-21T09:00:00.000Z', actor: null },
  { id: 'e1-l', entryId: 'e1', type: 'SLA_LATE', fromValue: 'P3', toValue: null, detail: '72', createdAt: '2026-10-22T10:00:00.000Z', actor: null },
  { id: 'e1-p', entryId: 'e1', type: 'PRIORITY_CHANGED', fromValue: 'P3', toValue: 'P2', detail: 'escalonamento', createdAt: '2026-10-22T10:00:01.000Z', actor: null },
);
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const panel = page.locator('.hpsm-inbox__panel');

// 1. Painel do sininho.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-inbox__bell');
await settle();
const titles = await panel.locator('.hpsm-inbox__title').allTextContents();
expect(
  'frases de prazo',
  titles.join('|') === 'Amostra atrasada: mais de 72 h no mesmo status|Prazo em alerta: mais de 24 h no mesmo status',
  titles.join('|'),
);
expect('sem trecho entre aspas', (await panel.locator('.hpsm-inbox__detail').count()) === 0);
await panel.locator('.hpsm-inbox__item').first().click();
await settle();
expect('abre a ficha', new URL(page.url()).pathname === '/entries/e1', page.url());

// 2. Pagina da caixa de entrada.
await page.goto(ORIGIN + '/inbox', { waitUntil: 'networkidle' });
const body = await page.locator('main').innerText();
expect('página lista os avisos', body.includes('Amostra atrasada: mais de 72 h no mesmo status') && body.includes('Prazo em alerta: mais de 24 h no mesmo status'));

// 3. Historico da amostra.
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
const row = (text) => page.locator('.hpsm-tabpanel tbody tr', { hasText: text });
const cells = async (text) => (await row(text).first().locator('td').allTextContents()).map((t) => t.trim());
const warn = await cells('Prazo em alerta');
expect('alerta no histórico com autor Sistema', warn[1] === 'Sistema' && warn[2] === 'Prazo em alerta: mais de 24 h no status atual (P3 Média)', warn.join(' | '));
const late = await cells('Atrasada');
expect('atraso no histórico', late[1] === 'Sistema' && late[2] === 'Atrasada: mais de 72 h no status atual (P3 Média)', late.join(' | '));
const bump = await cells('Prioridade');
expect('prioridade subida pelo escalonamento', bump[2] === 'Prioridade: P3 Média → P2 Alta (escalonamento por atraso)', bump.join(' | '));
await page.screenshot({ path: `${OUT}/prazo-escalonamento.png` });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nescalonamento: tudo ok');
process.exit(failures ? 1 : 0);
