// Auditoria administrativa (41): aba da Administracao pelo navegador, colunas
// (quem, acao com rotulo e cor, alvo, detalhe, IP), anonimo nos logins
// recusados, filtros (acao, periodo, busca), paginacao e Exportar CSV com os
// mesmos filtros.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const ana = { id: 'u1', displayName: 'Ana Souza', email: 'ana@deeplook.local' };
const at = (min) => new Date(Date.UTC(2026, 9, 22, 15, 0) - min * 60000).toISOString();
state.audit = [
  { id: 'a1', action: 'LOGIN_LOCKED', actor: null, targetUser: null, targetLabel: 'bruno@deeplook.local', detail: '5 tentativas em 5 min', ip: '203.0.113.7', createdAt: at(1) },
  { id: 'a2', action: 'LOGIN_FAILED', actor: null, targetUser: null, targetLabel: 'bruno@deeplook.local', detail: 'senha incorreta', ip: '203.0.113.7', createdAt: at(2) },
  { id: 'a3', action: 'USER_ROLE_CHANGED', actor: ana, targetUser: null, targetLabel: 'carla@deeplook.local', detail: 'USER → ANALYST', ip: '10.0.0.4', createdAt: at(30) },
  { id: 'a4', action: 'USER_PASSWORD_RESET', actor: ana, targetUser: null, targetLabel: 'bruno@deeplook.local', detail: 'sessões encerradas', ip: '10.0.0.4', createdAt: at(31) },
  { id: 'a5', action: 'KEY_CREATED', actor: ana, targetUser: null, targetLabel: 'DL-7KQ2-M9XP', detail: 'papel ANALYST · 1 uso(s) · 7 dia(s)', ip: '10.0.0.4', createdAt: at(60) },
  { id: 'a6', action: 'USER_SUSPENDED', actor: ana, targetUser: null, targetLabel: 'diego@deeplook.local', detail: null, ip: '10.0.0.4', createdAt: at(90) },
  ...Array.from({ length: 54 }, (_, i) => ({
    id: `f${i}`,
    action: 'LOGIN_FAILED',
    actor: null,
    targetUser: null,
    targetLabel: `teste${i}@exemplo.com`,
    detail: 'e-mail não cadastrado',
    ip: '198.51.100.20',
    createdAt: at(120 + i),
  })),
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
const cells = async (i) => (await page.locator('tbody tr').nth(i).locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const foot = async () => (await page.locator('.dl-table-foot > span').innerText()).trim();
const lastQuery = () => new URLSearchParams(state.auditQueries.at(-1));

// 1. Navegador e colunas.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Auditoria")');
await settle();
expect('navegador abre a aba', new URL(page.url()).search === '?tab=audit');
expect('aba Auditoria ativa', (await page.locator('[role=tab][aria-selected=true]').innerText()).trim() === 'Auditoria');
expect('cabeçalho', (await page.locator('thead th').allInnerTexts()).map((t) => t.trim()).join('|') === 'Data|Quem|Ação|Alvo|Detalhe|IP');
expect('período padrão: 30 dias', lastQuery().get('days') === '30' && (await page.inputValue('#audit-days')) === '30');
const locked = await cells(0);
expect('bloqueio: anônimo, rótulo, alvo, detalhe, IP', locked[1] === '(anônimo)' && locked[2] === 'Login bloqueado (tentativas)' && locked[3] === 'bruno@deeplook.local' && locked[4] === '5 tentativas em 5 min' && locked[5] === '203.0.113.7', locked.join(' | '));
expect('bloqueio em vermelho', (await page.locator('tbody tr').nth(0).locator('.hpsm-status--red').count()) === 1);
const role = await cells(2);
expect('papel alterado: quem e detalhe', role[1] === 'Ana Souza' && role[2] === 'Papel alterado' && role[4] === 'USER → ANALYST', role.join(' | '));
expect('e-mail de quem fez no título', (await page.locator('tbody tr').nth(2).locator('td').nth(1).locator('span[title]').getAttribute('title')) === 'ana@deeplook.local');
expect('sem detalhe: travessão', (await cells(5))[4] === '—');
await page.screenshot({ path: `${OUT}/admin-auditoria.png`, fullPage: true });

// 2. Paginacao (50 por pagina).
expect('rodapé da 1a página', (await foot()) === 'Exibindo registros 1 a 50 de 60', await foot());
expect('anterior desabilitado', await page.locator('.hpsm-pager__btn[aria-label="Página anterior"]').isDisabled());
await page.click('.hpsm-pager__btn[aria-label="Próxima página"]');
await settle();
expect('2a página', (await foot()) === 'Exibindo registros 51 a 60 de 60' && (await page.locator('tbody tr').count()) === 10 && lastQuery().get('offset') === '50', await foot());
expect('próxima desabilitada no fim', await page.locator('.hpsm-pager__btn[aria-label="Próxima página"]').isDisabled());

// 3. Filtros: acao volta para a 1a pagina.
await page.selectOption('#audit-action', 'USER_ROLE_CHANGED');
await settle();
expect('filtro por ação', lastQuery().get('action') === 'USER_ROLE_CHANGED' && lastQuery().get('offset') === '0' && (await page.locator('tbody tr').count()) === 1, state.auditQueries.at(-1));
await page.selectOption('#audit-action', '');
await page.selectOption('#audit-days', '');
await settle();
expect('todo o período: sem days', !lastQuery().has('days'));
await page.fill('#audit-q', 'bruno');
await settle(900);
expect('busca', lastQuery().get('q') === 'bruno' && (await page.locator('tbody tr').count()) === 3, state.auditQueries.at(-1));

// 4. CSV com os mesmos filtros.
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.hpsm-filterbar a:has-text("Exportar CSV")')]);
const exported = new URLSearchParams(state.lastAuditExport);
expect('CSV: nome do arquivo', download.suggestedFilename() === 'deeplook-auditoria-20261022.csv', download.suggestedFilename());
expect('CSV: mesmos filtros, sem paginação', exported.get('q') === 'bruno' && !exported.has('days') && !exported.has('limit') && !exported.has('offset'), state.lastAuditExport);

// 5. Nada encontrado e Limpar.
await page.fill('#audit-q', 'zzz-nada');
await settle(900);
expect('aviso de lista vazia', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Nenhum registro de auditoria com esses filtros.'));
await page.click('.hpsm-filterbar button:has-text("Limpar")');
await settle(900);
expect('Limpar volta ao padrão', (await page.inputValue('#audit-q')) === '' && (await page.inputValue('#audit-days')) === '30' && (await foot()) === 'Exibindo registros 1 a 50 de 60', await foot());

// 6. Cadeia de hash: integra mostra a ponta; quebrada vira erro com o motivo.
expect('cadeia íntegra com a ponta', (await page.locator('.dl-audit__chain').innerText()).includes('Cadeia íntegra: 60 eventos, ponta #60'), await page.locator('.dl-audit__chain').innerText());
state.auditChain = { ok: false, events: 3, unchained: 0, head: { seq: 3, hash: 'ff'.repeat(32) }, problem: { seq: 4, reason: 'o evento 4 foi alterado depois de gravado' }, checkedAt: new Date().toISOString() };
await page.reload({ waitUntil: 'networkidle' });
const alerts = (await page.locator('.hpsm-msg--error .hpsm-msg__text').allTextContents()).join(' ');
expect('cadeia quebrada: erro com o motivo', alerts.includes('cadeia da auditoria está quebrada') && alerts.includes('o evento 4 foi alterado'), alerts);
expect('cadeia quebrada: sem a linha de íntegra', (await page.locator('.dl-audit__chain').count()) === 0);
await page.screenshot({ path: `${OUT}/admin-audit-cadeia-quebrada.png` });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nauditoria: tudo ok');
process.exit(failures ? 1 : 0);
