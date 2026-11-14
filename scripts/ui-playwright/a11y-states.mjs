// Acessibilidade (axe-core, WCAG 2.0/2.1 A e AA) nos estados que a varredura nao ve, porque ela so
// abre cada tela parada: menus abertos, dialogo de confirmacao, caixa de atalhos, formulario com
// erro de validacao (pendencias da varredura visual, item 11). Precisa do axe-core no container:
//   npm i --no-save --no-package-lock axe-core@4.10.3
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await setupMock(context, createState({ loggedIn: true }));
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
/** Violacoes do axe na pagina como esta agora (o codigo entra pelo protocolo, fora da CSP). */
const audit = async (label) => {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
  expect(`sem violação: ${label}`, violations.length === 0, violations.join(' | '));
};

// 1. Menu "Ações" de um usuario aberto.
await page.goto(ORIGIN + '/admin?tab=users', { waitUntil: 'networkidle' });
await page.locator('tbody tr').nth(1).locator('button[aria-haspopup="menu"]').click();
await settle();
await audit('menu de ações da linha');

// 2. Dialogo de confirmacao (Suspender).
await page.locator('.hpsm-ctxmenu [role=menuitem]', { hasText: 'Suspender' }).click();
await settle();
await audit('diálogo de confirmação');
await page.keyboard.press('Escape');

// 3. "Mais ▾" da ficha aberto.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]').click();
await settle();
await audit('menu "Mais" da ficha');
await page.keyboard.press('Escape');

// 4. Caixa de atalhos de teclado.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.locator('body').click({ position: { x: 900, y: 700 } });
await page.keyboard.press('?');
await settle();
await audit('caixa de atalhos');
await page.keyboard.press('Escape');

// 5. Formulario com erro de validacao (Enviar Amostra sem arquivo).
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.click('.hpsm-toolbar__action:has-text("Enviar arquivo")');
await settle();
await audit('formulário com campo inválido');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nacessibilidade nos estados: tudo ok');
process.exit(failures ? 1 : 0);
