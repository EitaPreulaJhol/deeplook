// MITRE ATT&CK (59): campo do relatorio (busca por codigo/nome, setas + Enter,
// clique, remover etiqueta, Backspace), tecnicas no relatorio e no topo da
// ficha como links para o filtro, filtro "ATT&CK" do Historico Global (e a
// etiqueta em Meus Uploads) e o quadro "mais vistas" do Painel.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, reports, setupMock, watchErrors } from './mock-api.mjs';

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
const query = () => new URLSearchParams(state.lastListQuery ?? '');

reports[0].attackTechniques = ['T1204.002', 'T1566.001'];

// 1. Topo da ficha e o relatorio publicado.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const summary = page.locator('.dl-summary__attack');
expect('topo mostra ATT&CK', (await summary.innerText()).replace(/\s+/g, ' ').trim() === 'ATT&CK: T1204.002, T1566.001', await summary.innerText());
expect('link do topo', (await summary.locator('a').first().getAttribute('href')) === '/history?attack=T1204.002');
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
const links = page.locator('.dl-attack-list a');
expect('relatório lista as técnicas com nome', (await links.count()) === 2 && (await links.nth(1).innerText()).replace(/\s+/g, ' ').trim() === 'T1566.001 Spearphishing Attachment', await links.allInnerTexts());
expect('title com a tática', ((await links.nth(1).getAttribute('title')) ?? '').startsWith('T1566.001 Spearphishing Attachment (Initial Access)'));

// 2. Campo do novo relatorio.
const input = page.locator('#report-attack');
await input.fill('phish');
await settle(200);
const options = page.locator('.dl-attack-picker__list [role=option]');
expect('busca por nome (também no meio)', JSON.stringify((await options.allInnerTexts()).map((t) => t.split(/\s/)[0])) === '["T1566","T1566.001","T1566.002"]' && (await options.first().innerText()).includes('T1566 Phishing'), await options.allInnerTexts());
await input.fill('T1566');
await settle(200);
expect('busca por código (técnica e subtécnicas)', JSON.stringify((await options.allInnerTexts()).map((t) => t.split(' ')[0])) === '["T1566","T1566.001","T1566.002"]');
expect('combobox aberto', (await input.getAttribute('aria-expanded')) === 'true');
await input.press('ArrowDown');
await input.press('Enter');
await settle(200);
const chips = page.locator('.dl-attack-picker__chips li');
expect('setas + Enter adicionam', (await chips.count()) === 1 && (await chips.first().innerText()).startsWith('T1566.001'), await chips.allInnerTexts());
expect('campo limpo após escolher', (await input.inputValue()) === '');
await input.fill('ransom');
await settle(200);
expect('nada para "ransom" (nome em inglês)', (await options.count()) === 0);
await input.fill('encrypted');
await settle(200);
await options.first().click();
await settle(200);
await input.fill('powershell');
await settle(200);
await input.press('Enter');
await settle(200);
expect('ordem do ATT&CK', JSON.stringify((await chips.allInnerTexts()).map((t) => t.split(/\s/)[0])) === '["T1059.001","T1486","T1566.001"]', await chips.allInnerTexts());
await page.locator('button[aria-label="Remover T1486"]').click();
await settle(200);
expect('× remove', (await chips.count()) === 2);
await input.fill('');
await input.press('Backspace');
await settle(200);
expect('Backspace no campo vazio remove a última', JSON.stringify((await chips.allInnerTexts()).map((t) => t.split(/\s/)[0])) === '["T1059.001"]');
await input.fill('T1204.002');
await input.press('Enter');
await input.press('Escape');
await page.fill('#report-summary', 'Anexo com macro que baixa o payload');
await page.screenshot({ path: `${OUT}/attack-campo.png`, fullPage: true });
await page.locator('.hpsm-toolbar__action:has-text("Salvar relatório")').click();
await settle();
expect('enviado no relatório', JSON.stringify(state.lastReportBody?.attackTechniques) === '["T1059.001","T1204.002"]', JSON.stringify(state.lastReportBody));
expect('campo zerado após salvar', (await chips.count()) === 0);

