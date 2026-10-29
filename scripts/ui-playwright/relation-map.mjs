// Mapa de relacoes (91): aba Mapa na ficha (nos por tipo, cor pelo veredito,
// rotulo da ligacao, "+N" na legenda), lista equivalente (grupos, motivos,
// links), clicar abre a ficha/indicador, "Expandir" pelo teclado sem mexer no
// que ja estava, mapa vazio, mapa do caso e usuario comum.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const ent = (id, label, verdict) => ({ id: `entry:${id}`, kind: 'ENTRY', label, entryId: id, type: 'FILE', status: 'COMPLETED', verdict });
const ioc = (kind, value) => ({ id: `ioc:${kind}:${value}`, kind: 'IOC', label: value, iocKind: kind, value });
state.graphs = {
  '/api/entries/e2/graph': {
    center: 'entry:e2',
    nodes: [
      ent('e2', 'Página de login falsa do banco', 'MALICIOUS'),
      ioc('DOMAIN', 'evil.top'),
      ent('e1', 'instalador_suspeito.exe', 'SUSPICIOUS'),
      ent('e4', 'driver_update.msi', 'CLEAN'),
      { id: 'case:cs1', kind: 'CASE', label: 'CASO-0001 · Campanha do boleto', caseId: 'cs1', code: 'CASO-0001' },
    ],
    edges: [
      { from: 'entry:e2', to: 'ioc:DOMAIN:evil.top', label: 'indicador' },
      { from: 'entry:e1', to: 'ioc:DOMAIN:evil.top', label: 'indicador' },
      { from: 'entry:e2', to: 'entry:e4', label: 'parecido 82%' },
      { from: 'entry:e2', to: 'case:cs1', label: 'no caso' },
    ],
    hidden: { entries: 2, iocs: 0, cases: 0 },
  },
  '/api/entries/e1/graph': {
    center: 'entry:e1',
    nodes: [ent('e1', 'instalador_suspeito.exe', 'SUSPICIOUS'), ioc('DOMAIN', 'evil.top'), ioc('IPV4', '203.0.113.9'), ent('e3', 'relatorio_trimestral.docm', 'UNKNOWN')],
    edges: [
      { from: 'entry:e1', to: 'ioc:DOMAIN:evil.top', label: 'indicador' },
      { from: 'entry:e1', to: 'ioc:IPV4:203.0.113.9', label: 'indicador' },
      { from: 'entry:e1', to: 'entry:e3', label: 'mesmo arquivo' },
    ],
    hidden: { entries: 0, iocs: 4, cases: 0 },
  },
  '/api/cases/cs1/graph': {
    center: 'case:cs1',
    nodes: [
      { id: 'case:cs1', kind: 'CASE', label: 'CASO-0001 · Campanha do boleto', caseId: 'cs1', code: 'CASO-0001' },
      ent('e1', 'instalador_suspeito.exe', 'SUSPICIOUS'),
      ent('e2', 'Página de login falsa do banco', 'MALICIOUS'),
      ioc('DOMAIN', 'evil.top'),
    ],
    edges: [
      { from: 'case:cs1', to: 'entry:e1', label: 'no caso' },
      { from: 'case:cs1', to: 'entry:e2', label: 'no caso' },
      { from: 'entry:e1', to: 'ioc:DOMAIN:evil.top', label: 'indicador' },
      { from: 'entry:e2', to: 'ioc:DOMAIN:evil.top', label: 'indicador' },
    ],
    hidden: { entries: 0, iocs: 0, cases: 0 },
  },
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
const svgNode = (id) => page.locator(`.dl-map__canvas g[data-node="${id}"]`);
const listItem = (id) => page.locator(`.dl-map__list li[data-node="${id}"]`);
const at = (id) => svgNode(id).getAttribute('transform');

// 1. Aba Mapa na ficha.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
await page.click('.hpsm-tab:has-text("Mapa")');
await settle();
expect('aba Mapa abre pela URL', new URL(page.url()).search === '?tab=mapa');
expect('cinco nós no desenho', (await page.locator('.dl-map__canvas g[data-node]').count()) === 5);
expect('centro destacado', (await svgNode('entry:e2').getAttribute('class')).includes('is-center'));
expect('cor pelo veredito', (await svgNode('entry:e2').locator('circle').getAttribute('style')).includes('--dl-status-red') && (await svgNode('entry:e4').locator('circle').getAttribute('style')).includes('--dl-status-green'));
expect('indicador e caso com forma própria', (await svgNode('ioc:DOMAIN:evil.top').locator('rect').count()) === 1 && (await svgNode('case:cs1').locator('rect').count()) === 1);
expect('rótulo da ligação no desenho', (await page.locator('.dl-map__edge text').allTextContents()).includes('parecido 82%'));
expect('"+N" na legenda', (await page.locator('.dl-map__hidden').innerText()) === 'Não mostrados: +2 amostra(s)');
expect('desenho descrito para leitores de tela', (await page.locator('.dl-map__canvas svg').getAttribute('aria-label')).includes('5 itens'));

// 2. Lista equivalente.
const headings = await page.locator('.dl-map__list .hpsm-section__head').allTextContents();
expect('grupos com contagem', ['Amostras (3)', 'Indicadores (1)', 'Casos (1)'].every((h) => headings.some((x) => x.includes(h))), headings.join(' | '));
expect('motivo na lista com a outra ponta', (await listItem('entry:e4').innerText()).includes('parecido 82% (Página de login falsa do banco)'));
expect('ligação pelo indicador na lista', (await listItem('entry:e1').innerText()).includes('indicador evil.top'));
expect('centro marcado na lista', (await listItem('entry:e2').innerText()).includes('(este)'));
expect('links da lista', (await listItem('ioc:DOMAIN:evil.top').locator('a').getAttribute('href')) === '/iocs/domain/evil.top' && (await listItem('case:cs1').locator('a').getAttribute('href')) === '/casos/cs1');
await page.screenshot({ path: `${OUT}/mapa-ficha.png`, fullPage: true });

// 3. Expandir pelo teclado: entra no mesmo desenho sem mexer nos que ja estavam.
const before = { e2: await at('entry:e2'), e4: await at('entry:e4'), ioc: await at('ioc:DOMAIN:evil.top') };
await listItem('entry:e1').locator('button:has-text("Expandir")').focus();
await page.keyboard.press('Enter');
await settle();
expect('expandir traz o próximo nível', (await svgNode('entry:e3').count()) === 1 && (await svgNode('ioc:IPV4:203.0.113.9').count()) === 1);
expect('sem repetir o indicador já no mapa', (await page.locator('.dl-map__canvas g[data-node="ioc:DOMAIN:evil.top"]').count()) === 1);
expect('quem já estava não se mexe', before.e2 === (await at('entry:e2')) && before.e4 === (await at('entry:e4')) && before.ioc === (await at('ioc:DOMAIN:evil.top')));
expect('marcada como expandida com o "+N" dela', (await listItem('entry:e1').innerText()).includes('Expandida (não mostrados: +4 indicador(es))'));
const e1why = await listItem('entry:e1').innerText();
expect('motivo da expansão fica com quem foi ligado', e1why.includes('mesmo arquivo (relatorio_trimestral.docm)') && (await listItem('entry:e3').innerText()).includes('mesmo arquivo (instalador_suspeito.exe)'), e1why);
expect('lista acompanha', (await page.locator('.dl-map__list li[data-node]').count()) === 7);
await page.screenshot({ path: `${OUT}/mapa-expandido.png`, fullPage: true });

// 4. Clicar no desenho abre a ficha / o indicador.
await svgNode('ioc:DOMAIN:evil.top').click();
await settle();
expect('clicar no indicador abre o indicador', new URL(page.url()).pathname === '/iocs/domain/evil.top');
await page.goto(ORIGIN + '/entries/e2?tab=mapa', { waitUntil: 'networkidle' });
await svgNode('entry:e4').click();
await settle();
expect('clicar na amostra abre a ficha', new URL(page.url()).pathname === '/entries/e4');

// 5. Sem ligacoes.
await page.goto(ORIGIN + '/entries/e3?tab=mapa', { waitUntil: 'networkidle' });
expect('mapa vazio explica', (await page.locator('.hpsm-tabpanel:not([hidden])').innerText()).includes('Nenhuma ligação ainda'));

// 6. Mapa do caso.
await page.evaluate(() =>
  fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Campanha do boleto', entryIds: ['e1', 'e2'] }) }),
);
await page.goto(ORIGIN + '/casos/cs1', { waitUntil: 'networkidle' });
const caseMap = page.locator('.hpsm-section', { hasText: 'Mapa de relações' });
expect('seção no caso', (await caseMap.locator('g[data-node]').count()) === 4 && (await caseMap.locator('g.is-center').getAttribute('data-node')) === 'case:cs1');
expect('indicador liga as duas amostras', (await caseMap.locator('.dl-map__edge').count()) === 4);

// 7. Usuario comum tambem ve o mapa da amostra.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e2?tab=mapa', { waitUntil: 'networkidle' });
expect('usuário comum vê o mapa', (await page.locator('.dl-map__canvas g[data-node]').count()) === 5);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmapa de relações: tudo ok');
process.exit(failures ? 1 : 0);
