// Exportar o caso (74): secao "Indicadores das amostras" na tela do caso, menu
// Exportar (Markdown completo e IOCs em CSV/STIX/MISP pela API) e Imprimir
// (fora da casca, impressao automatica, todas as secoes, PDF).
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// A caixa de impressao do navegador nao existe no headless: conta as chamadas.
await context.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});
const state = createState({ loggedIn: true });
const at = '2026-10-24T09:00:00.000Z';
const ana = { id: 'u1', displayName: 'Ana Souza' };
const e1 = entries.find((e) => e.id === 'e1');
const e2 = entries.find((e) => e.id === 'e2');
const ce = (e, reports = []) => ({
  addedAt: at,
  addedBy: ana,
  entry: { id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: 'P3', createdAt: e.createdAt, sha256: e.sha256 ?? null, url: e.url ?? null, reports },
});
const event = (id, type, extra = {}) => ({ id, type, detail: null, fromValue: null, toValue: null, createdAt: at, actor: ana, entry: null, ...extra });
state.cases = [
  {
    id: 'cs1', number: 1, code: 'CASO-0001', title: 'Campanha do boleto', description: 'Phishing com instalador.', status: 'IN_PROGRESS',
    createdAt: at, updatedAt: at, closedAt: null, assignee: ana, createdBy: ana,
    entries: [
      ce(e1, [{ id: 'r1', summary: 'Baixa o segundo estágio.', findings: 'Persiste via chave Run.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'MALICIOUS', updatedAt: at, analyst: { id: 'u2', displayName: 'Bruno Lima' }, attackTechniques: ['T1059.001'] }]),
      ce(e2),
    ],
    events: [
      event('ev1', 'CREATED', { detail: 'Campanha do boleto' }),
      event('ev2', 'ENTRY_ADDED', { entry: { id: 'e2', title: e2.title } }),
      event('ev3', 'COMMENT', { detail: 'Mesmo remetente nas duas.' }),
    ],
  },
  {
    id: 'cs2', number: 2, code: 'CASO-0002', title: 'Sem indicadores', description: null, status: 'OPEN',
    createdAt: at, updatedAt: at, closedAt: null, assignee: null, createdBy: ana,
    entries: [ce(entries.find((e) => e.id === 'e4'))],
    events: [event('ev9', 'CREATED')],
  },
];
state.caseIocs.cs1 = [
  { kind: 'SHA256', value: e1.sha256, source: 'SAMPLE', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }] },
  { kind: 'URL', value: e2.url, source: 'SAMPLE', entries: [{ id: 'e2', title: e2.title, verdict: e2.verdict }] },
  { kind: 'IPV4', value: '185.0.2.10', source: 'REPORT', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }, { id: 'e2', title: e2.title, verdict: e2.verdict }] },
];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const exportMenu = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]', { hasText: 'Exportar' });
const item = (label) => page.locator(`.hpsm-ctxmenu button:has-text("${label}")`);

// 1. Secao de indicadores.
await page.goto(ORIGIN + '/casos/cs1', { waitUntil: 'networkidle' });
const section = page.locator('.hpsm-section', { hasText: 'Indicadores das amostras' });
expect('seção com o total', (await section.locator('.hpsm-section__head').innerText()).includes('Indicadores das amostras (3)'));
const rows = section.locator('tbody tr');
expect('3 indicadores', (await rows.count()) === 3);
const ipRow = rows.filter({ hasText: '185.0.2.10' });
expect('IP leva à ficha do indicador', (await ipRow.locator('a').first().getAttribute('href')) === '/iocs/ipv4/185.0.2.10');
expect('IP mostra as duas amostras com link', (await ipRow.locator('td').nth(3).locator('a').count()) === 2 && (await ipRow.locator('td').nth(2).innerText()) === 'Relatório publicado');
const urlRow = rows.filter({ hasText: e2.url });
expect('URL sem link (só texto)', (await urlRow.locator('td').nth(1).locator('a').count()) === 0);
await page.screenshot({ path: `${OUT}/caso-indicadores.png`, fullPage: true });

