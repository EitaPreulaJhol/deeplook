// Comparar amostras (58): "Comparar as 2" na barra de selecao (so com duas),
// pagina lado a lado (linhas que diferem destacadas, linhas vazias escondidas),
// listas so de A / em comum / so de B, trocar os lados, mesmo conteudo,
// "Comparar com..." no menu Mais da ficha (sugestoes, id, mesma amostra) e
// usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const bar = page.locator('.hpsm-bulkbar');
const rowCheck = (title) => page.locator(`tbody tr:has-text("${title}") input[type=checkbox]`);
const compareButton = bar.locator('button:has-text("Comparar as 2")');
const more = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]');
const menuItem = (label) => page.locator(`.hpsm-ctxmenu button:has-text("${label}")`);

state.compareLists = {
  urls: { common: ['http://shared.test/x'], onlyA: ['http://c2.evil.test/a', 'http://c2.evil.test/b'], onlyB: [] },
  iocs: { common: ['IPV4:185.199.1.7'], onlyA: ['DOMAIN:c2.evil.test'], onlyB: ['SHA256:' + 'b'.repeat(64)] },
  attack: { common: [], onlyA: ['T1566.001 Spearphishing Attachment'], onlyB: ['T1486 Data Encrypted for Impact'] },
};

// 1. Barra de selecao: so com exatamente duas.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await rowCheck('instalador_suspeito.exe').check();
expect('uma marcada: sem comparar', (await compareButton.count()) === 0);
await rowCheck('relatorio_trimestral.docm').check();
expect('duas marcadas: Comparar as 2', (await compareButton.count()) === 1);
await rowCheck('driver_update.msi').check();
expect('três marcadas: sem comparar', (await compareButton.count()) === 0);
await rowCheck('driver_update.msi').uncheck();
await compareButton.click();
await settle();
const url = new URL(page.url());
expect('abre /comparar com as duas', url.pathname === '/comparar' && [url.searchParams.get('a'), url.searchParams.get('b')].sort().join(',') === 'e1,e3', page.url());

// 2. Lado a lado.
await page.goto(ORIGIN + '/comparar?a=e1&b=e3', { waitUntil: 'networkidle' });
expect('aba do workspace', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('Comparar amostras'));
expect('subtítulo com as duas', (await page.locator('.dl-page-subtitle').innerText()) === 'A: instalador_suspeito.exe × B: relatorio_trimestral.docm');
const table = page.locator('table[aria-label="Campos lado a lado"]');
const row = (label) => table.locator('tbody tr').filter({ has: page.locator(`td:first-child:text-is("${label}"), td:first-child:has-text("${label} (difere)")`) });
const labels = (await table.locator('tbody tr td:first-child').allInnerTexts()).map((t) => t.replace(' (difere)', '').trim());
expect('linhas sem valor escondidas (URL, PE)', !labels.includes('URL') && !labels.includes('PE') && labels.includes('SHA-256') && labels.includes('Tamanho'), labels.join('|'));
expect('veredito difere (destacado)', (await row('Veredito').getAttribute('class'))?.includes('is-diff'));
expect('tipo igual (sem destaque)', !(await row('Tipo').getAttribute('class'))?.includes('is-diff'));
expect('link para a amostra', (await row('Amostra').locator('a').first().getAttribute('href')) === '/entries/e1');

// 3. Listas.
const sections = page.locator('.dl-compare-list');
expect('só as listas com itens', (await sections.count()) === 3 && JSON.stringify(await sections.evaluateAll((els) => els.map((e) => e.dataset.list))) === '["iocs","attack","urls"]');
const urls = page.locator('.dl-compare-list[data-list="urls"]');
const heads = (await urls.locator('.dl-compare-list__head').allInnerTexts()).map((t) => t.trim());
expect('colunas com contagem', JSON.stringify(heads) === '["Só em A (2)","Em comum (1)","Só em B (0)"]', JSON.stringify(heads));
expect('título com o comum', (await page.locator('.hpsm-section__head:has-text("URLs nas strings")').innerText()).includes('1 em comum'));
const iocText = (await page.locator('.dl-compare-list[data-list="iocs"] .dl-compare-list__col--a li').first().innerText()).replace(/\s+/g, ' ');
expect('IOC com o tipo', iocText === 'DOMAIN c2.evil.test', iocText);
await page.screenshot({ path: `${OUT}/comparar.png`, fullPage: true });

// 4. Trocar os lados.
await page.locator('.hpsm-toolbar__action:has-text("Trocar os lados")').click();
await settle();
const swapped = new URL(page.url()).searchParams;
expect('trocar os lados', swapped.get('a') === 'e3' && swapped.get('b') === 'e1' && state.lastCompare === '?a=e3&b=e1', state.lastCompare);

// 5. Mesmo conteudo.
const savedSha = entries[2].sha256;
entries[2].sha256 = entries[0].sha256;
await page.goto(ORIGIN + '/comparar?a=e1&b=e3', { waitUntil: 'networkidle' });
expect('aviso de mesmo conteúdo', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.startsWith('As duas têm o mesmo conteúdo')));
expect('SHA-256 igual sem destaque', !(await row('SHA-256').getAttribute('class'))?.includes('is-diff'));
entries[2].sha256 = savedSha;

// 6. "Comparar com..." na ficha.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
await menuItem('Comparar com…').click();
await settle(300);
const dialog = page.locator('[role=dialog]:has-text("Comparar com outra amostra")');
expect('caixa abre', await dialog.isVisible());
await dialog.locator('.hpsm-modal__input').fill('https://deeplook.test/entries/e1');
await dialog.locator('button:has-text("Comparar")').click();
await settle(300);
expect('mesma amostra: erro na caixa', (await dialog.locator('.dl-dup-error').textContent()) === 'Escolha uma amostra diferente desta.');
await dialog.locator('.hpsm-modal__input').fill('e4');
await dialog.locator('button:has-text("Comparar")').click();
await settle();
expect('abre a comparação com a outra', new URL(page.url()).pathname === '/comparar' && new URL(page.url()).search === '?a=e1&b=e4', page.url());
await page.goto(ORIGIN + '/comparar?a=e1&b=nada', { waitUntil: 'networkidle' });
expect('amostra inexistente', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('Amostra nao encontrada')));
await page.goto(ORIGIN + '/comparar', { waitUntil: 'networkidle' });
expect('sem parâmetros: como usar', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.startsWith('Escolha as amostras pelo')));

// 7. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/comparar?a=e1&b=e3', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/comparar', page.url());
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
expect('sem "Comparar com…" no menu', (await menuItem('Comparar com…').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncomparar: tudo ok');
process.exit(failures ? 1 : 0);
