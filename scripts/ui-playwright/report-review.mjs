// Revisao de relatorio - quatro olhos (39): fila "Relatorios para revisar" no
// navegador, situacao de cada relatorio, aprovar e devolver (com comentario),
// comentario de devolucao para o autor, enviar para revisao, "Ao salvar" com e
// sem revisao obrigatoria, rascunhos ocultos para usuario comum e notificacao.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, reports, setupMock, watchErrors } from './mock-api.mjs';

const bruno = { id: 'u2', displayName: 'Bruno Lima', role: 'ANALYST' };
const ana = { id: 'u1', displayName: 'Ana Souza', role: 'ADMIN' };
const base = { entryId: 'e3', verdict: 'SUSPICIOUS', createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z', findings: null, iocs: null };
reports.push(
  { ...base, id: 'r2', analystId: 'u2', analyst: bruno, summary: 'Macro baixa um executável.', status: 'IN_REVIEW', submittedAt: '2026-10-21T11:00:00.000Z' },
  { ...base, id: 'r3', analystId: 'u1', analyst: ana, summary: 'Rascunho meu.', status: 'DRAFT', reviewNote: 'Faltou o hash do dropper.', reviewedBy: { id: 'u2', displayName: 'Bruno Lima' }, reviewedAt: '2026-10-21T12:00:00.000Z' },
  { ...base, entryId: 'e4', id: 'r4', analystId: 'u1', analyst: ana, summary: 'Meu, em revisão.', status: 'IN_REVIEW', submittedAt: '2026-10-21T09:00:00.000Z' },
);

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
const settle = (ms = 400) => page.waitForTimeout(ms);
const url = () => new URL(page.url()).pathname + new URL(page.url()).search;
const section = (summary) => page.locator(`.hpsm-section:has(.hpsm-readonly:has-text("${summary}"))`).first();
const situation = async (summary) => (await section(summary).locator('.hpsm-field:has(.hpsm-field__label:text-is("Situação:")) .hpsm-readonly').innerText()).replace(/\s+/g, ' ').trim();

// 1. Fila no navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const leaf = page.locator('.hpsm-tree a:has-text("Relatórios para revisar")');
expect('fila com contador (só de outros analistas)', (await leaf.innerText()).replace(/\s+/g, ' ').trim() === 'Relatórios para revisar (1)', await leaf.innerText());
await leaf.click();
await settle();
expect('abre a fila', url() === '/revisoes');
const row = (await page.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ');
expect('linha: amostra, autor, veredito', (await page.locator('tbody tr').count()) === 1 && row.includes('relatorio_trimestral.docm') && row.includes('Bruno Lima') && row.includes('Suspeito'), row);
await page.locator('tbody tr').first().focus();
await page.keyboard.press('Enter');
await settle(600);
expect('Enter abre a aba Relatórios da amostra', url() === '/entries/e3?tab=relatorios', url());

// 2. Situacoes e acoes.
expect('em revisão (de outro): situação', (await situation('Macro baixa')) === 'Em revisão');
expect('em revisão (de outro): aprovar e devolver', (await section('Macro baixa').locator('.hpsm-toolbar__action').allTextContents()).join('|') === 'Aprovar e publicar|Devolver…');
const note = (await section('Rascunho meu').locator('.dl-review-note').innerText()).replace(/\s+/g, ' ');
expect('meu rascunho devolvido mostra o comentário', note.startsWith('Devolvido por Bruno Lima em') && note.endsWith('Faltou o hash do dropper.'), note);
expect('meu rascunho: enviar e publicar', (await section('Rascunho meu').locator('.hpsm-toolbar__action').allTextContents()).join('|') === 'Editar|Enviar para revisão|Publicar');
await page.screenshot({ path: `${OUT}/revisao-relatorios.png`, fullPage: true });

// 3. Devolver com comentario.
await section('Macro baixa').locator('.hpsm-toolbar__action:has-text("Devolver")').click();
const dialog = page.locator('[role=dialog]:has-text("Devolver relatório")');
expect('devolver pede comentário', await dialog.isVisible());
await dialog.locator('input').fill('Inclua os IOCs da macro.');
await dialog.locator('button:has-text("Devolver")').click();
await settle(600);
expect('devolvido com o comentário', state.calls.includes('REPORT return r2') && reports.find((r) => r.id === 'r2').reviewNote === 'Inclua os IOCs da macro.');
expect('mensagem de devolução', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Relatório devolvido ao autor.'));

// 4. Enviar o meu rascunho: fica aguardando outro analista.
await section('Rascunho meu').locator('.hpsm-toolbar__action:has-text("Enviar para revisão")').click();
await settle(600);
expect('meu relatório em revisão aguarda outro analista', (await situation('Rascunho meu')) === 'Em revisão' && (await section('Rascunho meu').locator('.hpsm-toolbar__info').textContent()) === 'Aguardando a revisão de outro analista.');

// 5. Aprovar.
Object.assign(reports.find((r) => r.id === 'r2'), { status: 'IN_REVIEW', reviewNote: null });
await page.reload({ waitUntil: 'networkidle' });
await section('Macro baixa').locator('.hpsm-toolbar__action:has-text("Aprovar e publicar")').click();
await settle(600);
const approved = await situation('Macro baixa');
expect('aprovado: publicado e revisado por', approved.startsWith('Publicado · revisado por Ana Souza em'), approved);
expect('publicado: só Editar (admin; revisão e publicação saem)', (await section('Macro baixa').locator('.hpsm-toolbar__action').allTextContents()).join('|') === 'Editar');
expect('contador da fila zera', (await leaf.innerText()).replace(/\s+/g, ' ').trim() === 'Relatórios para revisar (0)');

// 6. "Ao salvar".
const saveOptions = async () => page.locator('#report-save-as option').allTextContents();
expect('"Ao salvar" sem revisão obrigatória', (await saveOptions()).join('|') === 'Publicar|Enviar para revisão|Salvar como rascunho' && (await page.inputValue('#report-save-as')) === 'PUBLISHED');
await page.fill('#report-summary', 'Novo relatório para revisão');
await page.selectOption('#report-save-as', 'IN_REVIEW');
await page.keyboard.press('Control+KeyS');
await settle(600);
expect('cria já em revisão', state.lastReportBody?.status === 'IN_REVIEW', JSON.stringify(state.lastReportBody));

state.reviewRequired = true;
reports.find((r) => r.id === 'r3').status = 'DRAFT';
await page.reload({ waitUntil: 'networkidle' });
expect('revisão obrigatória: sem "Publicar"', (await saveOptions()).join('|') === 'Enviar para revisão|Salvar como rascunho' && (await page.inputValue('#report-save-as')) === 'IN_REVIEW');
expect('revisão obrigatória: rascunho só envia', (await section('Rascunho meu').locator('.hpsm-toolbar__action').allTextContents()).join('|') === 'Editar|Enviar para revisão');
expect('dica da regra', (await page.locator('.hpsm-field:has(#report-save-as) .hpsm-field__help').textContent())?.startsWith('Este servidor exige revisão'));

// 7. Usuario comum so ve publicados.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e3?tab=relatorios', { waitUntil: 'networkidle' });
const visible = await page.locator('.hpsm-section .hpsm-readonly:has-text("Macro baixa")').count();
const hidden = await page.locator('.hpsm-section .hpsm-readonly:has-text("Rascunho meu")').count();
expect('usuário comum: só publicados', visible === 1 && hidden === 0, `${visible}/${hidden}`);
state.role = undefined;

// 8. Notificacao de devolucao.
state.notifications = [
  { id: 'n9', type: 'REPORT_RETURNED', detail: 'Inclua os IOCs da macro.', readAt: null, createdAt: '2026-10-22T10:00:00.000Z', entry: { id: 'e3', title: 'relatorio_trimestral.docm' }, actor: { id: 'u2', displayName: 'Bruno Lima' } },
];
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-inbox__bell');
await settle();
const ntext = (await page.locator('.hpsm-inbox__item').first().innerText()).replace(/\s+/g, ' ');
expect('notificação de devolução com o comentário', ntext.includes('Bruno Lima devolveu o seu relatório para ajustes') && ntext.includes('“Inclua os IOCs da macro.”'), ntext);
await page.locator('.hpsm-inbox__item').first().click();
await settle();
expect('notificação abre a aba Relatórios', url() === '/entries/e3?tab=relatorios', url());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nrevisão de relatório: tudo ok');
process.exit(failures ? 1 : 0);
