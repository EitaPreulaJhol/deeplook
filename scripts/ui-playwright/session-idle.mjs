// Sessao por inatividade (30 min): atividade renova (no maximo 1x/min), aviso 2 min
// antes com contagem regressiva, "Continuar conectado", renovacao por outra janela,
// expiracao com volta ao login (mesmo com formulario alterado) e "Sair" no aviso.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

// Relogio falso no navegador; a API simulada acompanha o mesmo relogio.
const fakeBase = Date.parse('2026-10-21T12:00:00.000Z');
const realBase = Date.now();
let forwarded = 0;
state.now = async () => fakeBase + (Date.now() - realBase) + forwarded;
await page.clock.install({ time: fakeBase });
const MIN = 60_000;
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));
const forward = async (ms) => {
  forwarded += ms;
  await page.clock.fastForward(ms);
  await settle();
};

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const touches = () => state.calls.filter((c) => c === 'POST /api/auth/touch').length;
const dialog = page.locator('[role=alertdialog]:has-text("Sessão expirando")');
const countdown = () => page.locator('.dl-session-countdown').textContent();

// 1. Abrir o app conta como atividade.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await settle();
expect('abrir o app renova a sessão', touches() === 1, `${touches()} renovações`);

// 2. Sem atividade: nada aos 27 min; aviso aos 28 min com contagem regressiva.
await forward(27 * MIN);
expect('sem aviso antes dos 28 min', !(await dialog.isVisible()));
await forward(MIN + 1000);
expect('aviso 2 min antes de expirar', await dialog.isVisible());
const start = await countdown();
expect('contagem começa perto de 02:00', /^0[12]:\d\d$/.test(start ?? ''), start);
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
expect('foco em "Continuar conectado"', focused === 'Continuar conectado', focused);
await forward(30_000);
const later = await countdown();
expect('contagem regressiva anda', /^01:[23]\d$/.test(later ?? ''), later);
await page.screenshot({ path: `${OUT}/sessao-aviso.png` });

// 3. Com o aviso na tela, mexer o mouse nao renova; so o botao.
const before = touches();
await page.mouse.move(300, 300);
await page.mouse.move(400, 420);
await settle();
expect('atividade com o aviso aberto não renova', touches() === before);
await page.click('button:has-text("Continuar conectado")');
await settle();
expect('"Continuar conectado" renova e fecha o aviso', touches() === before + 1 && !(await dialog.isVisible()));

// 4. Atividade renova no maximo 1x/min.
await page.mouse.move(500, 500);
await settle();
expect('atividade logo após renovar não chama a API', touches() === before + 1);
await forward(61_000);
await page.mouse.move(520, 520);
await settle();
expect('atividade depois de 1 min renova', touches() === before + 2);

// 5. Atividade recente (dentro do minuto) renova na hora do aviso, sem mostrar a caixa.
await forward(10_000);
await page.mouse.move(540, 540);
await settle();
expect('atividade dentro do minuto não chama a API', touches() === before + 2);
await forward(28 * MIN);
expect('com atividade recente, renova em vez de avisar', touches() === before + 3 && !(await dialog.isVisible()));

// 6. Outra janela renovou: confere no servidor e nao avisa.
await forward(20 * MIN);
state.sessionExpiresAt = (await state.now()) + 30 * MIN;
await forward(9 * MIN);
expect('renovada em outra janela: sem aviso', !(await dialog.isVisible()));
expect('renovada em outra janela: sem nova renovação', touches() === before + 3);

// 7. Expira com formulario alterado: volta ao login com o aviso, sem perguntar.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.click('.hpsm-tab:has-text("Link")');
await page.fill('#url', 'https://phish.example/login');
await forward(28 * MIN + 1000); // atividade recente: renova
await forward(28 * MIN + 1000); // agora sem atividade: avisa
expect('aviso também com formulário alterado', await dialog.isVisible());
await forward(2 * MIN + 1000);
await page.waitForURL('**/login', { timeout: 5000 }).catch(() => {});
expect('expirou: volta ao login', new URL(page.url()).pathname === '/login', page.url());
const notice = await page.locator('.hpsm-msg__text').allTextContents();
expect(
  'login mostra "Sua sessão expirou por inatividade"',
  notice.some((t) => t.includes('Sua sessão expirou por inatividade')),
  notice.join(' | '),
);
expect('sem pergunta de alterações não salvas', !(await page.locator('.hpsm-modal').isVisible()));
await page.screenshot({ path: `${OUT}/sessao-expirada.png` });

// 8. "Sair" no aviso encerra a sessao.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await forward(28 * MIN + 1000); // digitar no login (deslogado) nao conta como atividade
expect('aviso após novo login', await dialog.isVisible());
await page.click('.hpsm-modal button:has-text("Sair")');
await page.waitForURL('**/login', { timeout: 5000 }).catch(() => {});
expect('"Sair" encerra a sessão', state.calls.includes('POST /api/auth/logout') && !state.loggedIn);
expect('"Sair" volta ao login', new URL(page.url()).pathname === '/login');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nsessão por inatividade: tudo ok');
process.exit(failures ? 1 : 0);
