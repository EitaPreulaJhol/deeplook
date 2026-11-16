// Visualizador hexadecimal (57): secao na aba Detalhes (so analistas), carrega sob demanda,
// linhas offset | hex | texto, cabecalho conhecido destacado, "Mostrar mais 4 KB"
// ate o fim, expurgado mostra o aviso, usuario comum nao ve a secao. Busca por texto e por bytes,
// salto para a posicao achada ou digitada, com o trecho destacado (ajustes-usabilidade, item 7).
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const content = Buffer.alloc(6000);
Buffer.from('MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode.', 'latin1').copy(content);
for (let i = 64; i < content.length; i++) content[i] = (i * 7) % 256;
// Para a busca (plans/ajustes-usabilidade, item 7): um URL em ASCII e o mesmo em UTF-16.
Buffer.from('HTTP://c2.evil.example').copy(content, 5000);
Buffer.from('http://c2.evil.example', 'utf16le').copy(content, 5500);
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
expect('não fica mais na aba Análise', (await section.count()) === 0);
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('seção na aba Detalhes, logo depois de Arquivo', (await section.count()) === 1 && (await page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Arquivo")) + .hpsm-section .hpsm-section__head').first().innerText()).includes('Conteúdo (hex)'));
expect('só carrega quando pedido', !state.calls.some((c) => c.startsWith('HEX')));
await section.locator('button:has-text("Mostrar conteúdo")').click();
await settle();
const lines = section.locator('.dl-hex__line');
expect('256 linhas de 16 bytes (4 KB)', (await lines.count()) === 256, await lines.count());
const first = (await lines.first().innerText()).replace(/\s+/g, ' ').trim();
expect('primeira linha: offset, bytes e texto', first.startsWith('00000000 4D 5A 90 00 03 00 00 00 54 68 69 73 20 70 72 6F') && first.endsWith('MZ......This pro'), first);
expect('cabeçalho MZ destacado', (await section.locator('.dl-hex__byte.is-magic').count()) === 2 && (await section.locator('.dl-hex__magic').innerText()) === 'MZ — executável do Windows (PE)');
expect('informa o trecho e o quanto aparece', (await section.locator('.dl-hex__info').innerText()).startsWith('Exibindo 0x00000000–0x00000FFF (4.0 KB de 5.9 KB)'), await section.locator('.dl-hex__info').innerText());
expect('no começo: sem "anteriores"', (await section.locator('button:has-text("anteriores")').count()) === 0);
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/hex.png`, fullPage: true });
await section.locator('button:has-text("Mostrar mais 4 KB")').click();
await settle();
expect('mostrar mais: até o fim do arquivo', (await lines.count()) === 375 && state.calls.includes('HEX e1 4096'), await lines.count());
expect('sem "Mostrar mais" no fim', (await section.locator('button:has-text("Mostrar mais")').count()) === 0);

// Busca por texto: as duas codificacoes, e o salto destaca os bytes e o texto.
const search = section.locator('search form.dl-hex__search');
await search.getByLabel('Buscar no arquivo').fill('HTTP://C2');
await search.locator('button[type="submit"]').click();
const status = section.locator('.dl-hex__results [role="status"]');
await status.waitFor();
const hits = section.locator('.dl-hex__hits li');
expect(
  'texto: duas posições, ASCII e UTF-16, pedidas ao servidor',
  (await status.innerText()) === '2 posição(ões):' &&
    (await hits.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | ') === '0x00001388 texto | 0x0000157C UTF-16' &&
    state.hexSearches.at(-1) === 'q=HTTP%3A%2F%2FC2&kind=text',
  (await hits.allInnerTexts()).join(' | '),
);
await hits.nth(1).locator('button').click();
await settle();
expect(
  'salto: o trecho começa 8 linhas antes, com os 18 bytes destacados',
  (await section.locator('.dl-hex__info').innerText()).startsWith('Exibindo 0x000014F0') &&
    (await section.locator('.dl-hex__byte.is-match').count()) === 18 &&
    (await section.locator('.dl-hex__text .is-match').allInnerTexts()).join('') === 'h.t.t.p.:././.c.2.' &&
    (await hits.nth(1).locator('button').getAttribute('aria-current')) === 'location',
  JSON.stringify({
    info: await section.locator('.dl-hex__info').innerText(),
    bytes: await section.locator('.dl-hex__byte.is-match').count(),
    text: (await section.locator('.dl-hex__text .is-match').allInnerTexts()).join(''),
    current: await hits.nth(1).locator('button').getAttribute('aria-current'),
  }),
);
const scrolled = await section.locator('pre.dl-hex').evaluate((pre) => {
  const line = pre.querySelector('.dl-hex__line.has-mark');
  const top = line.offsetTop - pre.scrollTop;
  return top >= 0 && top < pre.clientHeight;
});
expect('a linha destacada fica à vista dentro da caixa', scrolled);
await section.locator('button:has-text("Mostrar os 4 KB anteriores")').click();
await settle();
expect('anteriores: o trecho ganha os 4 KB de antes', (await section.locator('.dl-hex__info').innerText()).startsWith('Exibindo 0x000004F0–0x0000176F (4.6 KB'), await section.locator('.dl-hex__info').innerText());
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/hex-busca.png`, fullPage: true });

