// Preferencias de aviso (164): aba Notificacoes na Minha Conta com os tipos do papel;
// os que pedem acao vem marcados e travados; desmarcar e salvar grava a lista; o
// usuario comum so ve os avisos dele; Preferencias de uso nao mexe na lista.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

async function open(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const state = createState({ loggedIn: true });
  state.role = role;
  await setupMock(context, state);
  const page = await context.newPage();
  watchErrors(page);
  await page.goto(ORIGIN + '/user?tab=notificacoes', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return { context, state, page };
}
const box = (page, type) => page.locator(`#notif-${type}`);

// 1. Admin: todos os tipos; travados marcados e desabilitados.
let { context, state, page } = await open('ADMIN');
expect('aba ativa pela URL', (await page.locator('[role=tab][aria-selected=true]').innerText()).trim() === 'Notificações');
expect('admin vê os 16 tipos', (await page.locator('input[id^=notif-]').count()) === 16);
expect('travado vem marcado e desabilitado', (await box(page, 'ASSIGNED').isChecked()) && (await box(page, 'ASSIGNED').isDisabled()));
expect('travado diz que sempre chega', (await page.locator('label[for=notif-YARA_PACK_UPDATE]').innerText()).includes('(sempre chega)'));
await page.screenshot({ path: `${OUT}/notificacoes.png`, fullPage: true });

// 2. Silenciar dois e salvar.
await page.locator('label[for=notif-SLA_WARN]').click();
await page.locator('label[for=notif-CASE_COMMENT]').click();
await page.locator('.hpsm-toolbar__action:has-text("Salvar notificações")').click();
await page.waitForTimeout(400);
const muted = [...state.preferences.mutedNotifications].sort().join();
expect('grava os desmarcados', muted === 'CASE_COMMENT,SLA_WARN', muted);
expect('aviso de salvo', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Notificações salvas.'));

// 3. Preferencias de uso salva sem tocar na lista.
await page.click('[role=tab]:has-text("Preferências")');
await page.waitForTimeout(300);
await page.locator('.hpsm-toolbar__action:has-text("Salvar preferências")').click();
await page.waitForTimeout(400);
const patch = state.calls.filter((c) => c === 'PATCH /api/me/preferences').length;
expect('Preferências também salvou', patch === 2, String(patch));
expect('lista de avisos continua', state.preferences.mutedNotifications.length === 2);
await page.click('[role=tab]:has-text("Notificações")');
await page.waitForTimeout(300);
expect('ao voltar, segue desmarcado', !(await box(page, 'SLA_WARN').isChecked()));
await context.close();

// 4. Usuario comum: so os avisos dele.
({ context, state, page } = await open('USER'));
const ids = await page.locator('input[id^=notif-]').evaluateAll((els) => els.map((e) => e.id.slice(6)));
expect('usuário comum só vê os dele', ids.join() === 'COMPLETED,MENTION,COMMENT,IOC_SEEN,RESOLUTION', ids.join());
await page.screenshot({ path: `${OUT}/notificacoes-usuario.png`, fullPage: true });
await context.close();

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nnotificações: tudo ok');
process.exit(failures ? 1 : 0);
