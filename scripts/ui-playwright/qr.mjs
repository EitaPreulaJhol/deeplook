// QR code (plano pos-revisao, item 2.2): a secao da ficha com o que o leitor achou na imagem, no PDF
// ou no print da pagina; "Analisar este link" cria uma amostra de link que cita a de origem; o
// analista pede a leitura de novo.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const done = (codes) => ({
  enabled: true,
  applicable: true,
  ready: true,
  scan: { status: 'DONE', codes, pages: 2, error: null, ms: 120, createdAt: '2026-11-01T10:00:00.000Z', finishedAt: '2026-11-01T10:00:01.000Z' },
});
state.qr = {
  e1: done([
    { text: 'https://boleto-falso.example/pagar?id=123', truncated: false, source: 'pdf', page: 2, url: 'https://boleto-falso.example/pagar?id=123' },
    { text: 'PIX: 00020126...chave', truncated: false, source: 'image', page: null, url: null },
  ]),
  e2: done([{ text: 'https://outro.example/', truncated: false, source: 'screenshot', page: null, url: 'https://outro.example/' }]),
  e3: { enabled: true, applicable: true, ready: true, scan: null },
};
await setupMock(context, state);
const sent = [];
await context.route(
  (url) => url.pathname === '/api/entries/url',
  (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ status: 201, json: { entry: { ...entries[1] } } });
  },
);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const section = () => page.locator('.hpsm-section', { hasText: 'QR codes' }).first();
const rows = () => section().locator('table[aria-label="QR codes lidos"] tbody tr');

// 1. Amostra com dois codigos: um endereco (no PDF) e um texto.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const text = (await section().innerText()).replace(/\s+/g, ' ');
expect('seção com o estado', text.includes('2 código(s) encontrado(s)'), text.slice(0, 200));
expect('dois códigos', (await rows().count()) === 2);
const first = (await rows().nth(0).innerText()).replace(/\s+/g, ' ');
expect('endereço e de onde veio', first.includes('https://boleto-falso.example/pagar?id=123') && first.includes('na página 2 do PDF'), first);
const second = (await rows().nth(1).innerText()).replace(/\s+/g, ' ');
expect('texto que não é endereço: sem botão', second.includes('na imagem') && (await rows().nth(1).locator('button').count()) === 0, second);

// 2. Analisar o link: amostra de link nova, que cita a de origem.
await rows().nth(0).locator('button:has-text("Analisar este link")').click();
await page.waitForURL('**/entries/e2');
expect(
  'envia o link, com a amostra de origem na descrição',
  sent.length === 1 &&
    sent[0].url === 'https://boleto-falso.example/pagar?id=123' &&
    sent[0].description.includes(entries[0].title) &&
    sent[0].description.includes('e1'),
  JSON.stringify(sent),
);
const shot = (await section().innerText()).replace(/\s+/g, ' ');
expect('na amostra de link, o código veio do print da página', shot.includes('no print da página'), shot.slice(0, 200));

// 3. Sem leitura ainda: o analista pede.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('ainda não lido', (await section().innerText()).includes('Ainda não lido.'));
await section().locator('button:has-text("Analisar agora")').click();
await page.waitForTimeout(300);
expect('pede a leitura', state.calls.includes('POST /api/entries/e3/qr'), state.calls.join(','));

// 4. Amostra sem QR code a ler (padrao do mock): a secao nao aparece.
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('sem leitura aplicável, sem seção', (await page.locator('.hpsm-section', { hasText: 'QR codes' }).count()) === 0);

// 5. Em ingles.
state.preferences = { ...state.preferences, language: 'en' };
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const en = (await section().innerText()).replace(/\s+/g, ' ');
expect('em inglês', en.includes('2 code(s) found') && en.includes('on page 2 of the PDF') && en.includes('Analyze this link'), en.slice(0, 300));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nQR code: tudo ok');
process.exit(failures ? 1 : 0);