// Busca por bytes.
await search.getByLabel('Bytes (hex)').check();
await search.getByLabel('Buscar no arquivo').fill('4D 5A 90');
await search.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('.dl-hex__results [role="status"]')?.textContent === '1 posição(ões):');
expect('bytes: o cabeçalho MZ, no começo', (await hits.allInnerTexts()).join('') .replace(/\s+/g, ' ') === '0x00000000 bytes' && state.hexSearches.at(-1) === 'q=4D+5A+90&kind=bytes');
await search.getByLabel('Buscar no arquivo').fill('nada-disso');
await search.getByLabel('Texto').check();
await search.locator('button[type="submit"]').click();
await page.waitForFunction(() => document.querySelector('.dl-hex__results [role="status"]')?.textContent?.startsWith('Nada encontrado'));
expect('nada achado: o aviso, sem lista', (await hits.count()) === 0);

// Ir para a posicao: hex ou decimal; invalido e depois do fim, o motivo no campo.
const goto = section.locator('form.dl-hex__goto');
await goto.getByLabel('Ir para a posição').fill('0x1388');
await goto.locator('button[type="submit"]').click();
await settle();
expect('ir para 0x1388: o trecho dela, com o byte destacado', (await section.locator('.dl-hex__info').innerText()).startsWith('Exibindo 0x00001300') && (await section.locator('.dl-hex__byte.is-match').count()) === 1);
await goto.getByLabel('Ir para a posição').fill('xyz');
await goto.locator('button[type="submit"]').click();
expect('posição inválida: o motivo, ligado ao campo', (await goto.locator('.cds--form-requirement').innerText()) === 'Use 0x1A30 ou 6704.' && (await goto.getByLabel('Ir para a posição').getAttribute('aria-invalid')) === 'true');
await goto.getByLabel('Ir para a posição').fill('999999');
await goto.locator('button[type="submit"]').click();
expect('depois do fim: o motivo', (await goto.locator('.cds--form-requirement').innerText()) === 'Depois do fim do arquivo.');

// Expurgado.
Object.assign(entries.find((e) => e.id === 'e4'), { storageKey: null, filePurgedAt: '2026-10-01T12:00:00.000Z' });
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('expurgado: aviso', (await section.locator('.dl-static-empty').innerText()).startsWith('Indisponível: o arquivo desta amostra foi expurgado'));

// Link: sem a secao.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('link: sem a seção', (await section.count()) === 0);

// Usuario comum: a rota do hex e so de analistas, entao a secao nao aparece nos Detalhes.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('usuário comum: sem a seção', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nvisualizador hex: tudo ok');
process.exit(failures ? 1 : 0);
