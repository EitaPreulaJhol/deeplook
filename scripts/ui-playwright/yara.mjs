// Regras YARA (56): tela /yara (criar com erro de compilacao mostrado no quadro,
// validar, salvar, editar, desativar, excluir), item no navegador lateral so
// para analistas, e a secao "Regras YARA" da ficha (acertos, resumo do topo,
// escanear de novo).
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
const settle = (ms = 500) => page.waitForTimeout(ms);
const button = (label) => page.locator(`.hpsm-toolbar__action:has-text("${label}")`);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.trim());

const BROKEN = `rule Dropper_XYZ : dropper
{
  strings:
    $a = "dropper-xyz"
  condition:
    uint16(0) == 0x5A4D and
    $b
}`;
const GOOD = BROKEN.replace('    $b\n', '    $a\n');

// 1. Navegador lateral leva a tela.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const leaf = page.locator('.hpsm-tree__leaf:has-text("Regras YARA")');
expect('item "Regras YARA" no navegador', (await leaf.count()) === 1);
await leaf.click();
await settle();
expect('abre /yara', new URL(page.url()).pathname === '/yara', page.url());
expect('lista vazia', (await messages()).includes('Nenhuma regra YARA cadastrada.'));
expect('aba do workspace', (await page.locator('.hpsm-doctab.is-active').innerText()).includes('Regras YARA'));

// 2. Salvar sem preencher destaca os campos.
await button('Salvar regra').click();
await settle(300);
expect('obrigatórios destacados', (await page.locator('.hpsm-field--invalid').count()) === 2 && state.yaraCalls.length === 0);

// 3. Regra com erro: o quadro mostra a saida do compilador e nada e salvo.
await page.fill('#yara-name', 'Família XYZ');
await page.fill('#yara-source', BROKEN);
await button('Validar').click();
await settle();
let out = page.locator('.dl-compiler-output');
expect('validar mostra o erro com a linha', (await out.getAttribute('data-ok')) === 'false' && (await out.locator('pre').innerText()).includes('--> line:7:5'));
await page.screenshot({ path: `${OUT}/yara-erro.png`, fullPage: true });
await button('Salvar regra').click();
await settle();
expect('salvar com erro é recusado', state.yaraRules.length === 0 && (await out.getAttribute('data-ok')) === 'false');
expect('campo Regra destacado', (await page.locator('.hpsm-field--invalid #yara-source').count()) === 1);
expect('sem barra genérica repetindo o erro', !(await messages()).some((t) => t.startsWith('Corrija os campos')), (await messages()).join(' | '));

// 4. Corrigir, validar e salvar.
await page.fill('#yara-source', GOOD);
await page.fill('#yara-description', 'Dropper da família XYZ');
await button('Validar').click();
await settle();
expect('validar ok', (await out.getAttribute('data-ok')) === 'true' && (await out.innerText()).includes('A regra compila sem erros.'));
await page.keyboard.press('Control+s');
await settle();
expect('Ctrl+S salva', state.yaraRules.length === 1 && state.yaraRules[0].enabled === true && state.yaraRules[0].description === 'Dropper da família XYZ');
expect('aviso de salvo', (await messages()).some((t) => t.startsWith('Regra "Família XYZ" salva; vale para os próximos envios')), (await messages()).join(' | '));
expect('formulário limpo', (await page.inputValue('#yara-name')) === '' && (await page.locator('.dl-compiler-output').count()) === 0);
const rows = page.locator('table[aria-label="Regras YARA"] tbody tr');
expect('linha na lista', (await rows.count()) === 1 && (await rows.first().innerText()).includes('Ativa'));
expect('subtítulo conta as ativas', (await page.locator('.dl-page-subtitle').innerText()).includes('(1 ativa)'));

// 5. Nome duplicado.
await page.fill('#yara-name', 'Família XYZ');
await page.fill('#yara-source', GOOD);
await button('Salvar regra').click();
await settle();
expect('nome em uso destaca o Nome', (await messages()).some((t) => t.includes('Nome') && t.includes('nome em uso')), (await messages()).join(' | '));
await page.fill('#yara-name', '');
await page.fill('#yara-source', '');

// 6. Editar e desativar.
await rows.first().locator('button:has-text("Editar")').click();
await settle(300);
expect('editar carrega a regra', (await page.inputValue('#yara-source')) === GOOD && (await page.locator('text=Editar regra: Família XYZ').count()) === 1);
await page.fill('#yara-name', 'Família XYZ v2');
await button('Salvar regra').click();
await settle();
expect('edição enviada por PATCH', state.yaraCalls.at(-1)?.method === 'PATCH' && state.yaraRules[0].name === 'Família XYZ v2');
await rows.first().locator('button:has-text("Desativar")').click();
await settle();
expect('desativar envia só enabled', JSON.stringify(state.yaraCalls.at(-1)?.body) === '{"enabled":false}' && (await rows.first().innerText()).includes('Desativada'));
await page.screenshot({ path: `${OUT}/yara-lista.png`, fullPage: true });

// 7. Excluir (com confirmacao).
await rows.first().locator('button:has-text("Excluir")').click();
await settle(300);
await page.locator('[role=alertdialog]:has-text("Excluir regra") button:has-text("Excluir")').click();
await settle();
expect('excluída', state.yaraRules.length === 0 && (await rows.count()) === 0);

// 8. Ficha: secao com os acertos e o resumo do topo.
state.yara.e1 = [
  { activeRules: 2, pending: true, scan: { status: 'PENDING', matches: [], rulesCount: 0, error: null, scannedAt: '2026-10-23T15:00:00.000Z' } },
  {
    activeRules: 2,
    pending: false,
    scan: {
      status: 'MATCHED',
      rulesCount: 2,
      error: null,
      scannedAt: '2026-10-23T15:00:05.000Z',
      matches: [
        { rule: 'Família XYZ', identifier: 'Dropper_XYZ', tags: ['dropper'], description: 'Dropper da família XYZ', matches: 3 },
        { rule: 'Genéricas', identifier: 'Tem_PE', tags: [], description: null, matches: 0 },
      ],
    },
  },
];
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const section = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Regras YARA"))');
expect('seção aparece escaneando', (await section.innerText()).includes('Escaneando...'));
await page.waitForTimeout(3200);
const text = await section.innerText();
expect('atualiza sozinha com os acertos', text.includes('2 regras casaram') && text.includes('Dropper_XYZ') && text.includes('Família XYZ') && text.includes('dropper'), text.replace(/\s+/g, ' ').slice(0, 300));
const summary = (await page.locator('.dl-summary').first().innerText()).replace(/\s+/g, ' ');
expect('resumo do topo mostra YARA', summary.includes('YARA: Dropper_XYZ, Tem_PE'), summary);
await section.screenshot({ path: `${OUT}/yara-ficha.png` });
await section.locator('button:has-text("Escanear de novo")').click();
await settle();
expect('escanear de novo', state.yaraCalls.some((c) => c.rescan === 'e1'));

// 9. Sem regras nem varredura: secao escondida.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('sem regras: sem seção', (await page.locator('.hpsm-section__head:has-text("Regras YARA")').count()) === 0);

// 10. Usuario comum: sem item no navegador e /yara volta ao inicio.
state.role = 'USER';
await page.goto(ORIGIN + '/yara', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/yara', page.url());
expect('sem item no navegador', (await page.locator('.hpsm-tree__leaf:has-text("Regras YARA")').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nregras YARA: tudo ok');
process.exit(failures ? 1 : 0);
