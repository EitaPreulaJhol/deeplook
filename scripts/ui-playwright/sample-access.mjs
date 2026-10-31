// Acesso as amostras (122 e 123): usuario comum so ve "Baixar amostra" nas
// proprias e so o nome de quem enviou nas dos outros; analista baixa e ve o
// e-mail; o download aparece na auditoria.
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
const download = page.locator('.hpsm-toolbar :text-is("Baixar amostra")');
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

// 2. Usuario comum: na amostra de outra pessoa, sem baixar e so com o nome.
state.role = 'USER';
const brunoOwner = entries[0].owner;
entries[0].owner = { id: brunoOwner.id, displayName: brunoOwner.displayName };
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('usuário comum não vê "Baixar amostra" de outra pessoa', (await download.count()) === 0);
const name = await submitted();
expect('só o nome, sem parênteses', name.includes('Bruno Lima') && !name.includes('(') && !name.includes('@'), name);
await page.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
const printed = await page.locator('body').innerText();
expect('impressão só com o nome', printed.includes('Bruno Lima') && !printed.includes('bruno@deeplook.test'));
entries[0].owner = brunoOwner;

// 3. Usuario comum: na propria amostra, baixa.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('usuário comum baixa a própria amostra', (await download.count()) === 1);

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
