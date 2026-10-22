// Tokens de API (43): aba da Minha Conta so com o acesso liberado; admin
// libera/retira na aba Usuarios (coluna e confirmacao); gerar token (validacao,
// segredo mostrado uma vez com Copiar), revogar; aba "Tokens de API" da
// Administracao com filtro e revogacao; navegador.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, users, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const bruno = { id: 'u2', displayName: 'Bruno Lima', email: 'bruno@deeplook.test', apiAccess: true };
state.adminTokens = [
  { id: 'ta1', name: 'Coletor SIEM', prefix: 'dlk_Zz98Yy76', createdAt: '2026-10-01T10:00:00.000Z', expiresAt: '2026-12-30T10:00:00.000Z', lastUsedAt: '2026-10-22T09:15:00.000Z', lastUsedIp: '203.0.113.9', revokedAt: null, user: bruno },
  { id: 'ta2', name: 'Teste antigo', prefix: 'dlk_Xx11Ww22', createdAt: '2026-09-01T10:00:00.000Z', expiresAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null, lastUsedIp: null, revokedAt: '2026-09-10T10:00:00.000Z', user: bruno },
];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const tabNames = async () => (await page.locator('[role=tablist] [role=tab]').allInnerTexts()).map((t) => t.trim());
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const confirmDialog = page.locator('[role=alertdialog]');
const rowOf = (name) => page.locator(`tbody tr:has-text("${name}")`).first();

// 1. Sem liberacao: Minha Conta sem a aba.
await page.goto(ORIGIN + '/user?tab=tokens', { waitUntil: 'networkidle' });
expect('sem liberação: sem a aba', !(await tabNames()).includes('Tokens de API'), (await tabNames()).join('|'));
expect('?tab=tokens cai em Dados', (await page.locator('[role=tab][aria-selected=true]').innerText()).trim() === 'Dados');

// 2. Admin libera na aba Usuarios.
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
expect('coluna "Acesso por API"', (await page.locator('thead th').allInnerTexts()).map((t) => t.trim()).includes('Acesso por API'));
expect('sem acesso: travessão', (await rowOf('Ana Souza').locator('td').nth(5).innerText()).trim() === '—');
await rowOf('Ana Souza').locator('button:has-text("Liberar API")').click();
expect('liberar pede confirmação', (await confirmDialog.innerText()).includes('A pessoa poderá gerar tokens em Minha Conta'));
await confirmDialog.locator('button:has-text("Liberar")').click();
await settle();
expect('PATCH apiAccess', state.calls.includes('PATCH /api/admin/users/u1') && users[0].apiAccess === true);
expect('coluna mostra liberado', (await rowOf('Ana Souza').locator('td').nth(5).innerText()).trim() === 'Liberado · 0 tokens ativos', await rowOf('Ana Souza').locator('td').nth(5).innerText());
expect('botão vira "Retirar API"', (await rowOf('Ana Souza').locator('button:has-text("Retirar API")').count()) === 1);

