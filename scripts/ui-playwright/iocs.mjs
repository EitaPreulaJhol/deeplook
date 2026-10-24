// Indicadores (31, 32): "Ir para:" reconhece IOCs (inclusive desarmados) e abre a
// ficha; ficha com tipo, valor, aparicoes e grade navegavel; ficha vazia e
// invalida; "Indicadores reconhecidos" na aba Relatorios com links; IOCs em comum
// da aba Relacionadas como links; exportacao CSV/STIX/MISP pelo menu "Mais".
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const state = createState({ loggedIn: true });
const byId = (id) => entries.find((e) => e.id === id);
state.entryIocs.e1 = [
  { kind: 'SHA256', value: byId('e1').sha256, source: 'SAMPLE', reportIds: [] },
  { kind: 'DOMAIN', value: 'updater-cdn.example', source: 'REPORT', reportIds: ['r1'] },
  { kind: 'IPV4', value: '185.0.2.10', source: 'REPORT', reportIds: ['r1'] },
];
state.iocDetails['IPV4:185.0.2.10'] = {
  ioc: { kind: 'IPV4', value: '185.0.2.10' },
  items: [
    { entry: byId('e1'), sightings: [{ kind: 'REPORT', reportId: 'r1', analyst: 'Bruno Lima', createdAt: '2026-10-20T13:00:00.000Z' }] },
    { entry: byId('e2'), sightings: [{ kind: 'REPORT', reportId: 'r9', analyst: 'Ana Souza', createdAt: '2026-10-21T09:00:00.000Z' }] },
  ],
  total: 2,
  firstSeen: '2026-10-19T09:30:00.000Z',
  lastSeen: '2026-10-21T09:00:00.000Z',
};
state.iocDetails['DOMAIN:evil-cdn.example'] = {
  ioc: { kind: 'DOMAIN', value: 'evil-cdn.example' },
  items: [{ entry: byId('e2'), sightings: [{ kind: 'URL_HOST' }] }],
  total: 1,
  firstSeen: '2026-10-19T09:30:00.000Z',
  lastSeen: '2026-10-19T09:30:00.000Z',
};
state.related.e2 = {
  items: [{ entry: byId('e1'), score: 100, reasons: [{ kind: 'SHARED_IOCS', detail: ['185.0.2.10', 'updater-cdn.example'] }] }],
  total: 1,
  limit: 50,
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
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
const quick = async (text) => {
  await page.fill('#dl-quick-search', text);
  await page.press('#dl-quick-search', 'Enter');
  await settle(600);
};

// 1. Aba Relatorios: indicadores reconhecidos com links.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
const head = page.locator('.hpsm-section__head:has-text("Indicadores reconhecidos")');
expect('seção "Indicadores reconhecidos (3)"', (await head.textContent())?.includes('Indicadores reconhecidos (3)'));
const kinds = await page.locator('.dl-ioc-list__kind').allTextContents();
expect('tipos listados', kinds.join('|') === 'SHA-256|Domínio|IPv4', kinds.join('|'));
const sources = await page.locator('.dl-ioc-list__source').allTextContents();
expect('origem de cada um', sources.join('|') === 'amostra|relatório|relatório');
await page.click('.dl-ioc-list a:has-text("185.0.2.10")');
await settle();
expect('link abre a ficha do indicador', url() === '/iocs/ipv4/185.0.2.10', url());

// 2. Ficha do indicador.
const title = await page.locator('.dl-page-head h1, .dl-page-head h2').first().textContent();
expect('título com tipo e valor', title?.trim() === 'IPv4: 185.0.2.10', title);
const summary = (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ');
expect('resumo: aparições e total', summary.includes('Primeira aparição: 19/10/2026') && summary.includes('Última aparição: 21/10/2026') && summary.includes('Amostras: 2'), summary);
expect('botão de copiar o valor', (await page.locator('.dl-ioc-value button').count()) === 1);
const where = await page.locator('tbody .dl-related-reasons li').allTextContents();
expect('onde aparece', where[0].startsWith('Relatório de Bruno Lima (20/10/2026') && where[1].startsWith('Relatório de Ana Souza'), where.join(' | '));
const tab = await page.locator('.hpsm-doctab.is-active, .hpsm-doctab[aria-current="page"]').first().textContent().catch(() => '');
expect('aba de documento "IOC · 185.0.2.10"', (tab ?? '').includes('IOC · 185.0.2.10'), tab);
await page.screenshot({ path: `${OUT}/ioc-ficha.png` });
await page.locator('tbody tr').first().focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await settle();
expect('setas + Enter abrem a amostra', url() === '/entries/e2', url());
expect('Anterior/Próxima pelas amostras da ficha', (await page.locator('.hpsm-toolbar__info').textContent())?.trim() === 'Registro 2 de 2');

// 3. Ficha vazia e invalida.
await page.goto(ORIGIN + '/iocs/domain/nada.example', { waitUntil: 'networkidle' });
expect('ficha vazia avisa', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.startsWith('Este indicador ainda não apareceu')));
await page.goto(ORIGIN + '/iocs/url/x.example', { waitUntil: 'networkidle' });
expect('tipo inválido avisa', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.startsWith('Indicador inválido')));