// 2. Menu Exportar.
await exportMenu.click();
await settle(200);
const labels = (await page.locator('.hpsm-ctxmenu button').allInnerTexts()).map((t) => t.trim());
expect('itens do menu', labels.join('|') === 'Caso completo (Markdown)|IOCs do caso (CSV)|IOCs do caso (STIX 2.1)|IOCs do caso (MISP)', labels.join('|'));
const [md] = await Promise.all([page.waitForEvent('download'), item('Caso completo (Markdown)').click()]);
expect('nome do Markdown', md.suggestedFilename() === 'deeplook-caso-0001.md', md.suggestedFilename());
const text = readFileSync(await md.path(), 'utf8');
expect('Markdown: título e dados', text.startsWith('# CASO-0001 · Campanha do boleto') && text.includes('| Status | Em andamento |') && text.includes('Phishing com instalador.'));
expect('Markdown: amostras com hash e veredito', text.includes(`| ${e1.title} | Arquivo |`) && text.includes(e1.sha256) && text.includes('| Suspeito |'));
expect('Markdown: relatório com achados e ATT&CK', text.includes('Persiste via chave Run.') && text.includes('ATT&CK: T1059.001'));
expect('Markdown: indicadores sem repetir', text.includes('## Indicadores (3)') && text.includes(`| IPv4 | 185.0.2.10 | Relatório publicado | ${e1.title}, ${e2.title} |`), text.split('## Indicadores')[1]?.slice(0, 400));
expect('Markdown: técnica com o nome', text.includes(`| T1059.001 | PowerShell | ${e1.title} |`));
expect('Markdown: linha do tempo com comentário', text.includes('**Ana Souza** comentou: Mesmo remetente nas duas.'));

await exportMenu.click();
await settle(200);
const [csv] = await Promise.all([page.waitForEvent('download'), item('IOCs do caso (CSV)').click()]);
expect('CSV vem da API', csv.suggestedFilename() === 'deeplook-caso-0001-iocs.csv' && state.caseExports.at(-1) === 'csv', csv.suggestedFilename());
await exportMenu.click();
await settle(200);
await Promise.all([page.waitForEvent('download'), item('IOCs do caso (STIX 2.1)').click()]);
expect('STIX vem da API', state.caseExports.at(-1) === 'stix', state.caseExports.join());

// 3. Imprimir.
const [print] = await Promise.all([context.waitForEvent('page'), page.click('.hpsm-toolbar__action:has-text("Imprimir")')]);
await print.waitForLoadState('networkidle');
await print.waitForTimeout(600);
const printUrl = new URL(print.url());
expect('impressão fora da casca', printUrl.pathname === '/casos/cs1/imprimir' && (await print.locator('.dl-shell').count()) === 0, print.url());
expect('impressão automática (uma vez)', (await print.evaluate(() => window.__printed)) === 1);
expect('título da janela', (await print.title()) === 'Caso — CASO-0001 Campanha do boleto', await print.title());
const sections = (await print.locator('.dl-print h2').allTextContents()).map((t) => t.trim());
expect(
  'seções do caso',
  sections.join('|') === 'Dados do caso|Amostras (2)|Relatórios publicados (1)|Indicadores (3)|Técnicas ATT&CK (1)|Linha do tempo (3)',
  sections.join('|'),
);
const printText = await print.locator('.dl-print').innerText();
expect('impressão com hash, técnica e comentário', printText.includes(e1.sha256) && printText.includes('PowerShell') && printText.includes('Mesmo remetente nas duas.'));
await print.screenshot({ path: `${OUT}/caso-impressao.png`, fullPage: true });
await print.emulateMedia({ media: 'print' });
expect('toolbar oculta na impressão', !(await print.locator('.dl-print__toolbar').isVisible()));
await print.pdf({ path: `${OUT}/caso.pdf`, format: 'A4', printBackground: true });
await print.close();

// 4. Caso sem indicadores: exportacao de IOCs desligada.
await page.goto(ORIGIN + '/casos/cs2', { waitUntil: 'networkidle' });
const empty = await page.locator('.hpsm-section', { hasText: 'Indicadores das amostras' }).innerText();
expect('aviso de nenhum indicador', empty.includes('Nenhum indicador'), empty);
await exportMenu.click();
await settle(200);
expect('IOCs desligados sem indicadores', await item('IOCs do caso (CSV)').isDisabled());
expect('Markdown continua ligado', !(await item('Caso completo (Markdown)').isDisabled()));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nexportar caso: tudo ok');
process.exit(failures ? 1 : 0);
