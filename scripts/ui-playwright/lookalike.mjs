// Dominios parecidos com os da empresa (92): aviso na ficha (dominio, motivo,
// onde; texto puro), tela pela pasta Deteccao (dominios, variacoes vistas com
// as amostras), admin inclui (validacao, normalizado pela API) e exclui com
// confirmacao; analista so ve; usuario comum sem a tela.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
entries[1].lookalikeHits = [
  { domain: 'ernpresa.com.br', companyDomain: 'empresa.com.br', reason: 'HOMOGLYPH', detail: null, sources: ['URL', 'LINK'] },
  { domain: '<b>x</b>empresa.top', companyDomain: 'empresa.com.br', reason: 'KEYWORD', detail: '"<b>x</b>"', sources: ['SENDER'] },
];
const domains = [{ id: 'cd1', domain: 'empresa.com.br', createdAt: '2026-10-29T10:00:00.000Z', createdBy: { id: 'u1', displayName: 'Ana Souza' } }];
const seen = [
  { domain: 'ernpresa.com.br', companyDomain: 'empresa.com.br', reason: 'HOMOGLYPH', label: 'letras parecidas', detail: null, sources: ['URL', 'LINK'], total: 7, lastSeen: '2026-10-29T10:00:00.000Z', entries: [{ id: 'e2', title: 'Página de login falsa do banco', verdict: 'MALICIOUS' }, { id: 'e1', title: 'instalador_suspeito.exe', verdict: 'SUSPICIOUS' }] },
  { domain: 'empreza.com.br', companyDomain: 'empresa.com.br', reason: 'TYPO', label: 'erro de digitação', detail: 'letra trocada', sources: ['IOC'], total: 1, lastSeen: '2026-10-28T10:00:00.000Z', entries: [{ id: 'e4', title: 'driver_update.msi', verdict: 'CLEAN' }] },
];
const calls = [];
await setupMock(context, state);
await context.route((url) => url.pathname.startsWith('/api/company-domains'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (state.role === 'USER') return json(403, { error: 'Somente analistas veem os domínios parecidos.' });
  if (req.method() === 'GET') return json(200, { domains, seen, max: 20 });
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  calls.push({ method: req.method(), path, body });
  if (req.method() === 'POST') {
    if (body.domain === 'nada') return json(400, { error: 'Dados invalidos.', details: { domain: ['domínio inválido (ex.: empresa.com.br)'] } });
    const item = { id: `cd${domains.length + 1}`, domain: 'empresa.com', createdAt: '2026-10-29T11:00:00.000Z', createdBy: { id: 'u1', displayName: 'Ana Souza' } };
    domains.push(item);
    return json(201, { item });
  }
  domains.splice(domains.findIndex((d) => path.endsWith(d.id)), 1);
  return json(200, { ok: true });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const msgs = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');

// 1. Aviso na ficha.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
const warn = page.locator('.dl-lookalike');
const text = (await warn.innerText()).replace(/\s+/g, ' ');
expect('aviso na ficha', text.includes('Domínio parecido com o da empresa'), text);
expect('domínio, motivo e onde', text.includes('ernpresa.com.br parecido com empresa.com.br (letras parecidas) — link enviado, link do e-mail'), text);
expect('detalhe e remetente', text.includes('(nome com palavra a mais: "<b>x</b>") — remetente'), text);
expect('texto puro', (await warn.locator('b').count()) === 0);
await page.screenshot({ path: `${OUT}/parecidos-ficha.png` });
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('sem achados, sem aviso', (await page.locator('.dl-lookalike').count()) === 0);

// 2. Tela pela pasta Deteccao.
await page.click('#hpsm-tree-deteccao .hpsm-tree__leaf:has-text("Domínios da empresa")');
await settle();
expect('abre pela pasta Detecção', new URL(page.url()).pathname === '/dominios-empresa');
expect('domínio cadastrado', (await page.locator('.dl-company-domains li').first().innerText()).includes('empresa.com.br'));
const rows = (await page.locator('table[aria-label="Variações vistas"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
expect('variações vistas com motivo e onde', rows[0].includes('ernpresa.com.br') && rows[0].includes('letras parecidas') && rows[0].includes('link enviado, link do e-mail'), rows[0]);
expect('amostras com veredito e "+N"', rows[0].includes('Página de login falsa do banco') && rows[0].includes('Malicioso') && rows[0].includes('(+5)'), rows[0]);
expect('detalhe do erro', rows[1].includes('erro de digitação: letra trocada') && rows[1].includes('indicador sugerido'), rows[1]);
expect('amostra abre a ficha', (await page.locator('table[aria-label="Variações vistas"] a').first().getAttribute('href')) === '/entries/e2');

// 3. Admin inclui (validacao) e exclui (confirmacao).
await page.click('button:has-text("Incluir")');
await settle(200);
expect('domínio obrigatório', calls.length === 0 && (await page.locator('.hpsm-field--invalid').count()) === 1);
await page.fill('#company-domain', 'nada');
await page.click('button:has-text("Incluir")');
await settle();
expect('erro da API no campo', (await page.locator('.hpsm-field--invalid').count()) === 1 && (await msgs()).includes('domínio inválido'), await msgs());
await page.fill('#company-domain', 'https://www.empresa.com/');
await page.keyboard.press('Enter');
await settle();
expect('Enter inclui', calls.at(-1)?.body?.domain === 'https://www.empresa.com/' && (await msgs()).includes('empresa.com incluído e posto na lista de permissões'), await msgs());
expect('lista atualiza', (await page.locator('.dl-company-domains li').count()) === 2);
await page.screenshot({ path: `${OUT}/parecidos-tela.png`, fullPage: true });
await page.locator('.dl-company-domains li', { hasText: 'empresa.com ' }).or(page.locator('.dl-company-domains li').nth(1)).first().locator('button:has-text("Excluir")').click();
await settle(300);
const dlg = page.locator('[role=alertdialog]');
expect('confirmação ao excluir', (await dlg.innerText()).includes('sai da lista de permissões'));
await dlg.locator('button:has-text("Excluir")').click();
await settle();
expect('excluído', calls.at(-1)?.method === 'DELETE' && (await page.locator('.dl-company-domains li').count()) === 1);

// 4. Analista so ve.
state.role = 'ANALYST';
await page.goto(ORIGIN + '/dominios-empresa', { waitUntil: 'networkidle' });
expect('analista vê sem incluir/excluir', (await page.locator('#company-domain').count()) === 0 && (await page.locator('.dl-company-domains button').count()) === 0 && (await page.locator('table[aria-label="Variações vistas"] tbody tr').count()) === 2);

// 5. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/dominios-empresa', { waitUntil: 'networkidle' });
expect('usuário comum sem a tela', new URL(page.url()).pathname !== '/dominios-empresa');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndomínios parecidos: tudo ok');
process.exit(failures ? 1 : 0);
