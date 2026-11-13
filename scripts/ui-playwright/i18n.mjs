// Idioma da interface (revisao de novembro, 2.5): seletor nas paginas publicas (guardado nesta
// maquina), preferencia da conta (vale ao entrar), troca na hora em Preferencias e volta ao
// portugues. Por enquanto so a moldura (menu, barra superior, login, preferencias, rotulos) traduz.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const state = createState({ loggedIn: false });
const browser = await chromium.launch();
// Navegador em ingles de proposito: sem escolha, a interface continua em portugues.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const leaves = () => page.locator('.hpsm-tree__label').allInnerTexts();

// 1. Navegador em ingles, sem escolha: portugues.
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
expect('sem escolha: português, mesmo com o navegador em inglês', (await page.locator('button[type=submit]').innerText()) === 'Entrar');
expect('html lang em português', (await page.evaluate(() => document.documentElement.lang)) !== 'en');

// 2. Seletor da pagina publica: ingles na hora, e lembra ao recarregar.
await page.selectOption('.dl-lang select', 'en');
expect('login em inglês', (await page.locator('button[type=submit]').innerText()) === 'Sign in' && (await page.locator('label[for=password]').innerText()).includes('Password'));
await page.reload({ waitUntil: 'networkidle' });
expect('lembra nesta máquina', (await page.locator('button[type=submit]').innerText()) === 'Sign in');
await page.screenshot({ path: `${OUT}/login-en.png` });

// 3. Entrar: a preferencia da conta (portugues) vale sobre a escolha desta maquina.
await page.fill('#email', 'ana@deeplook.test');
await page.fill('#password', 'senha-atual');
await page.click('button[type=submit]');
await page.waitForURL('**/inicio');
await page.waitForTimeout(300);
expect('logado: vale a preferência da conta (português)', (await leaves()).includes('Página Inicial'), (await leaves()).slice(0, 3).join(' | '));

// 4. Preferencias: escolhe ingles e salva; menu, papel e rotulos mudam na hora.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-language', 'en');
await page.click('.hpsm-toolbar__action:has-text("Salvar preferências")');
await page.waitForTimeout(500);
expect('preferência gravada na conta', state.preferences.language === 'en', JSON.stringify(state.preferences));
const labels = await leaves();
expect('menu em inglês', labels.includes('Home') && labels.includes('Global history') && labels.includes('Submit sample'), labels.join(' | '));
expect('mensagem de salvo no idioma novo', (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' ').includes('Preferences saved.'));
// O usuario do mock e administrador ("Admin" nos dois idiomas): o papel muda com o analista.
state.role = 'ANALYST';
await page.reload({ waitUntil: 'networkidle' });
expect('papel na barra superior em inglês', (await page.locator('.hpsm-topbar__role').innerText()).includes('Analyst'), await page.locator('.hpsm-topbar__role').innerText());
state.role = undefined;
await page.reload({ waitUntil: 'networkidle' });
await page.click('.hpsm-topbar__user-name');
const menu = (await page.locator('.hpsm-usermenu__item').allInnerTexts()).map((s) => s.trim());
expect('menu do usuário em inglês', menu.join('|') === 'My account|Change password|Preferences|Keyboard shortcuts|Sign out', menu.join('|'));
await page.keyboard.press('Escape');
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
const statuses = await page.locator('.hpsm-status').allInnerTexts();
expect('rótulos de status e veredito nas listas', statuses.some((s) => ['Pending', 'In review', 'Completed'].includes(s.trim())) && statuses.some((s) => ['Malicious', 'Suspicious', 'Clean', 'Unknown'].includes(s.trim())), statuses.slice(0, 6).join(' | '));
await page.screenshot({ path: `${OUT}/historico-en.png` });

// Dados que vem do mock como estao (erro do GitHub gravado pela API) e o nome do idioma.
const DATA = ['GitHub respondeu', 'Português (Brasil)'];
// 4b. Varredura em ingles: cabecalhos, campos, botoes, abas e textos de ajuda das telas. Dados do
// mock (titulos de amostras, nomes, comentarios) sao portugues de proposito e ficam de fora: so
// os elementos de interface sao lidos, e o que vem dos dados e reconhecido pela lista DATA.
const ROUTES = [
  '/inicio', '/history', '/me', '/submit', '/entries/e1', '/entries/e1?tab=analise',
  '/entries/e1?tab=relatorios', '/entries/e1?tab=relacionadas', '/entries/e1?tab=historico', '/inbox',
  '/casos', '/casos/cs1', '/busca?q=fatura', '/kb', '/kb/kb1', '/painel', '/revisoes', '/permitidos',
  '/atribuicao', '/gerencial', '/avisos', '/dominios-empresa', '/regras-triagem', '/yara', '/admin',
  '/admin?tab=keys', '/admin?tab=audit', '/admin?tab=backup', '/admin?tab=settings', '/admin?tab=status',
  '/admin?tab=trash', '/admin?tab=templates', '/admin?tab=tokens', '/user', '/user?tab=senha',
  '/user?tab=preferencias', '/user?tab=notificacoes', '/user?tab=2fa', '/user?tab=sessoes',
  '/user?tab=indicadores',
];
// Palavras que so existem em portugues ("do", "no" e ".com" tambem aparecem em ingles).
const PT = /[ãõçáéíóúâêô]|\b(de|da|das|dos|para|sem|uma|nas|nos|ou|em|ao|pelo|pela)\b/i;
const leaks = new Set();
for (const route of ROUTES) {
  await page.goto(ORIGIN + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  const texts = await page.evaluate(() => {
    const sel = [
      'th', 'label', 'button', 'h1', 'h2', 'h3', 'h4', 'legend', '[role=tab]',
      '.hpsm-field__label', '.hpsm-field__help', '.hpsm-section__title', '.dl-page-subtitle',
      '.hpsm-toolbar__action', '.cds--form__helper-text', 'option',
    ].map((s) => `main ${s}`).join(',');
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      // Celulas e links com dados da amostra (titulo, nome) nao entram.
      if (el.closest('td a, .dl-mono, [data-user-content]')) continue;
      const t = (el.innerText || '').trim();
      if (t && t.length < 300) out.push(t);
    }
    for (const el of document.querySelectorAll('main [placeholder]')) out.push(el.getAttribute('placeholder'));
    return out;
  });
  for (const t of texts) if (PT.test(t) && !DATA.some((d) => t.includes(d))) leaks.add(`${route}: ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
}
console.log([...leaks].join('\n'));
expect('telas em inglês, sem rótulo de interface em português', leaks.size === 0, `${leaks.size} texto(s)`);

// 5. De volta ao portugues.
await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
await page.selectOption('#pref-language', 'pt-BR');
await page.click('.hpsm-toolbar__action:has-text("Save preferences")');
await page.waitForTimeout(500);
expect('volta ao português', (await leaves()).includes('Página Inicial') && state.preferences.language === 'pt-BR');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nidioma: tudo ok');
process.exit(failures ? 1 : 0);
