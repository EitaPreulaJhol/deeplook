// Busca avancada (68): "Busca" no navegador e pelo "Ir para:", grupos com
// contagem, trecho destacado (sem HTML), "Ver todos" muda o tipo, periodo na
// URL, nada encontrado e o aviso de minimo de caracteres; usuario comum sem
// "Casos" no filtro.
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
const settle = (ms = 600) => page.waitForTimeout(ms);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const section = (title) => page.locator(`section.hpsm-section:has(.hpsm-section__head:has-text("${title}"))`);

state.searchResult = {
  q: 'boleto',
  type: 'all',
  groups: {
    entries: { total: 12, items: [{ id: 'e2', title: 'Página de login falsa do banco', type: 'URL', status: 'COMPLETED', verdict: 'MALICIOUS', snippet: 'Pague o ⟦boleto⟧ <script>x</script> hoje' }] },
    reports: { total: 1, items: [{ id: 'r1', status: 'PUBLISHED', verdict: 'MALICIOUS', entryId: 'e2', entryTitle: 'Página de login falsa do banco', analyst: 'Bruno Lima', snippet: 'Campanha de ⟦boletos⟧ falsos' }] },
    comments: { total: 1, items: [{ id: 'c1', createdAt: '2026-10-24T10:00:00.000Z', entryId: 'e1', entryTitle: 'instalador_suspeito.exe', author: 'Ana Souza', snippet: 'Mesmo ⟦boleto⟧ de ontem' }] },
    kb: { total: 1, items: [{ id: 'kb1', title: 'Golpe do boleto', category: 'SCAM', snippet: 'Golpe do ⟦boleto⟧' }] },
    cases: { total: 1, items: [{ id: 'cs1', number: 7, title: 'Campanha de outubro', status: 'OPEN', snippet: 'Campanha de ⟦boletos⟧' }] },
  },
};

// 1. Pelo navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.locator('.hpsm-tree__leaf:has-text("Busca")').click();
await settle();
expect('abre a Busca', new URL(page.url()).pathname === '/busca');
expect('pede ao menos 2 caracteres', (await messages()).some((t) => t.startsWith('Digite ao menos 2 caracteres')));
await page.fill('#search-q', 'boleto');
await settle(1200);
expect('termo na URL', new URL(page.url()).searchParams.get('q') === 'boleto');
expect('cinco grupos com contagem', (await page.locator('.hpsm-section__head').allInnerTexts()).map((t) => t.replace(/[−+]\s*/, '').trim()).join('|') === 'Amostras (12)|Relatórios (1)|Comentários (1)|Base de conhecimento (1)|Casos (1)', (await page.locator('.hpsm-section__head').allInnerTexts()).join('|'));
const mark = section('Amostras').locator('mark').first();
expect('trecho destacado', (await mark.innerText()) === 'boleto');
expect('HTML do trecho é texto', (await section('Amostras').locator('script').count()) === 0 && (await section('Amostras').locator('.dl-search-snippet').innerText()).includes('<script>'));
expect('links certos', (await section('Relatórios').locator('a').first().getAttribute('href')) === '/entries/e2?tab=relatorios' && (await section('Casos').locator('a').first().innerText()).startsWith('CASO-0007'));
await page.screenshot({ path: `${OUT}/busca.png`, fullPage: true });

// 2. "Ver todos" e periodo.
await section('Amostras').locator('button:has-text("Ver todos os 12 em Amostras")').click();
await settle();
expect('ver todos muda o tipo', new URL(page.url()).searchParams.get('type') === 'entries' && state.lastSearch.includes('type=entries'), state.lastSearch);
await page.selectOption('#search-days', '30');
await settle();
expect('período na consulta', state.lastSearch.includes('days=30'), state.lastSearch);

// 3. Nada encontrado.
state.searchResult = { q: 'zzz', type: 'all', groups: { entries: { total: 0, items: [] } } };
await page.goto(ORIGIN + '/busca?q=zzz', { waitUntil: 'networkidle' });
expect('nada encontrado', (await messages()).includes('Nada encontrado para "zzz".'));

// 4. "Ir para:" com texto livre.
state.searchResult = null;
await page.fill('#dl-quick-search', 'driver');
await page.press('#dl-quick-search', 'Enter');
await settle();
expect('Ir para: texto abre a Busca', new URL(page.url()).pathname + new URL(page.url()).search === '/busca?q=driver' && (await page.inputValue('#search-q')) === 'driver');

// 5. Usuario comum: sem "Casos" no filtro.
state.role = 'USER';
await page.goto(ORIGIN + '/busca?q=driver', { waitUntil: 'networkidle' });
const options = await page.locator('#search-type option').allInnerTexts();
expect('usuário comum sem Casos', !options.includes('Casos') && options.includes('Relatórios'), options.join('|'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nbusca: tudo ok');
process.exit(failures ? 1 : 0);
