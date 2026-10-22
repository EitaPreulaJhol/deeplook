// Painel (40): indicadores com links para a lista filtrada, grafico diario
// (legenda, dica ao passar o mouse, tabela), vereditos, carga por analista,
// periodo na URL, etiqueta removivel do periodo na lista, responsavel por
// analista e escopo do usuario comum.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
const state = createState({ loggedIn: true });
const SINCE = '2026-10-16T03:00:00.000Z';
state.dashboard = {
  scope: 'all',
  since: SINCE,
  sla: { warnHours: 24, lateHours: 72 },
  byStatus: { PENDING: 5, IN_REVIEW: 3, COMPLETED: 12 },
  byVerdict: { UNKNOWN: 6, CLEAN: 4, SUSPICIOUS: 2, MALICIOUS: 8 },
  open: { warn: 4, late: 1 },
  period: { submitted: 9, completed: 7 },
  daily: [
    { day: '2026-10-16', submitted: 1, completed: 0 },
    { day: '2026-10-17', submitted: 2, completed: 1 },
    { day: '2026-10-18', submitted: 0, completed: 0 },
    { day: '2026-10-19', submitted: 3, completed: 2 },
    { day: '2026-10-20', submitted: 1, completed: 2 },
    { day: '2026-10-21', submitted: 2, completed: 1 },
    { day: '2026-10-22', submitted: 0, completed: 1 },
  ],
  workload: [
    { id: 'u2', name: 'Bruno Lima', pending: 2, inReview: 2, late: 1, completed: 5 },
    { id: 'u1', name: 'Ana Souza', pending: 1, inReview: 1, late: 0, completed: 2 },
    { id: null, name: 'Sem responsável', pending: 2, inReview: 0, late: 0, completed: 0 },
  ],
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const url = () => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search);
const kpi = (label) => page.locator(`.dl-kpi:has(.dl-kpi__label .hpsm-status:text-is("${label}"))`);

// 1. Navegador e indicadores.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Painel")');
await settle();
expect('navegador abre o Painel', url() === '/painel');
expect('fuso do navegador enviado', state.lastDashboardQuery?.includes('tz=America%2FSao_Paulo'), state.lastDashboardQuery);
const values = await page.locator('.dl-kpi__value').allTextContents();
expect('seis indicadores', values.join('|') === '5|3|4|1|9|7', values.join('|'));
const hrefs = await page.locator('.dl-kpi').evaluateAll((els) => els.map((el) => decodeURIComponent(el.getAttribute('href') ?? '')));
expect(
  'links dos indicadores',
  hrefs.join(' ') ===
    `/history?status=PENDING /history?status=IN_REVIEW /history?age=warn /history?age=late /history?submittedFrom=${SINCE} /history?completedFrom=${SINCE}`,
  hrefs.join(' '),
);
expect('dica com o limite do prazo', (await kpi('Atrasadas').locator('.dl-kpi__hint').textContent()) === 'mais de 72 h no status');
expect('dica do período em data local', (await kpi('Enviadas no período').locator('.dl-kpi__hint').textContent()) === 'desde 16/10/2026');

// 2. Grafico diario.
const legend = await page.locator('.dl-chart__legend').innerText();
expect('legenda com totais', legend.replace(/\s+/g, ' ').trim() === 'Enviadas (9) Concluídas (7)', legend);
const bars = await page.locator('.dl-chart__bar').evaluateAll((els) => els.filter((el) => el.getAttribute('d')).length);
expect('colunas só onde há valor', bars === 10, String(bars));
await page.locator('.dl-chart__hit').nth(3).hover();
await settle(200);
const tip = (await page.locator('.dl-chart__tooltip').innerText()).replace(/\s+/g, ' ').trim();
expect('dica ao passar o mouse', tip === '19/10 Enviadas: 3 Concluídas: 2', tip);
const overlaps = async (i) => {
  await page.locator('.dl-chart__hit').nth(i).hover();
  await settle(150);
  const t = await page.locator('.dl-chart__tooltip').boundingBox();
  const group = page.locator('.dl-chart svg > g:has(.dl-chart__hit)').nth(i);
  const barsBox = await group.locator('.dl-chart__bar').evaluateAll((els) =>
    els.filter((el) => el.getAttribute('d')).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }),
  );
  return barsBox.some((r) => t.x < r.x + r.w && t.x + t.width > r.x && t.y < r.y + r.h && t.y + t.height > r.y);
};
expect('dica não cobre as colunas (início e fim)', !(await overlaps(3)) && !(await overlaps(5)) && !(await overlaps(6)));
await page.locator('.dl-chart__hit').nth(3).hover();
await settle(150);
await page.screenshot({ path: `${OUT}/painel.png` });
await page.mouse.move(5, 5);
await page.click('.dl-chart__table summary');
const rows = await page.locator('.dl-chart__table tbody tr').count();
expect('visão em tabela', rows === 7);

