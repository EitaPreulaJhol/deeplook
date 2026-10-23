// Alertas de IOC (60): Seguir/Deixar de seguir na ficha do indicador, lista
// "Indicadores que sigo" na Minha Conta (link e deixar de seguir) e a
// notificacao IOC_SEEN (texto e link para a aba Relatorios quando veio de um
// relatorio).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const button = (label) => page.locator(`.hpsm-toolbar__action:has-text("${label}")`);

// 1. Seguir na ficha do indicador.
await page.goto(ORIGIN + '/iocs/domain/evil.example.com', { waitUntil: 'networkidle' });
expect('botão Seguir', (await button('Seguir').count()) === 1);
await button('Seguir').click();
await settle();
expect('seguindo', Boolean(state.watches['DOMAIN:evil.example.com']) && (await button('Deixar de seguir').count()) === 1);
expect('aviso do seguir', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.startsWith('Seguindo: você será avisado')));
await page.screenshot({ path: `${OUT}/ioc-seguir.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });

// 2. Minha Conta > Indicadores.
state.watches['SHA256:' + 'a'.repeat(64)] = '2026-10-20T10:00:00.000Z';
await page.goto(ORIGIN + '/user?tab=indicadores', { waitUntil: 'networkidle' });
const rows = page.locator('table[aria-label="Indicadores que sigo"] tbody tr');
expect('lista com os dois', (await rows.count()) === 2);
const dom = rows.filter({ hasText: 'evil.example.com' });
expect('tipo e link', (await dom.locator('td').first().innerText()).trim() === 'Domínio' && (await dom.locator('a').getAttribute('href')) === '/iocs/domain/evil.example.com');
await page.screenshot({ path: `${OUT}/ioc-sigo.png`, fullPage: true });
await dom.locator('button:has-text("Deixar de seguir")').click();
await settle();
expect('deixar de seguir pela lista', !state.watches['DOMAIN:evil.example.com'] && (await rows.count()) === 1);

// 3. Notificacao.
state.notifications = [
  { id: 'n1', type: 'IOC_SEEN', detail: 'Domínio evil.example.com (+1) num relatório publicado', readAt: null, createdAt: '2026-10-23T10:00:00.000Z', entry: { id: 'e1', title: 'instalador_suspeito.exe' }, actor: { id: 'u2', displayName: 'Bruno Lima' } },
];
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-inbox__bell');
await settle();
const text = (await page.locator('.hpsm-inbox__item').first().innerText()).replace(/\s+/g, ' ');
expect('texto da notificação', text.includes('Indicador que você segue: Domínio evil.example.com (+1) num relatório publicado'), text);
await page.locator('.hpsm-inbox__item').first().click();
await settle();
expect('abre a aba Relatórios da amostra', new URL(page.url()).pathname + new URL(page.url()).search === '/entries/e1?tab=relatorios', page.url());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nalertas de IOC: tudo ok');
process.exit(failures ? 1 : 0);
