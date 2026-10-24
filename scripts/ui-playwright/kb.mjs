// Base de conhecimento (63): item no navegador, novo artigo (obrigatorios,
// pre-visualizacao segura do Markdown, Ctrl+S), leitura, editar, busca e
// categoria, "Ir para:" pelo titulo, artigos no relatorio (campo e links),
// usuario comum so le e excluir com confirmacao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, reports, setupMock, watchErrors } from './mock-api.mjs';

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
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim());

const BODY = [
  '# Visão geral',
  '',
  'Trojan **bancário** com *DLL sideloading* e `msiexec`.',
  '',
  '- chega por e-mail',
  '- instala via MSI',
  '',
  '> Não clique em http://evil.example/login',
  '',
  'Leia [o alerta](https://www.gov.br/cert), a [ficha interna](/history?q=grandoreiro) e [isto](javascript:alert(1)).',
  '',
  '<script>window.hacked = true</script>',
].join('\n');

// 1. Navegador e lista vazia.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.locator('.hpsm-tree__leaf:has-text("Base de conhecimento")').click();
await settle();
expect('abre /kb', new URL(page.url()).pathname === '/kb');
expect('lista vazia', (await messages()).includes('A base de conhecimento ainda está vazia.'));

// 2. Novo artigo.
await button('Novo artigo').click();
await settle();
expect('abre /kb/novo', new URL(page.url()).pathname === '/kb/novo');
await button('Salvar artigo').click();
await settle(300);
expect('obrigatórios destacados', (await page.locator('.hpsm-field--invalid').count()) === 3 && state.kbCalls.length === 0);
await page.fill('#kb-title', 'Grandoreiro');
await page.fill('#kb-summary', 'Trojan bancário brasileiro distribuído por phishing com anexo.');
await page.selectOption('#kb-category', 'MALWARE_FAMILY');
await page.fill('#kb-tags', 'banker, brasil');
await page.fill('#kb-body', BODY);
await settle(200);
const preview = page.locator('.dl-kb-preview .dl-markdown');
expect('pré-visualização: título vira h2', (await preview.locator('h2').innerText()) === 'Visão geral');
expect('negrito, itálico e código', (await preview.locator('strong').first().innerText()) === 'bancário' && (await preview.locator('em').count()) === 1 && (await preview.locator('code').first().innerText()) === 'msiexec');
expect('lista', (await preview.locator('ul li').count()) === 2);
expect('URL solta não vira link', (await preview.locator('blockquote a').count()) === 0 && (await preview.locator('blockquote').innerText()).includes('http://evil.example/login'));
const anchors = await preview.locator('a').evaluateAll((els) => els.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })));
expect('só links http(s) e internos', JSON.stringify(anchors.map((a) => a.href)) === '["https://www.gov.br/cert","/history?q=grandoreiro"]', JSON.stringify(anchors));
expect('link externo em nova aba sem opener', anchors[0].target === '_blank' && anchors[0].rel.includes('noopener'));
expect('HTML do texto não é interpretado', (await preview.locator('script').count()) === 0 && (await preview.innerText()).includes('<script>') && !(await page.evaluate(() => window.hacked)));
await page.screenshot({ path: `${OUT}/kb-editor.png`, fullPage: true });
await page.keyboard.press('Control+s');
await settle();
const created = state.kbCalls.at(-1);
expect('Ctrl+S salva', created?.method === 'POST' && JSON.stringify(created.body.tags) === '["banker","brasil"]' && created.body.category === 'MALWARE_FAMILY', JSON.stringify(created));
expect('abre o artigo', new URL(page.url()).pathname === '/kb/kb1', page.url());

// 3. Leitura e edicao.
expect('título da página', (await page.locator('.dl-page-header').innerText()) === 'Grandoreiro');
expect('aba do workspace com o título', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('Grandoreiro'));
expect('categoria no resumo', (await page.locator('.dl-summary').innerText()).includes('Família de malware'));
expect('corpo desenhado', (await page.locator('.dl-kb-body h2').innerText()) === 'Visão geral');
await page.screenshot({ path: `${OUT}/kb-artigo.png`, fullPage: true });
await button('Editar').click();
await settle();
expect('editar carrega o artigo', (await page.inputValue('#kb-title')) === 'Grandoreiro' && (await page.inputValue('#kb-tags')) === 'banker, brasil');
await page.fill('#kb-summary', 'Trojan bancário que usa MSI e DLL sideloading.');
await button('Salvar artigo').click();
await settle();
expect('edição por PATCH', state.kbCalls.at(-1)?.method === 'PATCH' && new URL(page.url()).pathname === '/kb/kb1');
expect('alterações listadas', (await page.locator('.hpsm-section:has-text("Alterações")').innerText()).includes('Ana Souza'));

