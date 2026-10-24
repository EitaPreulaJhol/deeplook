// Relatorio gerencial (77): pasta Gestao, periodo padrao (30 dias), atalhos de
// periodo e datas na URL, indicadores e tabelas, exportar CSV, imprimir e
// usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});
const state = createState({ loggedIn: true });
await setupMock(context, state);
const asked = [];
const dur = (n, avgHours, medianHours) => ({ n, avgHours, medianHours });
// Depois do mock comum: esta rota tem prioridade.
await context.route('**/api/management?*', (route) => {
  const url = new URL(route.request().url());
  asked.push(Object.fromEntries(url.searchParams));
  if (state.role === 'USER') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Acesso negado."}' });
  if (url.searchParams.get('format') === 'csv') {
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="deeplook-gerencial-${url.searchParams.get('from')}-a-${url.searchParams.get('to')}.csv"` }, body: 'Seção;Item\n' });
  }
  const data = {
    period: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), tz: url.searchParams.get('tz'), since: '', until: '' },
    received: { total: 42, files: 30, urls: 12 },
    completed: 35,
    timeToComplete: { all: dur(35, 20.5, 9), byPriority: { P1: dur(3, 2.5, 2), P2: dur(5, 8, 7), P3: dur(25, 22, 10), P4: dur(2, 120, 120) } },
    verdicts: { MALICIOUS: 12, SUSPICIOUS: 8, CLEAN: 10, UNKNOWN: 5 },
    techniques: [{ id: 'T1566', name: 'Phishing', count: 9 }, { id: 'T1059.001', name: 'PowerShell', count: 4 }],
    cases: { opened: 4, closed: 3, openNow: 6 },
    workload: [
      { id: 'u2', name: 'Bruno Lima', completed: 20, avgHours: 18.2, reports: 22, reviews: 3 },
      { id: 'u1', name: 'Ana Souza', completed: 15, avgHours: 24, reports: 14, reviews: 9 },
    ],
  };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();

// 1. Navegador e periodo padrao.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const leaf = page.locator('#hpsm-tree-gestao .hpsm-tree__leaf:has-text("Relatório gerencial")');
expect('pasta Gestão com o relatório', (await leaf.count()) === 1);
await leaf.click();
await settle();
expect('abre /gerencial', new URL(page.url()).pathname === '/gerencial');
expect('aba do workspace', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('Relatório gerencial'));
const first = asked.at(-1);
const from30 = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));
expect('padrão: últimos 30 dias com o fuso', first?.from === from30 && first?.to === ymd(today) && Boolean(first?.tz), JSON.stringify(first));
expect('atalho mostra 30 dias', (await page.inputValue('#mgmt-preset')) === '30');

// 2. Conteudo.
const kpis = (await page.locator('.dl-kpi').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('indicadores', kpis[0].startsWith('42 Amostras recebidas 30 arquivo(s), 12 link(s)') && kpis[1].startsWith('35 Concluídas') && kpis[2].startsWith('20,5 h Tempo médio até concluir mediana 9 h'), kpis.join(' | '));
const prio = (await page.locator('table[aria-label="Tempo até concluir por prioridade"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('tempo por prioridade (dias acima de 48 h)', prio[0] === 'P1 Crítica 3 2,5 h 2 h' && prio[3] === 'P4 Baixa 2 5 d 5 d', prio.join(' | '));
const work = (await page.locator('table[aria-label="Carga por analista no período"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('carga por analista', work[0] === 'Bruno Lima 20 18,2 h 22 3', work.join(' | '));
expect('técnicas', (await page.locator('ul[aria-label="Técnicas ATT&CK mais vistas"] li').count()) === 2);
await page.screenshot({ path: `${OUT}/gerencial.png`, fullPage: true });

// 3. Mes anterior e data livre.
await page.selectOption('#mgmt-preset', 'lastMonth');
await settle();
const lm = { from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) };
const u = new URL(page.url()).searchParams;
expect('mês anterior na URL e na API', u.get('de') === lm.from && u.get('ate') === lm.to && asked.at(-1)?.from === lm.from && asked.at(-1)?.to === lm.to, `${u} ${JSON.stringify(asked.at(-1))}`);
await page.fill('#mgmt-from', `${lm.from.slice(0, 8)}05`);
await settle();
expect('data livre = Personalizado', (await page.inputValue('#mgmt-preset')) === '' && asked.at(-1)?.from === `${lm.from.slice(0, 8)}05`, JSON.stringify(asked.at(-1)));

// 4. CSV.
const [csv] = await Promise.all([page.waitForEvent('download'), page.click('.hpsm-toolbar__action:has-text("Exportar CSV")')]);
expect('CSV do período', csv.suggestedFilename() === `deeplook-gerencial-${lm.from.slice(0, 8)}05-a-${lm.to}.csv` && asked.at(-1)?.format === 'csv', csv.suggestedFilename());

// 5. Imprimir.
const [print] = await Promise.all([context.waitForEvent('page'), page.click('.hpsm-toolbar__action:has-text("Imprimir")')]);
await print.waitForLoadState('networkidle');
await print.waitForTimeout(600);
const pu = new URL(print.url());
expect('impressão fora da casca com o período', pu.pathname === '/gerencial/imprimir' && pu.searchParams.get('de') === `${lm.from.slice(0, 8)}05` && (await print.locator('.dl-shell').count()) === 0, print.url());
expect('impressão automática', (await print.evaluate(() => window.__printed)) === 1);
const br = (d) => d.split('-').reverse().join('/');
expect('título com o período', (await print.locator('.dl-print__title').innerText()) === `${br(`${lm.from.slice(0, 8)}05`)} a ${br(lm.to)}`, await print.locator('.dl-print__title').innerText());
expect('impressão com os indicadores', (await print.locator('.dl-kpi').count()) === 6);
await print.screenshot({ path: `${OUT}/gerencial-impressao.png`, fullPage: true });
await print.close();

// 6. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/gerencial', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/gerencial', page.url());
expect('sem a pasta Gestão', (await page.locator('#hpsm-tree-gestao').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nrelatório gerencial: tudo ok');
process.exit(failures ? 1 : 0);