// 3. Vereditos.
const widths = await page.locator('.dl-hbars__bar').evaluateAll((els) => els.map((el) => el.style.width));
expect('barras proporcionais (maior = 100%)', widths.join(',') === '100%,25%,50%,75%', widths.join(','));
expect('veredito leva à lista', decodeURIComponent((await page.locator('.dl-hbars__value a').first().getAttribute('href')) ?? '') === '/history?verdict=MALICIOUS');

// 4. Carga por analista.
const names = await page.locator('.hpsm-section:has-text("Carga por analista") tbody tr td:first-child').allTextContents();
expect('carga: analistas e "Sem responsável"', names.join('|') === 'Bruno Lima|Ana Souza|Sem responsável', names.join('|'));
const lateLink = page.locator('.hpsm-section:has-text("Carga por analista") tbody tr:first-child td:nth-child(4) a');
expect('atrasadas do analista em vermelho, com link', (await lateLink.getAttribute('href')) === '/history?assignee=u2&age=late' && (await page.locator('.hpsm-section:has-text("Carga por analista") tbody tr:first-child .hpsm-status--red').count()) === 1);
await page.locator('.hpsm-section:has-text("Carga por analista") tbody tr:first-child td:nth-child(2) a').click();
await settle(600);
expect('link da carga abre a lista do analista', url() === '/history?assignee=u2&status=PENDING', url());
expect('select "Responsável" com o analista escolhido', (await page.inputValue('#assignee')) === 'u2');

// 5. Etiqueta do periodo na lista.
await page.goto(ORIGIN + '/painel', { waitUntil: 'networkidle' });
await kpi('Concluídas no período').click();
await settle(600);
const chip = page.locator('.hpsm-filterbar__chip');
expect('etiqueta do período', (await chip.innerText()).replace('×', '').trim() === 'Concluídas desde 16/10/2026', await chip.innerText());
await chip.locator('button').click();
await settle(400);
expect('remover a etiqueta tira o filtro', url() === '/history' && (await chip.count()) === 0, url());

// 6. Periodo na URL.
await page.goto(ORIGIN + '/painel', { waitUntil: 'networkidle' });
await page.selectOption('#dash-period', '30');
await settle(600);
expect('período vai para a URL e para a API', url() === '/painel?dias=30' && state.lastDashboardQuery.includes('days=30'), `${url()} ${state.lastDashboardQuery}`);

// 7. Usuario comum: proprias amostras, links para Meus Uploads, sem carga.
state.role = 'USER';
await page.goto(ORIGIN + '/painel', { waitUntil: 'networkidle' });
expect('usuário: links para Meus Uploads', (await kpi('Pendentes').getAttribute('href')) === '/me?status=PENDING');
expect('usuário: sem carga por analista', (await page.locator('.hpsm-section:has-text("Carga por analista")').count()) === 0);
await kpi('Atrasadas').click();
await settle(600);
expect('Meus Uploads com etiqueta de prazo', url() === '/me?age=late' && (await page.locator('.hpsm-filterbar__chip').innerText()).includes('Atrasadas'));
state.role = undefined;

// 8. Painel como pagina inicial.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
const options = await page.locator('select option').allTextContents();
expect('preferência: Painel como página inicial', options.includes('Painel'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npainel: tudo ok');
process.exit(failures ? 1 : 0);
