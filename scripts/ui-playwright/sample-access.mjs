// Acesso as amostras (122 e 123): usuario comum so ve "Baixar amostra" nas
// proprias e so o nome de quem enviou nas dos outros; analista baixa e ve o
// e-mail; o download aparece na auditoria. Plano pos-revisao, item 2.1: o botao baixa o ZIP com a
// senha "infected"; o arquivo original fica no menu Mais, com confirmacao.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

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
const download = page.locator('.hpsm-toolbar :text-is("Baixar amostra (ZIP)")');
const settle = (ms = 300) => page.waitForTimeout(ms);
const openMore = async () => {
  await page.click('.hpsm-toolbar__action[aria-haspopup="menu"]:has-text("Mais")');
  await settle(200);
};
const originalItem = page.locator('.hpsm-ctxmenu button:has-text("Baixar arquivo original…")');
// O arquivo original: a API simulada nao tem a rota; aqui ela responde como a de verdade (anexo).
const downloads = [];
await page.route(
  (url) => url.pathname.endsWith('/download'),
  (route) => {
    downloads.push(new URL(route.request().url()).search);
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="setup_v2.exe"' },
      body: 'MZ',
    });
  },
);
const submitted = async () =>
  (await page.locator('.hpsm-field', { hasText: 'Enviado por' }).first().innerText()).replace(/\s+/g, ' ');

// A amostra e1 e de Bruno Lima; a e3, da Ana Souza (a pessoa logada).
expect('analista: base do teste', entries[0].ownerId === 'u2' && entries[2].ownerId === 'u1');

// 1. Analista: baixa a de qualquer pessoa e ve o e-mail.
const loaded = await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
// Garante que a CSP de producao esta valendo nos cenarios: ela barra script inline.
expect('cenários sob a CSP de produção', (loaded.headers()['content-security-policy'] ?? '').includes("script-src 'self'"));
expect('analista baixa a amostra de outra pessoa', (await download.count()) === 1);
expect('analista vê o e-mail', (await submitted()).includes('Bruno Lima (bruno@deeplook.test)'), await submitted());

// 1b. ZIP com senha no botão; o original pelo menu Mais, com confirmação.
const link = page.locator('a.hpsm-toolbar__action:has-text("Baixar amostra (ZIP)")');
expect('botão baixa o ZIP', (await link.getAttribute('href')) === '/api/entries/e1/download?format=zip', await link.getAttribute('href'));
expect('dica do botão explica a senha', ((await link.getAttribute('title')) ?? '').startsWith('ZIP com a senha infected'), await link.getAttribute('title'));
expect('senha escrita ao lado do botão', (await page.locator('.hpsm-toolbar__note').innerText()) === 'senha: infected');
await openMore();
expect('menu Mais com "Baixar arquivo original…"', (await originalItem.count()) === 1);
await originalItem.click();
const dialog = page.locator('[role=alertdialog]:has-text("Baixar o arquivo original?")');
expect('pede confirmação e explica o risco', (await dialog.innerText()).includes('o antivírus da máquina pode apagá-lo'), await dialog.innerText().catch(() => ''));
await dialog.locator('button:has-text("Cancelar")').click();
await settle();
expect('cancelar não baixa', downloads.length === 0, downloads.join(','));
await openMore();
await originalItem.click();
const [file] = await Promise.all([page.waitForEvent('download'), dialog.locator('button:has-text("Baixar original")').click()]);
expect('confirmar baixa o original', downloads.join(',') === '?format=raw' && file.suggestedFilename() === 'setup_v2.exe', `${downloads.join(',')} ${file.suggestedFilename()}`);
expect('a ficha continua aberta', new URL(page.url()).pathname === '/entries/e1', page.url());

// 2. Usuario comum: na amostra de outra pessoa, sem baixar e so com o nome.
state.role = 'USER';
const brunoOwner = entries[0].owner;
entries[0].owner = { id: brunoOwner.id, displayName: brunoOwner.displayName };
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('usuário comum não vê "Baixar amostra" de outra pessoa', (await download.count()) === 0);
expect('nem a senha do ZIP', (await page.locator('.hpsm-toolbar__note').count()) === 0);
await openMore();
expect('nem o "Baixar arquivo original…" no Mais', (await originalItem.count()) === 0);
await page.keyboard.press('Escape');
const name = await submitted();
expect('só o nome, sem parênteses', name.includes('Bruno Lima') && !name.includes('(') && !name.includes('@'), name);
await page.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
const printed = await page.locator('body').innerText();
expect('impressão só com o nome', printed.includes('Bruno Lima') && !printed.includes('bruno@deeplook.test'));
entries[0].owner = brunoOwner;

// 3. Usuario comum: na propria amostra, baixa.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('usuário comum baixa a própria amostra', (await download.count()) === 1);
await openMore();
expect('e tem o original no Mais', (await originalItem.count()) === 1);
await page.keyboard.press('Escape');

// 4. Auditoria com o novo tipo.
state.role = undefined;
state.auditEvents = [
  { id: 'a1', action: 'ENTRY_DOWNLOADED', actor: { id: 'u1', displayName: 'Ana Souza', email: 'ana@deeplook.test' }, targetUser: { id: 'u2', displayName: 'Bruno Lima', email: 'bruno@deeplook.test' }, targetLabel: 'instalador_suspeito.exe', detail: 'SHA-256 abc', ip: '10.0.0.1', createdAt: '2026-10-31T10:00:00.000Z' },
];
await page.goto(ORIGIN + '/admin?tab=audit', { waitUntil: 'networkidle' });
const options = await page.locator('select option').allInnerTexts();
expect('filtro da auditoria com "Amostra baixada"', options.includes('Amostra baixada'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nacesso às amostras: tudo ok');
process.exit(failures ? 1 : 0);
