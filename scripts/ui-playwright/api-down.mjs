// API fora do ar / ainda subindo: o proxy (nginx) devolve 502 em HTML. O login
// mostra uma mensagem clara (e nao "Unexpected token '<'... is not valid JSON");
// quando a API volta, o login funciona.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const state = createState({ loggedIn: false });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim());

// Rotas da pagina tem prioridade sobre as do contexto (mock): simula o nginx.
const nginx502 = (route) =>
  route.fulfill({
    status: 502,
    contentType: 'text/html',
    body: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.27.5</center></body></html>',
  });
await page.route('**/api/auth/login', nginx502);

await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', state.password);
await page.locator('button:has-text("Entrar")').click();
await page.waitForTimeout(500);
const shown = await messages();
expect(
  'mensagem clara com a API fora',
  shown.some((t) => t.startsWith('A API não respondeu (erro 502). Se o DeepLook acabou de ser iniciado')),
  shown.join(' | '),
);
expect('sem o erro de JSON', !shown.some((t) => t.includes('is not valid JSON')));
expect('continua no login', new URL(page.url()).pathname === '/login');
await page.screenshot({ path: `${OUT}/api-fora.png`, clip: { x: 0, y: 0, width: 1280, height: 420 } });

// A API voltou: o mesmo login entra.
await page.unroute('**/api/auth/login', nginx502);
await page.locator('button:has-text("Entrar")').click();
await page.waitForTimeout(800);
expect('com a API de volta, entra', new URL(page.url()).pathname !== '/login', page.url());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nAPI fora do ar: tudo ok');
process.exit(failures ? 1 : 0);
