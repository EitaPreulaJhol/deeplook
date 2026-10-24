// Versoes do relatorio (75): "Editar" no relatorio publicado (preenchido,
// Cancelar, Ctrl+S da edicao, resumo obrigatorio), "Versoes (N)" com a
// diferenca entre duas versoes (linhas +/−, veredito, ATT&CK), versoes iguais,
// sem Editar com revisao obrigatoria e usuario comum sem as acoes.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, reports, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const r1 = reports.find((r) => r.id === 'r1');
// Versao 1: sem a segunda linha dos achados, veredito desconhecido e sem ATT&CK.
state.reportRevisions.r1 = [
  {
    summary: r1.summary,
    findings: 'Cria HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater.',
    iocs: r1.iocs,
    verdict: 'UNKNOWN',
    attackTechniques: ['T1204'],
    status: 'DRAFT',
    editor: { id: 'u2', displayName: 'Bruno Lima' },
    at: '2026-10-23T10:00:00.000Z',
  },
];
Object.assign(r1, { attackTechniques: ['T1059.001'], _count: { revisions: 1 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-tabpanel:not([hidden]) .hpsm-section').first();
const button = (label) => section.locator(`.hpsm-toolbar__action:has-text("${label}")`);

// 1. Acoes no relatorio publicado.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
const actions = (await section.locator('.hpsm-toolbar').first().locator('.hpsm-toolbar__action').allInnerTexts()).map((t) => t.trim());
expect('Editar e Versões (2)', actions.join('|') === 'Editar|Versões (2)', actions.join('|'));

// 2. Versoes: anterior x atual.
await button('Versões (2)').click();
await settle();
const from = page.locator('[id="versions-from-r1"]');
const to = page.locator('[id="versions-to-r1"]');
expect('compara a anterior com a atual', (await from.inputValue()) === '1' && (await to.inputValue()) === '2');
const options = (await from.locator('option').allInnerTexts()).map((t) => t.trim());
expect('versões com autor, data e situação', options[0].startsWith('Versão 1 — Bruno Lima, ') && options[0].endsWith('· rascunho') &&options[1].startsWith('Versão 2 (atual) — Bruno Lima, ') && options[1].endsWith('· publicado'), options.join(' | '));
const diff = section.locator('.dl-diff');
expect('só Achados mudou no texto', (await diff.count()) === 1);
const counts = (await diff.locator('.dl-diff__count').innerText()).trim();
expect('contagem +1 −0', counts === '+1 −0', counts);
const added = (await diff.locator('.dl-diff__line--add').allTextContents()).map((t) => t.replace(/^\+\s*(adicionada: )?/, '').trim());
expect('linha adicionada', added.join('|') === 'Contata domínio recém-registrado.', added.join('|'));
expect('linha igual sem marca', (await diff.locator('.dl-diff__line--same').count()) === 1);
const verdictField = section.locator('.hpsm-field', { hasText: 'Veredito' }).last();
expect('veredito Desconhecido → Suspeito', (await verdictField.innerText()).includes('Desconhecido → Suspeito'), await verdictField.innerText());
const attackField = section.locator('.dl-versions .hpsm-field', { hasText: 'ATT&CK' });
expect('ATT&CK + e −', (await attackField.innerText()).replace(/\s+/g, ' ').includes('+ T1059.001 − T1204'), await attackField.innerText());
await page.screenshot({ path: `${OUT}/relatorio-versoes.png`, fullPage: true });
await from.selectOption('2');
await settle(200);
expect('mesma versão: aviso', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('mesmo conteúdo')));
await button('Ocultar versões').click();
await settle(200);
expect('ocultar fecha o painel', (await section.locator('.dl-versions').count()) === 0);

// 3. Editar: preenchido, Cancelar sem mudar nada.
await button('Editar').click();
await settle();
expect('formulário preenchido', (await page.inputValue('#report-edit-summary')) === r1.summary && (await page.inputValue('#report-edit-verdict')) === 'SUSPICIOUS');
expect('Salvar desligado sem mudança', await page.locator('.hpsm-toolbar__action:has-text("Salvar alterações")').isDisabled());
expect('título indica edição', (await section.locator('.hpsm-section__head').innerText()).includes('(editando)'));
await page.click('.hpsm-toolbar__action:has-text("Cancelar")');
await settle();
expect('Cancelar volta à leitura', (await page.locator('#report-edit-summary').count()) === 0 && state.lastReportPatch === null);

// 4. Resumo obrigatorio.
await button('Editar').click();
await settle();
await page.fill('#report-edit-summary', 'ab');
await page.click('.hpsm-toolbar__action:has-text("Salvar alterações")');
await settle();
expect('resumo curto não salva', state.lastReportPatch === null && (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('Resumo')));

// 5. Ctrl+S salva a edicao (e nao cria relatorio novo).
const posts = [];
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().endsWith('/api/entries/e1/reports')) posts.push(r.url());
});
await page.fill('#report-edit-summary', 'Executável empacotado com UPX; persiste via chave Run e baixa o segundo estágio.');
await page.locator('#report-edit-summary').press('Control+s');
await settle(600);
expect(
  'PATCH com o conteúdo e o mesmo veredito',
  state.lastReportPatch?.summary?.endsWith('baixa o segundo estágio.') && state.lastReportPatch?.verdict === 'SUSPICIOUS' && state.lastReportPatch?.attackTechniques?.join() === 'T1059.001',
  JSON.stringify(state.lastReportPatch),
);
expect('não criou relatório novo', posts.length === 0, posts.join());
const msg = await page.locator('.hpsm-msg__text').allInnerTexts();
expect('aviso da versão guardada', msg.some((t) => t.includes('A versão anterior ficou em Versões')), msg.join(' | '));
expect('agora Versões (3)', (await button('Versões (3)').count()) === 1);

// 6. Revisao obrigatoria: publicado nao tem Editar (Versoes continua).
state.reviewRequired = true;
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('revisão obrigatória: sem Editar', (await button('Editar').count()) === 0 && (await button('Versões (3)').count()) === 1);
state.reviewRequired = false;

// 7. Usuario comum: nem Editar nem Versoes.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('usuário comum sem ações', (await section.locator('.hpsm-toolbar__action').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nversões do relatório: tudo ok');
process.exit(failures ? 1 : 0);
