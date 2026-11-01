// Linguagem simples para o usuario comum (136, 137, 138, 135): situacao na ficha,
// "Arquivo" recolhido, pagina inicial sem atalhos, lista vazia diferente de filtro
// sem resultado e Enter enviando o formulario.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const state = createState({ loggedIn: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const notice = page.locator('.dl-resolution:has(.dl-resolution__title:text-is("Situação")) .dl-resolution__text');
const go = (path) => page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
const body = () => page.locator('body').innerText();

// 1. Situacao na ficha, por status e veredito.
state.role = 'USER';
const e = entries[0];
const cases = [
  ['PENDING', 'UNKNOWN', 'Recebida: a equipe de segurança ainda vai analisar esta amostra. Enquanto isso, não abra o arquivo.'],
  ['IN_REVIEW', 'UNKNOWN', 'A equipe de segurança está analisando esta amostra. Enquanto isso, não abra o arquivo.'],
  ['COMPLETED', 'MALICIOUS', 'Análise concluída: é perigosa. Por segurança, não abra o arquivo.'],
  ['COMPLETED', 'SUSPICIOUS', 'Análise concluída: é suspeita. Por segurança, não abra o arquivo.'],
  ['COMPLETED', 'CLEAN', 'Análise concluída: nada perigoso foi encontrado.'],
  ['COMPLETED', 'UNKNOWN', 'Análise concluída, sem resultado definitivo. Na dúvida, não abra o arquivo e fale com o suporte.'],
];
for (const [status, verdict, text] of cases) {
  Object.assign(e, { status, verdict, resolution: null });
  await go(`/entries/${e.id}`);
  const shown = await notice.innerText();
  expect(`${status}/${verdict}`, shown.startsWith(text), shown);
}
await page.screenshot({ path: `${OUT}/situacao-usuario.png` });
const link = entries.find((x) => x.type === 'URL');
Object.assign(link, { status: 'PENDING', resolution: null });
await go(`/entries/${link.id}`);
expect('link: fala em clicar', (await notice.innerText()).includes('não clique no link'));

Object.assign(e, { status: 'IN_REVIEW', verdict: 'UNKNOWN', owner: { ...e.owner, id: users[0].id } });
await go(`/entries/${e.id}`);
expect('quem enviou é avisado', (await notice.innerText()).includes('Você receberá um aviso quando terminar.'));
Object.assign(e, { owner: { ...e.owner, id: 'outra-pessoa' } });
await go(`/entries/${e.id}`);
expect('outra pessoa: sem promessa de aviso', !(await notice.innerText()).includes('aviso'));

Object.assign(e, { resolution: 'Seguro: pode abrir.' });
await go(`/entries/${e.id}`);
expect('com resolução, só ela', (await notice.count()) === 0 && (await body()).includes('Seguro: pode abrir.'));
Object.assign(e, { resolution: null });

// 2. Detalhes tecnicos recolhidos, mas acessiveis.
await go(`/entries/${e.id}`);
const fileHead = page.locator('.hpsm-section__head:has-text("Arquivo")').first();
expect('"Arquivo" recolhido', (await fileHead.getAttribute('aria-expanded')) === 'false');
expect('sem SHA-256 à vista', !(await page.locator('label:has-text("SHA-256")').first().isVisible().catch(() => false)));
await fileHead.click();
expect('abre com um clique', await page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Arquivo"))').getByText('SHA-256').first().isVisible());

// 3. Pagina Inicial.
await go('/inicio');
let home = await body();
expect('usuário: "Cliquei ou abri"', home.includes('Cliquei ou abri, e agora?') && home.includes('Desconecte o computador da rede'));
expect('usuário: sem atalhos', !home.includes('Atalhos:'));
expect('texto corrigido', home.includes('para que seja analisado'));

// 4. Analista: nada muda.
state.role = 'ANALYST';
await go(`/entries/${e.id}`);
expect('analista: sem situação', (await notice.count()) === 0);
expect('analista: "Arquivo" aberto', (await page.locator('.hpsm-section__head:has-text("Arquivo")').first().getAttribute('aria-expanded')) === 'true');
await go('/inicio');
home = await body();
expect('analista: atalhos e sem "Cliquei"', home.includes('Atalhos:') && !home.includes('Cliquei ou abri'));

// 5. Lista vazia x filtro sem resultado.
state.role = 'USER';
await context.route('**/api/entries?*', (route) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0, sla: { warnHours: 24, lateHours: 72 } }) }),
);
const msg = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
await go('/me');
expect('nunca enviou: diz isso', (await msg()).includes('Você ainda não enviou nenhuma amostra.'), await msg());
await page.locator('.hpsm-msg__text a:has-text("Enviar Amostra")').click();
await page.waitForTimeout(300);
expect('atalho para enviar', new URL(page.url()).pathname === '/submit');
await go('/me?status=PENDING');
expect('com filtro: nenhuma encontrada', (await msg()).includes('Nenhuma amostra encontrada.'), await msg());
await go('/history');
expect('histórico vazio', (await msg()).includes('Nenhuma amostra foi enviada ainda.'), await msg());
state.role = 'ANALYST';
await go('/history');
expect('sem linhas, sem "selecionar todas"', !(await page.locator('thead th.hpsm-grid-check input').isVisible()));
await context.unroute('**/api/entries?*');

// 6. Enter envia; na descricao, quebra linha.
state.role = 'USER';
await go('/submit');
await page.locator('[role=tab]:has-text("Link")').first().click();
await page.locator('#url-description').fill('primeira');
await page.locator('#url-description').press('Enter');
expect('descrição quebra linha', (await page.inputValue('#url-description')) === 'primeira\n' && new URL(page.url()).pathname === '/submit');
await page.locator('#url').fill('sem-protocolo');
await page.locator('#url').press('Enter');
await page.waitForTimeout(300);
expect('Enter valida', (await msg()).includes('URL suspeita') && new URL(page.url()).pathname === '/submit', await msg());
let sent = 0;
await context.route('**/api/entries/url', (route) => {
  sent += 1;
  return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ entry: { id: e.id } }) });
});
await page.locator('#url').fill('http://exemplo.top/a');
await page.locator('#url-title').fill('Link de teste');
await page.locator('#url-title').press('Enter');
await page.waitForURL(/\/entries\//, { timeout: 5000 });
expect('Enter envia uma vez', /\/entries\//.test(page.url()) && sent === 1, String(sent));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nlinguagem simples: tudo ok');
process.exit(failures ? 1 : 0);
