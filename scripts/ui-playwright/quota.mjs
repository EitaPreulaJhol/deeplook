// Cota de envio (64): "Restam N envios" no Enviar Amostra (so usuario comum),
// singular, cota esgotada (aviso com o horario e botao desabilitado), 429 da API
// e analista sem nada.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const info = page.locator('.dl-quota');
const sendButton = page.locator('.hpsm-toolbar__action').first();
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

// 1. Analista: sem cota.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
expect('analista sem aviso de cota', (await info.count()) === 0 && !(await sendButton.isDisabled()));

// 2. Usuario comum com vagas.
state.role = 'USER';
state.uploadQuota = { limit: 20, used: 3, remaining: 17, resetAt: null };
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
expect('restam 17 de 20', (await info.innerText()).replace(/\s+/g, ' ').trim() === 'Restam 17 envios de 20 nas próximas 24 horas', await info.innerText());
state.uploadQuota = { limit: 20, used: 19, remaining: 1, resetAt: null };
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
expect('singular', (await info.innerText()).replace(/\s+/g, ' ').trim() === 'Resta 1 envio de 20 nas próximas 24 horas');

// 3. Recusa da API (ex.: outra aba enviou antes).
state.quotaReject = 'Você já enviou 20 amostras nas últimas 24 horas (limite para usuários comuns). A próxima libera em 2 h 5 min.';
await page.locator('[role=tab]:has-text("Link")').click();
await page.fill('#url', 'https://phish.example/login');
await sendButton.click();
await settle();
expect('mensagem do 429', (await messages()).includes(state.quotaReject), (await messages()).join(' | '));
expect('continua na tela', new URL(page.url()).pathname === '/submit');

// 4. Esgotada.
state.uploadQuota = { limit: 20, used: 20, remaining: 0, resetAt: '2026-10-24T13:05:00.000Z' };
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
expect('aviso com o horário local', (await messages()).includes('Você já enviou 20 amostras nas últimas 24 horas (limite para usuários comuns). A próxima libera às 10:05.'), (await messages()).join(' | '));
expect('botão Enviar desabilitado', await sendButton.isDisabled());
expect('sem "Restam"', (await info.count()) === 0);
await page.screenshot({ path: `${OUT}/cota-esgotada.png`, clip: { x: 0, y: 0, width: 1440, height: 300 } });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncota de envio: tudo ok');
process.exit(failures ? 1 : 0);
