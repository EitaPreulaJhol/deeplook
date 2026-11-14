// Acoes do backlog de UX: dialogo de confirmacao (Revogar / Suspender), redefinir
// senha pelo admin, retorno da triagem e aviso de amostra duplicada no envio.
import { chromium } from 'playwright';

import { createState, DUPLICATE_SAMPLE, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const dialog = page.locator('[role=alertdialog]');
const called = (call) => state.calls.includes(call);

// 1. Revogar chave: "Nao" e Esc cancelam; "Revogar" executa.
await page.goto(ORIGIN + '/admin?tab=keys', { waitUntil: 'networkidle' });
const revoke = page.locator('tbody tr').first().locator('button:has-text("Revogar")');
await revoke.click();
expect('Revogar abre o diálogo', await dialog.isVisible());
expect(
  'foco inicial em "Não"',
  (await page.evaluate(() => document.activeElement?.textContent)) === 'Não',
);
await page.screenshot({ path: `${OUT}/acoes-confirmacao.png` });
await page.keyboard.press('Escape');
expect('Esc cancela sem chamar a API', !(await dialog.count()) && !called('DELETE /api/admin/activation-keys/k1'));
await revoke.click();
await dialog.locator('button:has-text("Não")').click();
expect('"Não" cancela sem chamar a API', !called('DELETE /api/admin/activation-keys/k1'));
await revoke.click();
await dialog.locator('button:has-text("Revogar")').click();
await page.waitForTimeout(400);
expect('"Revogar" chama a API', called('DELETE /api/admin/activation-keys/k1'));

// Acoes da linha de usuario ficam no menu "Acoes" (pendencias da varredura visual, item 2).
const userAction = async (row, label) => {
  await row.locator('button[aria-haspopup="menu"]').click();
  return page.locator('.hpsm-ctxmenu [role=menuitem]', { hasText: label });
};

// 2. Suspender usuario tambem pede confirmacao.
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
const suspend = await userAction(page.locator('tbody tr').nth(1), 'Suspender');
expect('Suspender em vermelho no menu', (await suspend.getAttribute('class')).includes('hpsm-ctxmenu__item--danger'));
await suspend.click();
expect('Suspender abre o diálogo', await dialog.isVisible());
await dialog.locator('button:has-text("Suspender")').click();
await page.waitForTimeout(400);
expect('Suspender confirmado chama a API', called('PATCH /api/admin/users/u2'));

// 3. Redefinir senha: confirma e mostra a senha temporaria uma vez.
expect(
  '"Redefinir senha" desabilitado para o próprio admin',
  await (await userAction(page.locator('tbody tr').first(), 'Redefinir senha')).isDisabled(),
);
await page.keyboard.press('Escape');
await (await userAction(page.locator('tbody tr').nth(1), 'Redefinir senha')).click();
await dialog.locator('button:has-text("Redefinir")').click();
await page.waitForTimeout(400);
const resetMsg = (await messages()).join(' ');
expect('senha temporária exibida', resetMsg.includes('k7Tm-Q2xa-9PwR'), resetMsg.slice(0, 60));
await page.screenshot({ path: `${OUT}/acoes-redefinir-senha.png` });

// 4. Triagem: mudar o status mostra "Registro atualizado.".
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await page.selectOption('#triage-status', 'COMPLETED');
await page.waitForTimeout(600);
expect('triagem confirma "Registro atualizado."', (await messages()).includes('Registro atualizado.'));

// 5. Envio: arquivo com o mesmo SHA-256 da amostra e1 gera o aviso de duplicata.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', {
  name: 'repetida.exe',
  mimeType: 'application/octet-stream',
  buffer: DUPLICATE_SAMPLE,
});
await page.waitForTimeout(1000);
const dupMsg = (await messages()).join(' ');
expect('aviso de amostra já enviada', dupMsg.includes('Esta amostra já foi enviada'), dupMsg.slice(0, 80));
expect('hash exibido no formulário', (await page.locator('.hpsm-readonly.dl-mono').count()) === 1);
await page.screenshot({ path: `${OUT}/acoes-duplicata.png` });

await browser.close();
process.exit(failures ? 1 : 0);
