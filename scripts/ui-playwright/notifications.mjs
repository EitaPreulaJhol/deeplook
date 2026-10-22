// Caixa de entrada (36) e mencoes (37): sininho com contador, painel (teclado,
// abrir marca como lida, marcar todas), item no navegador, pagina Caixa de
// entrada (filtro, teclado) e "@" no campo de atualizacao (lista, setas/Enter,
// Esc, ids enviados, destaque do "@Nome" no historico).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const bruno = { id: 'u2', displayName: 'Bruno Lima' };
state.notifications = [
  { id: 'n1', type: 'ASSIGNED', detail: null, readAt: null, createdAt: '2026-10-22T10:00:00.000Z', entry: { id: 'e1', title: 'instalador_suspeito.exe' }, actor: bruno },
  { id: 'n2', type: 'MENTION', detail: '@Ana Souza pode revisar o hash?', readAt: null, createdAt: '2026-10-22T09:00:00.000Z', entry: { id: 'e2', title: 'Página de login falsa do banco' }, actor: bruno },
  { id: 'n3', type: 'COMPLETED', detail: 'MALICIOUS', readAt: '2026-10-21T12:00:00.000Z', createdAt: '2026-10-21T11:00:00.000Z', entry: { id: 'e4', title: 'driver_update.msi' }, actor: bruno },
];
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
const bell = page.locator('.hpsm-inbox__bell');
const panel = page.locator('.hpsm-inbox__panel');
const badge = page.locator('.hpsm-inbox__badge');
const focused = () => page.evaluate(() => document.activeElement?.className ?? '');

// 1. Sininho e navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
expect('contador no sininho', (await badge.textContent()) === '2');
expect('rótulo acessível', (await bell.getAttribute('aria-label')) === 'Caixa de entrada: 2 não lidas');
const leaf = page.locator('.hpsm-tree a:has-text("Caixa de entrada")');
expect('"Caixa de entrada (2)" no navegador', (await leaf.innerText()).replace(/\s+/g, ' ').trim() === 'Caixa de entrada (2)', await leaf.innerText());

// 2. Painel.
await bell.click();
await settle();
expect('painel abre', await panel.isVisible());
const titles = await panel.locator('.hpsm-inbox__title').allTextContents();
expect(
  'frases das notificações',
  titles.join('|') === 'Bruno Lima atribuiu a amostra a você|Bruno Lima mencionou você numa atualização|Bruno Lima concluiu a sua amostra (veredito: Malicioso)',
  titles.join('|'),
);
expect('foco na primeira notificação', (await focused()).includes('hpsm-inbox__item'));
expect('não lidas destacadas', (await panel.locator('.hpsm-inbox__item.is-unread').count()) === 2);
expect('trecho da menção', (await panel.locator('.hpsm-inbox__detail').first().textContent()) === '“@Ana Souza pode revisar o hash?”');
await page.screenshot({ path: `${OUT}/caixa-entrada-painel.png` });
await page.keyboard.press('Escape');
expect('Esc fecha e volta ao sininho', !(await panel.isVisible()) && (await focused()).includes('hpsm-inbox__bell'));

// 3. Abrir a mencao: vai para o Historico da amostra e marca como lida.
await bell.click();
await settle();
await panel.locator('.hpsm-inbox__item:has-text("mencionou")').click();
await settle(600);
expect('menção abre o Histórico da amostra', url() === '/entries/e2?tab=historico', url());
expect('abrir marca como lida', state.notifications.find((n) => n.id === 'n2').readAt !== null && (await badge.textContent()) === '1');

// 4. Marcar todas.
await bell.click();
await settle();
await panel.locator('button:has-text("Marcar todas como lidas")').click();
await settle();
expect('marcar todas zera o contador', (await badge.count()) === 0 && (await bell.getAttribute('aria-label')) === 'Caixa de entrada');

// 5. Pagina Caixa de entrada.
state.notifications[0].readAt = null;
await panel.locator('button:has-text("Ver todas")').click();
await settle(600);
expect('"Ver todas" abre a Caixa de entrada', url() === '/inbox', url());
expect('aba de documento', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('Caixa de entrada'));
expect('três notificações na grade', (await page.locator('tbody tr').count()) === 3);
await page.locator('label[for="inbox-only-unread"]').click();
await settle();
expect('filtro só não lidas', (await page.locator('tbody tr').count()) === 1);
await page.screenshot({ path: `${OUT}/caixa-entrada.png` });
await page.locator('tbody tr').first().focus();
await page.keyboard.press('Enter');
await settle(600);
expect('Enter abre a amostra', url() === '/entries/e1', url());

// 6. Mencoes no campo de atualizacao.
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
const field = page.locator('#comment-text');
const list = page.locator('.dl-mention-list');
await field.click();
await page.keyboard.type('Oi @br');
await settle();
expect('"@br" abre a lista filtrada', (await list.locator('li').allTextContents()).join('|') === '@Bruno Lima');
expect('combobox expandido', (await field.getAttribute('aria-expanded')) === 'true');
await page.keyboard.press('Escape');
expect('Esc fecha só a lista', !(await list.isVisible()) && (await field.inputValue()) === 'Oi @br');
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace');
await settle();
expect('"@" sozinho lista as pessoas ativas', (await list.locator('li').allTextContents()).join('|') === '@Bruno Lima');
await page.keyboard.press('Enter');
await settle();
expect('Enter insere "@Nome "', (await field.inputValue()) === 'Oi @Bruno Lima ');
await page.keyboard.type('pode revisar?');
await page.keyboard.press('Enter');
expect('Enter sem lista = nova linha', (await field.inputValue()) === 'Oi @Bruno Lima pode revisar?\n');
await page.keyboard.press('Control+KeyS');
await settle(600);
expect('ids das menções enviados', JSON.stringify(state.lastCommentBody?.mentions) === '["u2"]', JSON.stringify(state.lastCommentBody));
const tag = page.locator('tr.dl-history-comment .dl-mention-tag');
expect('"@Bruno Lima" destacado no histórico', (await tag.textContent()) === '@Bruno Lima');
await page.screenshot({ path: `${OUT}/mencao.png` });

// Mencao apagada do texto antes de salvar nao vai.
await field.click();
await page.keyboard.type('@b');
await settle();
await page.keyboard.press('Tab');
await field.fill('mudei de ideia');
await page.keyboard.press('Control+KeyS');
await settle(600);
expect('menção removida do texto não é enviada', JSON.stringify(state.lastCommentBody?.mentions) === '[]', JSON.stringify(state.lastCommentBody));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncaixa de entrada: tudo ok');
process.exit(failures ? 1 : 0);
