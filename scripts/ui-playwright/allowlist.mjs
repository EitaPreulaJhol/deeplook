// Lista de permissoes (69): tela "Indicadores permitidos" no navegador
// (obrigatorios, faixa invalida com dica, incluir com Ctrl+S, repetido, remover
// com confirmacao), marca na ficha do indicador e IOCs sugeridos do relatorio
// sem os permitidos (com a contagem dos ocultos); usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const add = page.locator('.hpsm-toolbar__action:has-text("Incluir")');
const rows = page.locator('table[aria-label="Indicadores permitidos"] tbody tr');

// 1. Navegador e lista vazia.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.locator('.hpsm-tree__leaf:has-text("Indicadores permitidos")').click();
await settle();
expect('abre a tela', new URL(page.url()).pathname === '/permitidos');
expect('lista vazia', (await messages()).includes('Nenhum indicador permitido ainda.'));

// 2. Validacao.
await add.click();
await settle(300);
expect('obrigatórios destacados', (await page.locator('.hpsm-field--invalid').count()) === 2 && state.allowlistCalls.length === 0);
await page.selectOption('#allow-kind', 'IPV4');
expect('dica muda com o tipo', (await page.locator('#allow-value').getAttribute('placeholder')).includes('10.0.0.0/8'));
await page.fill('#allow-value', '10.0.0.300/x');
await page.fill('#allow-reason', 'Rede interna');
await add.click();
await settle();
expect('faixa inválida no campo', (await page.locator('.hpsm-field--invalid #allow-value').count()) === 1 && (await messages()).some((t) => t.includes('use um IP ou uma faixa')), (await messages()).join(' | '));

// 3. Incluir (Ctrl+S) e repetido.
await page.selectOption('#allow-kind', 'DOMAIN');
await page.fill('#allow-value', 'banco.test');
await page.fill('#allow-reason', 'Domínio oficial do banco');
await page.keyboard.press('Control+s');
await settle();
expect('incluído', state.allowlist.length === 1 && (await rows.count()) === 1 && (await messages()).includes('Domínio banco.test permitido.'));
expect('tipo mantido para o próximo', (await page.inputValue('#allow-kind')) === 'DOMAIN' && (await page.inputValue('#allow-value')) === '');
await page.fill('#allow-value', 'banco.test');
await page.fill('#allow-reason', 'De novo aqui');
await add.click();
await settle();
expect('repetido avisa no campo', (await messages()).some((t) => t.includes('já está na lista')));
await page.fill('#allow-value', '');
await page.fill('#allow-reason', '');
await page.screenshot({ path: `${OUT}/permitidos.png`, fullPage: true });

// 4. Ficha do indicador.
await page.goto(ORIGIN + '/iocs/domain/portal.banco.test', { waitUntil: 'networkidle' });
expect('ficha marcada com o motivo', (await messages()).some((t) => t.startsWith('Indicador permitido (coberto por banco.test): Domínio oficial do banco.')), (await messages()).join(' | '));

// 5. IOCs sugeridos do relatorio sem os permitidos.
entries[0].staticInfo = { ...(entries[0].staticInfo ?? {}), iocCandidates: [{ kind: 'URL', value: 'https://portal.banco.test/login' }, { kind: 'DOMAIN', value: 'evil.test' }, { kind: 'DOMAIN', value: 'banco.test' }] };
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
const suggest = page.locator('button:has-text("Inserir IOCs sugeridos")');
expect('só o que não é permitido', (await suggest.innerText()).includes('(1)') && (await page.locator('.dl-hint-muted', { hasText: 'permitido' }).innerText()).includes('2 permitidos ocultos'), await suggest.innerText());
await suggest.click();
expect('insere só evil.test', (await page.inputValue('#report-iocs')) === 'evil.test', await page.inputValue('#report-iocs'));

// 6. Remover.
await page.goto(ORIGIN + '/permitidos', { waitUntil: 'networkidle' });
await rows.first().locator('button:has-text("Remover")').click();
await settle(300);
await page.locator('[role=alertdialog] button:has-text("Remover")').click();
await settle();
expect('removido', state.allowlist.length === 0 && state.allowlistCalls.at(-1)?.method === 'DELETE');

// 7. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/permitidos', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/permitidos');
expect('sem item no navegador', (await page.locator('.hpsm-tree__leaf:has-text("Indicadores permitidos")').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nindicadores permitidos: tudo ok');
process.exit(failures ? 1 : 0);