// 4. "Ir para:" reconhece indicadores.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await quick('hxxps://Evil-CDN[.]example/login');
expect('URL desarmada abre a ficha do domínio', url() === '/iocs/domain/evil-cdn.example', url());
await quick('185.0.2.10');
expect('IP abre a ficha', url() === '/iocs/ipv4/185.0.2.10', url());
await quick('192.168.0.1');
expect('IP privado cai na busca por texto', url() === '/busca?q=192.168.0.1', url());
await quick('driver');
expect('texto vai para a Busca', url() === '/busca?q=driver', url());
expect('placeholder cita IOC', (await page.getAttribute('#dl-quick-search', 'placeholder')) === 'ID, SHA-256, IOC ou texto (Ctrl+K)');

// 5. Relacionadas: IOCs em comum viram links (sem abrir a amostra da linha).
await page.goto(ORIGIN + '/entries/e2?tab=relacionadas', { waitUntil: 'networkidle' });
const links = await page.locator('.dl-related-reasons a').allTextContents();
expect('IOCs em comum como links', links.join('|') === '185.0.2.10|updater-cdn.example', links.join('|'));
await page.click('.dl-related-reasons a:has-text("185.0.2.10")');
await settle();
expect('link abre a ficha, não a amostra', url() === '/iocs/ipv4/185.0.2.10', url());

// 6. Exportar IOCs pelo menu "Mais".
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await page.click('.hpsm-toolbar__action[aria-haspopup="menu"]');
const labels = (await page.locator('.hpsm-ctxmenu button').allTextContents()).map((t) => t.trim());
expect('itens de exportação', ['Exportar IOCs (CSV)', 'Exportar IOCs (STIX 2.1)', 'Exportar IOCs (MISP)'].every((l) => labels.includes(l)), labels.join('|'));
for (const [label, format, file] of [
  ['Exportar IOCs (STIX 2.1)', 'stix', 'deeplook-e1-iocs.stix.json'],
  ['Exportar IOCs (MISP)', 'misp', 'deeplook-e1-iocs.misp.json'],
  ['Exportar IOCs (CSV)', 'csv', 'deeplook-e1-iocs.csv'],
]) {
  if (!(await page.locator('.hpsm-ctxmenu').isVisible())) await page.click('.hpsm-toolbar__action[aria-haspopup="menu"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.hpsm-ctxmenu button:has-text("${label}")`)]);
  expect(`${label}: arquivo e formato`, download.suggestedFilename() === file && state.lastIocExport === format, `${download.suggestedFilename()} / ${state.lastIocExport}`);
}

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nindicadores: tudo ok');
process.exit(failures ? 1 : 0);