// 3. Minha Conta: gerar e revogar.
await page.goto(ORIGIN + '/user', { waitUntil: 'networkidle' });
expect('com liberação: aba aparece', (await tabNames()).includes('Tokens de API'));
await page.click('[role=tab]:has-text("Tokens de API")');
await settle();
expect('aba na URL', new URL(page.url()).search === '?tab=tokens');
expect('lista vazia', (await page.locator('.hpsm-section:has-text("Meus tokens (0)") .dl-static-empty').innerText()).trim() === 'Nenhum token gerado.');
expect('exemplo de uso com o endereço', (await page.locator('.hpsm-field:has(.hpsm-field__label:text-is("Uso:")) .hpsm-readonly').innerText()).includes(`curl -H "Authorization: Bearer <token>" "${ORIGIN}/api/entries?scope=mine"`));
await page.keyboard.press('Control+KeyS');
await settle();
expect('nome obrigatório', (await page.locator('.hpsm-field:has(#token-name)').getAttribute('class')).includes('invalid'));
await page.fill('#token-name', 'Coletor do SOC');
await page.selectOption('#token-days', '90');
await page.click('.hpsm-toolbar__action:has-text("Gerar token")');
await settle();
const msg = (await messages()).join(' / ');
expect('segredo mostrado uma vez', msg.includes('Token "Coletor do SOC": dlk_Ab12Cd31EfGh5678IjKl9012MnOp3456QrSt') && msg.includes('não será mostrado de novo'), msg);
expect('botão copiar', (await page.locator('.hpsm-msg button[aria-label*="token"], .hpsm-msg .dl-copy').count()) >= 1);
expect('nome limpo após gerar', (await page.inputValue('#token-name')) === '');
expect('sem aviso de validação depois de gerar', !msg.includes('Preencha'), msg);
const cells = (await rowOf('Coletor do SOC').locator('td').allInnerTexts()).map((t) => t.trim());
expect('linha: início, validade, nunca usado, ativo', cells[1] === 'dlk_Ab12Cd31…' && cells[3].startsWith('20/01/2027') && cells[4] === 'Nunca usado' && cells[5] === 'Ativo', cells.join(' | '));
await page.screenshot({ path: `${OUT}/tokens-minha-conta.png`, fullPage: true });
await rowOf('Coletor do SOC').locator('button:has-text("Revogar")').click();
expect('revogar pede confirmação', (await confirmDialog.innerText()).includes('deixa de funcionar imediatamente'));
await confirmDialog.locator('button.dl-btn--danger').click();
await settle();
expect('revogado', state.calls.includes('DELETE /api/me/api-tokens/tk1') && (await rowOf('Coletor do SOC').locator('td').nth(5).innerText()).trim() === 'Revogado');

// 4. Administracao: aba Tokens de API.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Tokens de API")');
await settle();
expect('navegador abre a aba', new URL(page.url()).search === '?tab=tokens');
expect('só ativos por padrão', (await page.locator('table[aria-label="Tokens de API"] tbody tr').count()) === 1);
const adm = (await rowOf('Coletor SIEM').locator('td').allInnerTexts()).map((t) => t.trim());
expect('linha: usuário, último uso com IP', adm[0] === 'Bruno Lima' && adm[5] === '22/10/2026, 06:15:00 · 203.0.113.9' || adm[5].endsWith('· 203.0.113.9'), adm.join(' | '));
await page.selectOption('#tokens-status', 'all');
await settle();
expect('todos: inclui revogado', (await page.locator('table[aria-label="Tokens de API"] tbody tr').count()) === 2 && (await rowOf('Teste antigo').locator('td').nth(6).innerText()).trim() === 'Revogado');
await page.screenshot({ path: `${OUT}/tokens-admin.png`, fullPage: true });
await rowOf('Coletor SIEM').locator('button:has-text("Revogar")').click();
await confirmDialog.locator('button.dl-btn--danger').click();
await settle();
expect('admin revoga', state.calls.includes('DELETE /api/admin/api-tokens/ta1'));
expect('aviso', (await messages()).includes('Token "Coletor SIEM" de Bruno Lima revogado.'));

// 5. Retirar acesso.
users[0]._count.apiTokens = 2;
await page.goto(ORIGIN + '/admin', { waitUntil: 'networkidle' });
await rowOf('Ana Souza').locator('button:has-text("Retirar API")').click();
expect('retirar avisa a revogação', (await confirmDialog.innerText()).includes('Todos os tokens ativos dessa pessoa (2) serão revogados imediatamente.'));
await confirmDialog.locator('button.dl-btn--danger').click();
await settle();
expect('acesso retirado', users[0].apiAccess === false && (await rowOf('Ana Souza').locator('td').nth(5).innerText()).trim() === '—');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ntokens de API: tudo ok');
process.exit(failures ? 1 : 0);
