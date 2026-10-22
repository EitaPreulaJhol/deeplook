// Registros relacionados: aba "Relacionadas (n)" com Motivo, varios motivos na
// mesma linha, rodape com o limite, teclado (setas + Enter), Anterior/Proxima
// pela lista de relacionadas e lista vazia.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const byId = (id) => entries.find((e) => e.id === id);
state.related.e2 = {
  items: [
    {
      entry: byId('e1'),
      score: 75,
      reasons: [
        { kind: 'SAME_HOST', detail: 'banco-seguro-login.example' },
        { kind: 'SHARED_TAGS', detail: ['phishing'] },
      ],
    },
    { entry: byId('e3'), score: 40, reasons: [{ kind: 'SAME_BASE_DOMAIN', detail: 'seguro-login.example' }] },
    { entry: byId('e4'), score: 30, reasons: [{ kind: 'SHARED_TAGS', detail: ['banco', 'phishing'] }] },
    {
      entry: { ...byId('e4'), id: 'e5', title: 'beacon.dll' },
      score: 150,
      reasons: [{ kind: 'SHARED_IOCS', detail: ['185.0.2.10', 'ab'.repeat(32), 'evil-cdn.example', 'x.example'] }],
    },
  ],
  total: 75,
  limit: 50,
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const tab = page.locator('.hpsm-tab:has-text("Relacionadas")');

// 1. Rotulo da aba com o total.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('aba mostra o total', (await tab.textContent())?.trim() === 'Relacionadas (75)', await tab.textContent());

// 2. Grade com Motivo.
await tab.click();
await settle();
expect('aba fica na URL', new URL(page.url()).searchParams.get('tab') === 'relacionadas');
const headers = await page.locator('.hpsm-tabpanel th').allTextContents();
expect('primeira coluna é Motivo', headers[0] === 'Motivo', headers.join('|'));
const rows = page.locator('.hpsm-tabpanel tbody tr');
expect('4 linhas', (await rows.count()) === 4);
const firstReasons = await rows.nth(0).locator('.dl-related-reasons li').allTextContents();
expect(
  'vários motivos na mesma linha',
  firstReasons.join('|') === 'Mesmo domínio: banco-seguro-login.example|Tag em comum: phishing',
  firstReasons.join('|'),
);
const second = await rows.nth(1).locator('.dl-related-reasons li').textContent();
expect('domínio-base', second === 'Mesmo domínio-base: seguro-login.example', second);
const third = await rows.nth(2).locator('.dl-related-reasons li').textContent();
expect('tags no plural', third === 'Tags em comum: banco, phishing', third);
const iocLi = rows.nth(3).locator('.dl-related-reasons li');
const iocText = await iocLi.textContent();
expect('IOCs em comum: 3 primeiros, hash encurtado e "+N"', iocText === 'IOCs em comum: 185.0.2.10, abababababab…, evil-cdn.example (+1)', iocText);
const iocTitle = await iocLi.getAttribute('title');
expect('dica com a lista completa', iocTitle === ['185.0.2.10', 'ab'.repeat(32), 'evil-cdn.example', 'x.example'].join('\n'), JSON.stringify(iocTitle));
const foot = await page.locator('.hpsm-tabpanel .dl-table-foot').textContent();
expect('rodapé indica o limite', foot?.trim() === 'Exibindo as 4 mais relevantes de 75', foot);
await page.screenshot({ path: `${OUT}/relacionadas.png` });

// 3. Teclado: so a 1a linha no Tab; seta desce, Enter abre.
expect('só a 1ª linha entra no Tab', (await rows.nth(0).getAttribute('tabindex')) === '0' && (await rows.nth(1).getAttribute('tabindex')) === '-1');
await rows.nth(0).focus();
await page.keyboard.press('ArrowDown');
expect('seta move o foco', await rows.nth(1).evaluate((el) => el === document.activeElement));
await page.keyboard.press('Enter');
await settle();
expect('Enter abre a amostra', new URL(page.url()).pathname === '/entries/e3');
const info = await page.locator('.hpsm-toolbar__info').textContent();
expect('Anterior/Próxima percorrem as relacionadas', info?.trim() === 'Registro 2 de 4', info);

// 4. Sem relacionadas: aviso na barra.
await page.goto(ORIGIN + '/entries/e3?tab=relacionadas', { waitUntil: 'networkidle' });
const msgs = await page.locator('.hpsm-msg__text').allTextContents();
expect('lista vazia avisa', msgs.some((t) => t.startsWith('Nenhuma amostra relacionada')), msgs.join(' | '));
expect('aba com (0)', (await tab.textContent())?.trim() === 'Relacionadas (0)');

// 5. Clique abre.
await page.goto(ORIGIN + '/entries/e2?tab=relacionadas', { waitUntil: 'networkidle' });
await rows.nth(2).click();
await settle();
expect('clique abre a amostra', new URL(page.url()).pathname === '/entries/e4');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nrelacionadas: tudo ok');
process.exit(failures ? 1 : 0);
