// Modelos de relatorio (38): aba na Administracao (validacao, criar, editar,
// nome repetido vindo da API, excluir com confirmacao, Ctrl+S) e o campo
// "Modelo" no Novo relatorio (preenche campos e veredito; pergunta antes de
// sobrescrever texto).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
state.templates = [
  { id: 'tplA', name: 'Dropper', summary: 'Executável que baixa a segunda etapa.', findings: 'Baixa de hxxp://...', iocs: null, verdict: 'SUSPICIOUS', updatedAt: '2026-10-20T10:00:00.000Z' },
];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const invalidIds = () =>
  page.locator('.hpsm-field--invalid').evaluateAll((els) => els.map((el) => el.querySelector('input, textarea, select')?.id));
const names = () => page.locator('tbody tr td:first-child').allTextContents();

// 1. Aba pelo navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Modelos de relatório")');
await settle();
expect('navegador abre a aba de modelos', new URL(page.url()).search === '?tab=templates');
expect('lista os modelos', (await names()).join('|') === 'Dropper');

// 2. Validacao e criacao.
await page.click('.hpsm-toolbar__action:has-text("Salvar modelo")');
await settle();
expect('vazio: nome e resumo destacados', (await invalidIds()).join(',') === 'tpl-name,tpl-summary', (await invalidIds()).join(','));
await page.fill('#tpl-name', 'Phishing de credenciais');
await page.selectOption('#tpl-verdict', 'MALICIOUS');
await page.fill('#tpl-summary', 'Página que imita o banco e coleta a senha.');
await page.fill('#tpl-findings', 'O formulário envia os dados para um domínio recém-registrado.');
await page.keyboard.press('Control+KeyS');
await settle();
expect('Ctrl+S salva', (await messages()).includes('Modelo "Phishing de credenciais" salvo.'));
expect('lista atualizada e em ordem', (await names()).join('|') === 'Dropper|Phishing de credenciais');
expect('formulário volta a "Novo modelo" vazio', (await page.inputValue('#tpl-name')) === '' && (await page.locator('.hpsm-section__head:has-text("Novo modelo")').count()) === 1);
await page.screenshot({ path: `${OUT}/modelos-admin.png` });

// 3. Edicao e nome repetido (erro da API no campo).
await page.locator('tbody tr:has-text("Dropper") button:has-text("Editar")').click();
expect('editar carrega o modelo', (await page.inputValue('#tpl-name')) === 'Dropper' && (await page.locator('.hpsm-section__head:has-text("Editar modelo: Dropper")').count()) === 1);
await page.fill('#tpl-name', 'Phishing de credenciais');
await page.click('.hpsm-toolbar__action:has-text("Salvar modelo")');
await settle();
expect('nome repetido: campo destacado', (await invalidIds()).join(',') === 'tpl-name' && (await messages()).includes('Corrija os campos destacados: Nome (nome em uso).'), (await messages()).join(' | '));
await page.fill('#tpl-name', 'Dropper genérico');
await page.click('.hpsm-toolbar__action:has-text("Salvar modelo")');
await settle();
expect('edição salva', state.templates.find((t) => t.id === 'tplA').name === 'Dropper genérico');

// 4. Excluir com confirmacao.
await page.locator('tbody tr:has-text("Dropper genérico") button:has-text("Excluir")').click();
const dialog = page.locator('[role=alertdialog]:has-text("Excluir modelo")');
expect('pede confirmação', await dialog.isVisible());
await dialog.locator('button:has-text("Excluir")').click();
await settle();
expect('excluído', (await names()).join('|') === 'Phishing de credenciais' && state.templates.length === 1);

// 5. Novo relatorio com modelo.
await page.goto(ORIGIN + '/entries/e3?tab=relatorios', { waitUntil: 'networkidle' });
expect('campo Modelo no Novo relatório', await page.locator('#report-template').isVisible());
await page.selectOption('#report-template', { label: 'Phishing de credenciais' });
await settle();
expect('modelo preenche resumo e achados', (await page.inputValue('#report-summary')) === 'Página que imita o banco e coleta a senha.' && (await page.inputValue('#report-findings')).startsWith('O formulário envia'));
expect('modelo define o veredito', (await page.inputValue('#report-verdict')) === 'MALICIOUS');
await page.fill('#report-summary', 'Texto meu, ajustado.');
state.templates.push({ id: 'tplB', name: 'Documento com macro', summary: 'Documento Office com macro.', findings: null, iocs: 'evil.example', verdict: 'SUSPICIOUS', updatedAt: '2026-10-22T10:00:00.000Z' });
await page.reload({ waitUntil: 'networkidle' });
await page.fill('#report-summary', 'Texto meu, ajustado.');
await page.selectOption('#report-template', { label: 'Documento com macro' });
const ask = page.locator('[role=alertdialog]:has-text("Aplicar modelo")');
expect('com texto digitado, pergunta antes', await ask.isVisible());
await ask.locator('button:has-text("Manter o texto")').click();
await settle();
expect('"Manter o texto" não muda nada', (await page.inputValue('#report-summary')) === 'Texto meu, ajustado.' && (await page.inputValue('#report-template')) === '');
await page.selectOption('#report-template', { label: 'Documento com macro' });
await page.locator('[role=alertdialog] button:has-text("Substituir")').click();
await settle();
expect('"Substituir" aplica o modelo', (await page.inputValue('#report-summary')) === 'Documento Office com macro.' && (await page.inputValue('#report-iocs')) === 'evil.example' && (await page.inputValue('#report-findings')) === '');
await page.screenshot({ path: `${OUT}/modelos-relatorio.png` });
// Limpa para nao travar a saida (alteracoes nao salvas).
await page.fill('#report-summary', '');
await page.fill('#report-iocs', '');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmodelos de relatório: tudo ok');
process.exit(failures ? 1 : 0);
