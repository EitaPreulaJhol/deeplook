// Idade na fila e prazo: coluna Idade (marcador laranja/vermelho, "—" nas
// concluidas, dica com os limites), ordenacao por idade, filtro Prazo, fila
// "Atrasadas (N)" no navegador, "No status há" na ficha e idade zerada ao
// mudar o status.
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
const settle = (ms = 300) => page.waitForTimeout(ms);
const colIndex = async (name) => (await page.locator('thead th').allTextContents()).findIndex((t) => t.trim().startsWith(name)) + 1;
const column = async (name) => page.locator(`tbody tr td:nth-child(${await colIndex(name)})`).allTextContents();
const titles = () => column('Amostra');
const ageCell = async (title) => {
  const idx = await colIndex('Idade');
  return page.locator(`tbody tr:has-text("${title}") td:nth-child(${idx})`);
};
const bulletColor = async (title) => {
  const bullet = (await ageCell(title)).locator('.hpsm-status__bullet');
  return (await bullet.count()) ? bullet.evaluate((el) => getComputedStyle(el).backgroundColor) : null;
};

// 1. Coluna Idade no Historico Global.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
const headers = await page.locator('thead th').allTextContents();
// Status | Prioridade (item 53) | Idade.
expect('coluna Idade depois de Prioridade', headers.findIndex((t) => t.startsWith('Idade')) === headers.findIndex((t) => t.startsWith('Prioridade')) + 1 && headers.findIndex((t) => t.startsWith('Prioridade')) === headers.findIndex((t) => t.startsWith('Status')) + 1, headers.join('|'));
const e1Age = (await (await ageCell('instalador_suspeito.exe')).textContent())?.trim();
const e3Age = (await (await ageCell('relatorio_trimestral.docm')).textContent())?.trim();
expect('idade formatada (30 h → 1 d 6 h)', e1Age?.startsWith('1 d 6 h'), e1Age);
expect('idade formatada (100 h → 4 d 4 h)', e3Age?.startsWith('4 d 4 h'), e3Age);
const done = (await (await ageCell('driver_update.msi')).textContent())?.trim();
expect('concluída mostra "—"', done === '—', done);
const orange = await bulletColor('instalador_suspeito.exe');
const red = await bulletColor('relatorio_trimestral.docm');
const statusOrange = await page.locator('.hpsm-status--orange .hpsm-status__bullet').first().evaluate((el) => getComputedStyle(el).backgroundColor);
const statusRed = await page.locator('.hpsm-status--red .hpsm-status__bullet').first().evaluate((el) => getComputedStyle(el).backgroundColor);
expect('alerta (+24 h) com marcador laranja', orange !== null && orange === statusOrange, orange);
expect('atrasada (+72 h) com marcador vermelho', red !== null && red === statusRed, red);
const tip = await (await ageCell('relatorio_trimestral.docm')).locator('.dl-age').getAttribute('title');
expect('dica com situação e limites', tip === 'No status atual há 4 d 4 h: atrasada (P3: alerta acima de 24 h, atraso acima de 72 h)', tip);
const sr = await (await ageCell('relatorio_trimestral.docm')).locator('.cds--visually-hidden').textContent();
expect('leitor de tela ouve "atrasada"', sr?.includes('atrasada'), sr);
await page.screenshot({ path: `${OUT}/prazo-lista.png` });

// 2. Ordenar por idade: mais antiga primeiro no clique (dir=asc → mais nova?).
await page.locator('thead button').filter({ hasText: /^Idade/ }).click();
await settle();
const sortUrl = new URL(page.url()).searchParams;
expect('ordenação vai para a URL', sortUrl.get('sort') === 'age', page.url());
const order1 = await titles();
await page.locator('thead button').filter({ hasText: /^Idade/ }).click();
await settle();
const order2 = await titles();
expect('inverter a ordem inverte a lista', order1.join('|') === [...order2].reverse().join('|'), `${order1.join(',')} / ${order2.join(',')}`);

// 3. Filtro Prazo.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.selectOption('#age', 'warn');
await settle();
expect('Prazo "Em alerta ou atrasadas"', (await titles()).sort().join('|') === 'instalador_suspeito.exe|relatorio_trimestral.docm', (await titles()).join('|'));
await page.selectOption('#age', 'late');
await settle();
expect('Prazo "Atrasadas"', (await titles()).join('|') === 'relatorio_trimestral.docm');
await page.click('.hpsm-filterbar button:has-text("Limpar")');
await settle();
expect('Limpar remove o filtro de prazo', !new URL(page.url()).searchParams.has('age') && (await titles()).length === 4);

// 4. Fila Atrasadas no navegador.
const lateLeaf = page.locator('#hpsm-tree-filas a:has-text("Atrasadas")');
expect('fila "Atrasadas (1)"', (await lateLeaf.innerText()).replace(/\s+/g, ' ').trim() === 'Atrasadas (1)', await lateLeaf.innerText());
await lateLeaf.click();
await settle();
expect('fila abre /history?age=late', new URL(page.url()).search === '?age=late');
expect('fila destacada', (await lateLeaf.getAttribute('aria-current')) === 'page');
expect('filtro Prazo reflete a fila', (await page.inputValue('#age')) === 'late');

// 5. Ficha: "No status há" e idade zerada ao mudar o status.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
const summary = page.locator('.dl-summary span:has(> .dl-summary__label:has-text("No status há"))');
expect('ficha mostra "No status há" com a idade', (await summary.textContent())?.includes('4 d 4 h'), await summary.textContent());
await page.screenshot({ path: `${OUT}/prazo-ficha.png` });
await page.click('.hpsm-tab:has-text("Análise")');
await page.selectOption('#triage-status', 'IN_REVIEW');
await settle(600);
const after = await summary.textContent();
expect('mudar o status zera a idade', after?.includes('0 min') && (await summary.locator('.hpsm-status__bullet').count()) === 0, after);
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('concluída não mostra "No status há"', (await summary.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nprazo: tudo ok');
process.exit(failures ? 1 : 0);
