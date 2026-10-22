// Antivirus ClamAV (49): secao da ficha (escaneando -> infectado com a
// assinatura, motor, base, data), "Infectado" no topo, limpo sem alerta no
// topo, falha com motivo, "Escanear de novo"/"Escanear agora" so para
// analistas, secao escondida sem ClamAV e para links.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const base = { engine: 'ClamAV 1.5.4', dbVersion: 28161, dbDate: '2026-10-22T06:24:11.000Z', error: null, signature: null, scannedAt: '2026-10-22T15:00:00.000Z' };
state.antivirus.e3 = [
  { enabled: true, pending: true, scan: { ...base, status: 'PENDING', engine: null, dbVersion: null, dbDate: null } },
  { enabled: true, pending: false, scan: { ...base, status: 'INFECTED', signature: 'Win.Test.EICAR_HDB-1' } },
];
state.antivirus.e4 = { enabled: true, pending: false, scan: { ...base, status: 'CLEAN' } };
state.antivirus.e1 = { enabled: true, pending: false, scan: { ...base, status: 'ERROR', error: 'arquivo maior que o limite do ClamAV (StreamMaxLength)' } };
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Antivírus (ClamAV)"))');
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`);
const summaryText = async () => (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ');

// 1. Escaneando e depois infectado.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('escaneando', (await field('Situação').innerText()).startsWith('Escaneando...'));
expect('botão desabilitado enquanto escaneia', await section.locator('button:has-text("Escaneando...")').isDisabled());
await page.waitForFunction(() => document.querySelector('.dl-summary')?.textContent?.includes('infectado'), null, { timeout: 8000 });
expect('topo: infectado com a assinatura', (await summaryText()).includes('Antivírus: infectado (Win.Test.EICAR_HDB-1)'), await summaryText());
expect('seção: infectado em vermelho', (await field('Situação').innerText()).startsWith('Infectado: Win.Test.EICAR_HDB-1') && (await section.locator('.hpsm-status--red').count()) === 1);
expect('motor e base', (await field('Motor').innerText()) === 'ClamAV 1.5.4' && (await field('Base de assinaturas').innerText()).startsWith('28161 · 22/10/2026'));
expect('topo e seção dividem a consulta', state.antivirusGets === 2, state.antivirusGets);
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/antivirus.png`, fullPage: true });
await section.locator('button:has-text("Escanear de novo")').click();
await settle();
expect('Escanear de novo', state.calls.includes('POST /api/entries/e3/antivirus'));

// 2. Limpo: sem alerta no topo.
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('limpo em verde, sem alerta no topo', (await field('Situação').innerText()).startsWith('Limpo') && !(await summaryText()).includes('Antivírus'));

// 3. Falha com motivo.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('falha com o motivo', (await field('Situação').innerText()).startsWith('Falha: arquivo maior que o limite do ClamAV'));

// 4. Arquivo antigo, sem varredura: "Escanear agora".
state.antivirus.e1 = { enabled: true, pending: false, scan: null };
await page.reload({ waitUntil: 'networkidle' });
expect('sem varredura: explica e oferece "Escanear agora"', (await field('Situação').innerText()).startsWith('Não escaneado (enviado antes do antivírus)') && (await section.locator('button:has-text("Escanear agora")').count()) === 1);
const gets = state.antivirusGets;
await settle(3000);
expect('sem varredura pendente: não fica consultando', state.antivirusGets === gets, `${gets} -> ${state.antivirusGets}`);

// 5. Usuario comum: ve o resultado, sem botao.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('usuário vê sem o botão', (await section.count()) === 1 && (await section.locator('button:has-text("Escanear")').count()) === 0);
state.role = undefined;

// 6. Link e ClamAV desligado: sem secao.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('link: sem seção', (await section.count()) === 0);
state.antivirus.e4 = { enabled: false, pending: false, scan: null };
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('ClamAV desligado: sem seção', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nantivírus: tudo ok');
process.exit(failures ? 1 : 0);
