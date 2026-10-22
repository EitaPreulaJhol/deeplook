// Duplicatas (34): "Mais > Marcar como duplicata…" com as relacionadas sugeridas,
// ID invalido, marcacao (resumo, historico, marca na grade, secao na principal),
// desfazer com confirmacao e item oculto para quem nao e analista.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const byId = (id) => entries.find((e) => e.id === id);
state.related.e3 = {
  items: [
    { entry: byId('e1'), score: 100, reasons: [{ kind: 'SAME_SHA256' }] },
    { entry: byId('e4'), score: 15, reasons: [{ kind: 'SHARED_TAGS', detail: ['malware'] }] },
  ],
  total: 2,
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
const settle = (ms = 400) => page.waitForTimeout(ms);
const more = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]');
const menuItem = (label) => page.locator(`.hpsm-ctxmenu button:has-text("${label}")`);
const dialog = page.locator('[role=dialog]:has-text("Marcar como duplicata")');
const summary = () => page.locator('.dl-summary').innerText();
const messages = () => page.locator('.hpsm-msg__text').allTextContents();

// 1. Caixa com as relacionadas sugeridas.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await more.click();
await menuItem('Marcar como duplicata…').click();
await settle();
expect('caixa abre', await dialog.isVisible());
const options = await dialog.locator('.dl-dup-option__title').allTextContents();
expect('relacionadas sugeridas + "outra"', options.join('|') === 'instalador_suspeito.exe|driver_update.msi|Outra amostra (ID ou link):', options.join('|'));
expect('primeira sugestão escolhida e com foco', await page.evaluate(() => document.activeElement?.getAttribute('value') === 'e1' && document.activeElement.checked));
const reason = await dialog.locator('.dl-dup-option__reason').first().textContent();
expect('motivo da sugestão', reason === 'Mesmo arquivo (SHA-256)', reason);
await page.screenshot({ path: `${OUT}/duplicata-caixa.png` });

// 2. ID invalido mostra o erro na caixa; Esc fecha.
await dialog.locator('.hpsm-modal__input').fill('https://deeplook.test/entries/nao-existe');
await dialog.locator('button:has-text("Marcar")').click();
await settle();
expect('ID inválido: erro na caixa', (await dialog.locator('.dl-dup-error').textContent()) === 'Amostra principal: amostra não encontrada.');
expect('foco volta ao campo do ID', await page.evaluate(() => document.activeElement?.classList.contains('hpsm-modal__input')));
await page.keyboard.press('Escape');
expect('Esc fecha', !(await dialog.isVisible()));

// 3. Marcar como duplicata da sugestao.
await more.click();
await menuItem('Marcar como duplicata…').click();
await settle();
await dialog.locator('button:has-text("Marcar")').click();
await settle(600);
expect('mensagem de sucesso', (await messages()).includes('Marcada como duplicata de "instalador_suspeito.exe".'));
const sum = (await summary()).replace(/\s+/g, ' ');
expect('resumo: duplicata de + concluída + veredito da principal', sum.includes('Duplicata de: instalador_suspeito.exe') && sum.includes('Status: Concluído') && sum.includes('Veredito: Suspeito'), sum);
await page.click('.hpsm-tab:has-text("Histórico")');
await settle();
expect('histórico registra', (await page.locator('tbody').innerText()).includes('Marcada como duplicata de "instalador_suspeito.exe"'));

// 4. Grade e principal.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
expect('marca "duplicata" na grade', (await page.locator('tbody tr:has-text("relatorio_trimestral.docm") .dl-dup-tag').count()) === 1);
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('principal: "Duplicatas: 1"', (await summary()).replace(/\s+/g, ' ').includes('Duplicatas: 1'));
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Duplicatas (1)"))');
expect('principal: seção com link', (await section.locator('a').textContent()) === 'relatorio_trimestral.docm');
await page.screenshot({ path: `${OUT}/duplicata-principal.png` });
await section.locator('a').click();
await settle();
expect('link abre a duplicata', new URL(page.url()).pathname === '/entries/e3');

// 5. Desfazer.
await more.click();
expect('menu oferece "Desfazer duplicata"', await menuItem('Desfazer duplicata').isVisible());
await menuItem('Desfazer duplicata').click();
await page.locator('[role=alertdialog] button:has-text("Desfazer")').click();
await settle(600);
const after = (await summary()).replace(/\s+/g, ' ');
expect('desfazer restaura status e veredito', !after.includes('Duplicata de') && after.includes('Status: Pendente') && after.includes('Veredito: Desconhecido'), after);
expect('mensagem do desfazer', (await messages()).includes('A amostra deixou de ser duplicata.'));

// 6. Quem nao e analista nao ve a acao.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await more.click();
expect('usuário comum não vê "Marcar como duplicata"', (await menuItem('Marcar como duplicata').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nduplicatas: tudo ok');
process.exit(failures ? 1 : 0);