// 3. Link do relatorio leva ao Historico Global filtrado.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await links.nth(1).click();
await settle();
expect('abre o histórico filtrado', new URL(page.url()).pathname === '/history' && query().get('attack') === 'T1566.001', page.url());
expect('campo do filtro preenchido', (await page.inputValue('#attack')) === 'T1566.001');
const rows = page.locator('table tbody tr');
expect('só a amostra com a técnica', (await rows.count()) === 1 && (await rows.first().innerText()).includes('instalador_suspeito.exe'));
await page.fill('#attack', 'T1566');
await settle();
expect('trocar o código filtra de novo', query().get('attack') === 'T1566');
await page.fill('#attack', 'T15');
await settle();
expect('código incompleto não muda o filtro', query().get('attack') === 'T1566');
await page.fill('#attack', '');
await settle();
expect('apagar tira o filtro', !query().has('attack') && !new URL(page.url()).searchParams.has('attack'));
await page.goto(ORIGIN + '/history?attack=T1486', { waitUntil: 'networkidle' });
expect('nenhuma amostra com T1486', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('Nenhuma amostra encontrada')));
await page.locator('button:has-text("Limpar")').first().click();
await settle();
expect('Limpar tira o ATT&CK', (await page.inputValue('#attack')) === '' && !query().has('attack'));

// 4. Meus Uploads: etiqueta removivel.
await page.goto(ORIGIN + '/me?attack=T1566', { waitUntil: 'networkidle' });
const chip = page.locator('.hpsm-filterbar__chip:has-text("ATT&CK T1566")');
expect('etiqueta em Meus Uploads', (await chip.count()) === 1 && query().get('attack') === 'T1566');
await chip.locator('button').click();
await settle();
expect('remover a etiqueta', !query().has('attack'));

// 5. Painel.
state.dashboard = {
  scope: 'all', since: '2026-10-16T03:00:00.000Z', sla: { warnHours: 24, lateHours: 72, byPriority: {} },
  byStatus: { PENDING: 1, IN_REVIEW: 1, COMPLETED: 2 }, byVerdict: { UNKNOWN: 1, CLEAN: 1, SUSPICIOUS: 1, MALICIOUS: 1 },
  open: { warn: 0, late: 0 }, period: { submitted: 4, completed: 2 }, daily: [], workload: [],
  techniques: [
    { id: 'T1566.001', name: 'Spearphishing Attachment', tactics: ['initial-access'], count: 5 },
    { id: 'T1486', name: 'Data Encrypted for Impact', tactics: ['impact'], count: 2 },
  ],
};
await page.goto(ORIGIN + '/painel', { waitUntil: 'networkidle' });
const bars = page.locator('ul[aria-label="Técnicas ATT&CK mais vistas"] li');
expect('quadro mais vistas', (await bars.count()) === 2 && (await bars.first().innerText()).replace(/\s+/g, ' ').includes('T1566.001 Spearphishing Attachment 5'), await bars.first().innerText());
const widths = await bars.locator('.dl-hbars__bar').evaluateAll((els) => els.map((e) => e.style.width));
expect('barras proporcionais', JSON.stringify(widths) === '["100%","40%"]', JSON.stringify(widths));
await page.locator('section:has-text("Técnicas ATT&CK mais vistas")').screenshot({ path: `${OUT}/attack-painel.png` });
await bars.first().locator('a').click();
await settle();
expect('número leva ao histórico filtrado', new URL(page.url()).pathname === '/history' && new URL(page.url()).searchParams.get('attack') === 'T1566.001', page.url());
state.dashboard = { ...state.dashboard, techniques: [] };
await page.goto(ORIGIN + '/painel', { waitUntil: 'networkidle' });
expect('sem técnicas no período', (await page.locator('section:has-text("Técnicas ATT&CK mais vistas") .dl-static-empty').count()) === 1);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nATT&CK: tudo ok');
process.exit(failures ? 1 : 0);
