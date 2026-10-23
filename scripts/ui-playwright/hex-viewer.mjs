// Visualizador hexadecimal (57): secao na aba Analise, carrega sob demanda,
// linhas offset | hex | texto, cabecalho conhecido destacado, "Mostrar mais 4 KB"
// ate o limite, expurgado mostra o aviso, usuario comum nao ve a aba.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const content = Buffer.alloc(6000);
Buffer.from('MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode.', 'latin1').copy(content);
for (let i = 64; i < content.length; i++) content[i] = (i * 7) % 256;
state.fileBytes.e1 = content;
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Conteúdo (hex)"))');

await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
expect('seção na aba Análise', (await section.count()) === 1);
expect('só carrega quando pedido', !state.calls.some((c) => c.startsWith('HEX')));
await section.locator('button:has-text("Mostrar conteúdo")').click();
await settle();
const lines = section.locator('.dl-hex__line');
expect('256 linhas de 16 bytes (4 KB)', (await lines.count()) === 256, await lines.count());
const first = (await lines.first().innerText()).replace(/\s+/g, ' ').trim();
expect('primeira linha: offset, bytes e texto', first.startsWith('00000000 4D 5A 90 00 03 00 00 00 54 68 69 73 20 70 72 6F') && first.endsWith('MZ......This pro'), first);
expect('cabeçalho MZ destacado', (await section.locator('.dl-hex__byte.is-magic').count()) === 2 && (await section.locator('.dl-hex__magic').innerText()) === 'MZ — executável do Windows (PE)');
expect('informa o quanto aparece', (await section.locator('.dl-hex__info').innerText()).startsWith('Exibindo 4.0 KB de 5.9 KB'));
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/hex.png`, fullPage: true });
await section.locator('button:has-text("Mostrar mais 4 KB")').click();
await settle();
expect('mostrar mais: até o fim do arquivo', (await lines.count()) === 375 && state.calls.includes('HEX e1 4096'), await lines.count());
expect('sem "Mostrar mais" no fim', (await section.locator('button:has-text("Mostrar mais")').count()) === 0);

// Expurgado.
Object.assign(entries.find((e) => e.id === 'e4'), { storageKey: null, filePurgedAt: '2026-10-01T12:00:00.000Z' });
await page.goto(ORIGIN + '/entries/e4?tab=analise', { waitUntil: 'networkidle' });
expect('expurgado: aviso', (await section.locator('.dl-static-empty').innerText()).startsWith('Indisponível: o arquivo desta amostra foi expurgado'));

// Link: sem a secao.
await page.goto(ORIGIN + '/entries/e2?tab=analise', { waitUntil: 'networkidle' });
expect('link: sem a seção', (await section.count()) === 0);

// Usuario comum: sem a aba Analise.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
expect('usuário comum: sem a seção', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nvisualizador hex: tudo ok');
process.exit(failures ? 1 : 0);