// 4. Busca e categoria.
state.kbArticles.push({ id: 'kb2', title: 'Golpe do falso boleto', summary: 'Boleto adulterado.', category: 'SCAM', tags: ['boleto'], body: 'Confira o beneficiário.', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z', createdBy: { id: 'u2', displayName: 'Bruno Lima' }, updatedBy: { id: 'u2', displayName: 'Bruno Lima' }, canDelete: false, revisions: [], reports: [{ id: 'r1', updatedAt: '2026-10-21T10:00:00.000Z', analyst: { id: 'u2', displayName: 'Bruno Lima' }, entry: { id: 'e2', title: 'Página de login falsa do banco', verdict: 'MALICIOUS' } }], citations: 1 });
await page.goto(ORIGIN + '/kb', { waitUntil: 'networkidle' });
const cards = page.locator('.dl-kb-card');
expect('dois artigos', (await cards.count()) === 2);
expect('citações no cartão', (await cards.filter({ hasText: 'Golpe do falso boleto' }).innerText()).includes('Citado em 1 relatório'));
await page.fill('#kb-q', 'sideloading');
await settle(800);
expect('busca no texto', (await cards.count()) === 1 && new URL(page.url()).searchParams.get('q') === 'sideloading');
await page.fill('#kb-q', '');
await settle(800);
await page.selectOption('#kb-category', 'SCAM');
await settle();
expect('filtro por categoria', (await cards.count()) === 1 && (await cards.first().innerText()).includes('Golpe'));
await page.goto(ORIGIN + '/kb/kb2', { waitUntil: 'networkidle' });
expect('citado em (relatórios publicados)', (await page.locator('table[aria-label="Relatórios que citam o artigo"] tbody tr').count()) === 1);
expect('outro autor: sem Excluir', (await button('Excluir').count()) === 0);

// 5. "Ir para:" pelo titulo exato.
await page.fill('#dl-quick-search', 'grandoreiro');
await page.press('#dl-quick-search', 'Enter');
await settle();
expect('Ir para: abre o artigo', new URL(page.url()).pathname === '/kb/kb1', page.url());
await page.fill('#dl-quick-search', 'kb: boleto');
await page.press('#dl-quick-search', 'Enter');
await settle();
expect('Ir para: "kb:" busca na base', new URL(page.url()).pathname === '/kb' && new URL(page.url()).searchParams.get('q') === 'boleto');

// 6. Relatorio: campo e links.
reports[0].kbArticles = [{ id: 'kb2', title: 'Golpe do falso boleto' }];
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('relatório mostra o artigo', (await page.locator('.hpsm-field:has-text("Base de conhecimento") a').getAttribute('href')) === '/kb/kb2');
await page.fill('#report-kb', 'grando');
await settle(800);
const opts = page.locator('.dl-attack-picker__list [role=option]');
expect('busca na base pelo campo', (await opts.count()) === 1 && (await opts.first().innerText()).includes('Grandoreiro'));
await page.press('#report-kb', 'Enter');
await page.fill('#report-summary', 'Mesmo padrão do Grandoreiro.');
await page.locator('.hpsm-toolbar__action:has-text("Salvar relatório")').click();
await settle();
expect('relatório envia os artigos', JSON.stringify(state.lastReportBody?.kbArticleIds) === '["kb1"]', JSON.stringify(state.lastReportBody));

// 7. Excluir o proprio.
await page.goto(ORIGIN + '/kb/kb1', { waitUntil: 'networkidle' });
await button('Excluir').click();
await settle(300);
await page.locator('[role=alertdialog] button:has-text("Excluir")').click();
await settle();
expect('excluído e volta à lista', state.kbCalls.at(-1)?.method === 'DELETE' && new URL(page.url()).pathname === '/kb', JSON.stringify(state.kbCalls.at(-1)) + ' ' + page.url() + ' ' + (await page.locator('[role=alertdialog]').count()));

// 8. Usuario comum: so le.
state.role = 'USER';
await page.goto(ORIGIN + '/kb', { waitUntil: 'networkidle' });
expect('usuário comum vê a base', (await cards.count()) === 1 && (await button('Novo artigo').count()) === 0);
await page.goto(ORIGIN + '/kb/kb2', { waitUntil: 'networkidle' });
expect('sem Editar', (await button('Editar').count()) === 0);
await page.goto(ORIGIN + '/kb/novo', { waitUntil: 'networkidle' });
expect('novo artigo recusado', (await messages()).includes('Somente analistas escrevem na base de conhecimento.'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nbase de conhecimento: tudo ok');
process.exit(failures ? 1 : 0);
