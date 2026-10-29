// Mencoes e avisos nos casos (89): "@" no comentario do caso so com analistas,
// ids enviados so de quem continua no texto, mencao destacada na linha do
// tempo; avisos de caso na Caixa de entrada e no sininho (frase, "CASO-0001 ·
// titulo", trecho do comentario) abrindo o caso.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
users.push({ id: 'u9', email: 'davi@deeplook.test', displayName: 'Davi Rocha', role: 'USER', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00.000Z', _count: { entries: 0 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const options = page.locator('.dl-mention-list [role=option]');

await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.evaluate(() =>
  fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Campanha do boleto', entryIds: ['e1'] }) }),
);

// 1. "@" no comentario do caso: so analistas.
await page.goto(ORIGIN + '/casos/cs1', { waitUntil: 'networkidle' });
const box = page.locator('#case-comment');
await box.click();
await box.pressSequentially('Olhem isto @');
await settle();
const names = await options.allInnerTexts();
expect('lista só com analistas', names.some((n) => n.includes('Bruno Lima')) && !names.some((n) => n.includes('Davi Rocha')), names.join(', '));
await box.pressSequentially('br');
await settle();
await page.keyboard.press('Enter');
await settle(200);
expect('insere "@Nome"', (await box.inputValue()) === 'Olhem isto @Bruno Lima ', await box.inputValue());
expect('ajuda fala do aviso ao responsável', (await page.locator('.dl-case-comment').innerText()).includes('o responsável do caso é avisado'));
await box.pressSequentially('e confirmem.');
await page.click('.dl-case-comment button:has-text("Comentar")');
await settle();
const sent = state.caseCalls.at(-1);
expect('envia texto e menções', sent?.path === '/api/cases/cs1/comments' && JSON.stringify(sent.body) === JSON.stringify({ text: 'Olhem isto @Bruno Lima e confirmem.', mentions: ['u2'] }), JSON.stringify(sent?.body));
const tag = page.locator('.dl-case-timeline__comment .dl-mention-tag');
expect('menção destacada na linha do tempo', (await tag.count()) === 1 && (await tag.innerText()) === '@Bruno Lima');

// 2. Quem saiu do texto nao vai.
await box.click();
await box.pressSequentially('@br');
await settle();
await page.keyboard.press('Enter');
await settle(200);
await box.fill('Mudei de ideia, sem menção.');
await page.click('.dl-case-comment button:has-text("Comentar")');
await settle();
expect('menção apagada do texto não vai', JSON.stringify(state.caseCalls.at(-1)?.body.mentions) === '[]', JSON.stringify(state.caseCalls.at(-1)?.body));

// 3. Avisos de caso na Caixa de entrada.
const bruno = { id: 'u2', displayName: 'Bruno Lima' };
const cs = { id: 'cs1', number: 1, title: 'Campanha do boleto', code: 'CASO-0001' };
const base = { readAt: null, entry: null, case: cs, actor: bruno };
state.notifications = [
  { ...base, id: 'n1', type: 'CASE_MENTION', detail: '@Ana Souza veja os anexos.', createdAt: '2026-10-29T10:05:00.000Z' },
  { ...base, id: 'n2', type: 'CASE_COMMENT', detail: 'Achei mais dois e-mails.', createdAt: '2026-10-29T10:04:00.000Z' },
  { ...base, id: 'n3', type: 'CASE_ENTRY_ADDED', detail: '2 amostra(s)', createdAt: '2026-10-29T10:03:00.000Z' },
  { ...base, id: 'n4', type: 'CASE_ENTRY_REMOVED', detail: 'Boleto 3', createdAt: '2026-10-29T10:02:00.000Z' },
  { ...base, id: 'n5', type: 'CASE_ASSIGNED', detail: null, createdAt: '2026-10-29T10:01:00.000Z' },
  { id: 'n6', type: 'ASSIGNED', detail: null, readAt: null, createdAt: '2026-10-29T10:00:00.000Z', entry: { id: 'e1', title: 'instalador_suspeito.exe' }, case: null, actor: bruno },
];
await page.goto(ORIGIN + '/inbox', { waitUntil: 'networkidle' });
const rows = (await page.locator('table tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
expect('menção no caso com o trecho', rows[0].includes('Bruno Lima mencionou você num comentário do caso') && rows[0].includes('“@Ana Souza veja os anexos.”'), rows[0]);
expect('coluna com "CASO-0001 · título"', rows[0].includes('CASO-0001 · Campanha do boleto'));
expect('comentário no caso', rows[1].includes('comentou no caso sob sua responsabilidade') && rows[1].includes('“Achei mais dois e-mails.”'), rows[1]);
expect('amostras incluídas', rows[2].includes('incluiu 2 amostra(s) no seu caso'), rows[2]);
expect('amostra retirada', rows[3].includes('retirou "Boleto 3" do seu caso'), rows[3]);
expect('caso atribuído', rows[4].includes('atribuiu o caso a você'), rows[4]);
expect('aviso de amostra igual a antes', rows[5].includes('atribuiu a amostra a você') && rows[5].includes('instalador_suspeito.exe'), rows[5]);
expect('coluna "Amostra ou caso"', (await page.locator('table thead').innerText()).includes('Amostra ou caso'));

// 4. Abrir leva ao caso; sininho tambem.
await page.locator('table tbody tr').nth(2).click();
await settle();
expect('aviso abre o caso', new URL(page.url()).pathname === '/casos/cs1');
await page.click('.hpsm-inbox__bell');
await settle();
const first = (await page.locator('.hpsm-inbox__panel .hpsm-inbox__item').first().innerText()).replace(/\s+/g, ' ');
expect('sininho com o caso e o trecho', first.includes('CASO-0001 · Campanha do boleto') && first.includes('“@Ana Souza veja os anexos.”'), first);
await page.locator('.hpsm-inbox__panel .hpsm-inbox__item').nth(5).click();
await settle();
expect('aviso de amostra abre a amostra', new URL(page.url()).pathname === '/entries/e1');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmenções e avisos nos casos: tudo ok');
process.exit(failures ? 1 : 0);
