// Sessoes ativas (61): aba Sessoes na Minha Conta com navegador, IP, entrada e
// ultimo acesso; a atual marcada e sem "Encerrar"; encerrar uma (confirmacao) e
// encerrar as outras (botao desabilitado quando so ha a atual).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const at = (h) => new Date(Date.UTC(2026, 9, 23, 12) - h * 3600000).toISOString();
state.sessions = [
  { handle: 'aaaa1111bbbb2222', device: 'Chrome no Windows', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', ip: '10.0.0.1', createdAt: at(30), lastSeenAt: at(0), expiresAt: at(-100), current: true },
  { handle: 'cccc3333dddd4444', device: 'Firefox no Linux', userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/131', ip: '10.0.0.2', createdAt: at(50), lastSeenAt: at(5), expiresAt: at(-80), current: false },
  { handle: 'eeee5555ffff6666', device: 'Safari no iOS', userAgent: 'Mozilla/5.0 (iPhone) Safari/604', ip: '203.0.113.7', createdAt: at(70), lastSeenAt: at(20), expiresAt: at(-60), current: false },
];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const rows = page.locator('table[aria-label="Sessões abertas"] tbody tr');
const others = page.locator('.hpsm-toolbar__action:has-text("Encerrar as outras sessões")');
const dialog = page.locator('[role=alertdialog]');

await page.goto(ORIGIN + '/user', { waitUntil: 'networkidle' });
await page.click('[role=tab]:has-text("Sessões")');
await settle();
expect('aba na URL', new URL(page.url()).search === '?tab=sessoes');
expect('três sessões', (await rows.count()) === 3);
const first = (await rows.first().locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('atual: navegador, marca, IP e sem ação', first[0] === 'Chrome no Windows esta sessão' && first[1] === '10.0.0.1' && first[4] === '—', first.join(' | '));
expect('User-Agent completo na dica', (await rows.first().locator('td').first().locator('span[title]').first().getAttribute('title')).includes('Chrome/130'));
await page.screenshot({ path: `${OUT}/sessoes.png`, fullPage: true });

await rows.filter({ hasText: 'Safari no iOS' }).locator('button:has-text("Encerrar")').click();
expect('encerrar pede confirmação com dispositivo e IP', (await dialog.innerText()).includes('Encerrar a sessão em Safari no iOS (203.0.113.7)?'));
await dialog.locator('button.dl-btn--danger').click();
await settle();
expect('encerrou', state.calls.includes('DELETE /api/me/sessions/eeee5555ffff6666') && (await rows.count()) === 2);

await others.click();
expect('encerrar as outras pede confirmação', (await dialog.innerText()).includes('Encerrar 1 sessão(ões) em outros navegadores?'));
await dialog.locator('button.dl-btn--danger').click();
await settle();
expect('sobra só a atual', state.calls.includes('POST /api/me/sessions/revoke-others') && (await rows.count()) === 1);
expect('aviso', (await page.locator('.hpsm-msg__text').allTextContents()).includes('1 sessão(ões) encerrada(s).'));
expect('botão desabilitado sem outras', await others.isDisabled());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nsessões: tudo ok');
process.exit(failures ? 1 : 0);
