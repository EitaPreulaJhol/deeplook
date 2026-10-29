// Avisos gerais (88): faixa no topo para todos (alerta e informacao, caso
// ligado, ate quando), dispensar so para a pessoa, aviso na Pagina Inicial,
// tela de gestao (publicar com validacao, limite de 3, encerrar com
// confirmacao) e usuario comum sem a gestao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const list = [
  { id: 'b1', text: 'Campanha do boleto vencido em andamento. Não abra anexos de cobrança.', level: 'WARNING', startsAt: '2026-10-29T08:00:00.000Z', expiresAt: soon, createdAt: '2026-10-29T08:00:00.000Z', createdBy: { id: 'u2', displayName: 'Bruno Lima' }, case: { id: 'cs1', number: 1, title: 'Boleto', code: 'CASO-0001' }, active: true, _count: { dismissals: 3 } },
  { id: 'b2', text: 'Manutenção do e-mail às 22h.', level: 'INFO', startsAt: '2026-10-29T09:00:00.000Z', expiresAt: soon, createdAt: '2026-10-29T09:00:00.000Z', createdBy: { id: 'u1', displayName: 'Ana Souza' }, case: null, active: true, _count: { dismissals: 0 } },
];
const dismissed = new Set();
const calls = [];
await context.route((url) => url.pathname.startsWith('/api/broadcasts'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path === '/api/broadcasts/active') return json(200, { items: list.filter((b) => b.active && !dismissed.has(b.id)) });
  if (path.endsWith('/dismiss')) {
    dismissed.add(path.split('/')[3]);
    return json(200, { ok: true });
  }
  if (state.role === 'USER') return json(403, { error: 'Somente analistas publicam avisos.' });
  if (req.method() === 'GET') return json(200, { items: list });
  calls.push({ method: req.method(), path, body });
  if (path.endsWith('/end')) {
    list.find((b) => path.includes(`/${b.id}/`)).active = false;
    return json(200, { ok: true });
  }
  list.unshift({ id: `b${list.length + 1}`, text: body.text, level: body.level, startsAt: soon, expiresAt: soon, createdAt: soon, createdBy: { id: 'u1', displayName: 'Ana Souza' }, case: null, active: true, _count: { dismissals: 0 } });
  return json(201, { item: {} });
});
await context.route('**/api/cases?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'cs1', code: 'CASO-0001', title: 'Boleto' }], total: 1 }) }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const banner = page.locator('.dl-broadcasts .dl-broadcast');

// 1. Faixa no topo.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('faixa com os dois avisos, alerta primeiro', (await banner.count()) === 2 && (await banner.first().getAttribute('class')).includes('dl-broadcast--warning'));
const first = (await banner.first().innerText()).replace(/\s+/g, ' ');
expect('texto, caso, autor e validade', first.includes('Alerta: Campanha do boleto vencido') && first.includes('(CASO-0001)') && first.includes('Bruno Lima · até'), first);
expect('caso leva ao caso', (await banner.first().locator('a').getAttribute('href')) === '/casos/cs1');
await page.screenshot({ path: `${OUT}/avisos-faixa.png` });

// 2. Dispensar.
await banner.nth(1).locator('button[aria-label^="Dispensar"]').click();
await settle();
expect('dispensar tira só aquele', (await banner.count()) === 1 && (await banner.first().innerText()).includes('Campanha do boleto'));

// 3. Pagina Inicial.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('faixa também na Página Inicial', (await banner.count()) === 1);

// 4. Gestao.
await page.click('#hpsm-tree-gestao .hpsm-tree__leaf:has-text("Avisos gerais")');
await settle();
expect('abre pela pasta Gestão', new URL(page.url()).pathname === '/avisos');
const rows = (await page.locator('table[aria-label="Avisos gerais"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('lista com nível, autor e quantos dispensaram', rows[0].includes('Alerta') && rows[0].includes('Bruno Lima') && rows[0].includes('3 pessoa(s)'), rows.join(' | '));
await page.click('button:has-text("Publicar aviso")');
await settle();
expect('texto obrigatório', calls.length === 0 && (await page.locator('.hpsm-field--invalid').count()) === 1);
await page.fill('#broadcast-text', 'Novo golpe do Pix circulando.');
await page.selectOption('#broadcast-level', 'WARNING');
await page.selectOption('#broadcast-hours', '72');
await page.selectOption('#broadcast-case', 'cs1');
await page.click('button:has-text("Publicar aviso")');
await settle();
expect('publica com os campos', JSON.stringify(calls.at(-1)?.body) === JSON.stringify({ text: 'Novo golpe do Pix circulando.', level: 'WARNING', hours: 72, caseId: 'cs1' }), JSON.stringify(calls.at(-1)?.body));
expect('3 ativos: formulário avisa o limite', (await page.locator('.hpsm-section', { hasText: 'Novo aviso' }).innerText()).includes('Já há 3 avisos ativos'));
await page.screenshot({ path: `${OUT}/avisos-gestao.png`, fullPage: true });
await page.locator('table[aria-label="Avisos gerais"] tbody tr', { hasText: 'Manutenção' }).locator('button:has-text("Encerrar")').click();
await settle(300);
const confirmBox = page.locator('[role=alertdialog]');
expect('confirmação ao encerrar', (await confirmBox.innerText()).includes('Ele sai da faixa de todos'));
await confirmBox.locator('button:has-text("Encerrar")').click();
await settle();
expect('encerrado fica apagado', calls.at(-1)?.path === '/api/broadcasts/b2/end' && (await page.locator('tr.is-off', { hasText: 'Manutenção' }).count()) === 1);

// 5. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/avisos', { waitUntil: 'networkidle' });
expect('usuário comum sem a gestão', new URL(page.url()).pathname !== '/avisos');
expect('usuário comum vê a faixa', (await banner.count()) >= 1);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\navisos gerais: tudo ok');
process.exit(failures ? 1 : 0);
