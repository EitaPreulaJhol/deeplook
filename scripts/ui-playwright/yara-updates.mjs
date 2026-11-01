// Atualizacao dos pacotes (150): ligar e desligar, verificar (ja atualizado, previa com
// aplicar), falha da ultima verificacao, retida com motivos, aprovar, descartar, voltar a
// versao e o aviso que abre as Configuracoes.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const state = createState({ loggedIn: true });
const summary = { added: 3, changed: 2, removed: 1, kept: 1 };
state.yaraUpdates.releases = [
  { id: 'r1', pack: 'signature-base', commit: 'a'.repeat(40), commitDate: '2026-10-20T00:00:00.000Z', status: 'HELD', summary, reasons: ['A licença da fonte mudou: é preciso ler antes de aceitar.', 'Regra nova dispara em amostra Limpa: x em "<b>limpa</b>".'], canRollback: false, createdAt: '2026-11-01T10:00:00.000Z' },
  { id: 'r2', pack: 'reversinglabs', commit: 'b'.repeat(40), commitDate: '2026-10-10T00:00:00.000Z', status: 'APPLIED', summary, reasons: null, canRollback: true, createdAt: '2026-10-25T10:00:00.000Z' },
  { id: 'r3', pack: 'signature-base', commit: 'c'.repeat(40), commitDate: '2026-10-01T00:00:00.000Z', status: 'HELD', summary, reasons: ['Mudança grande: 200 de 752 conjuntos alterados ou removidos.'], canRollback: false, createdAt: '2026-10-20T10:00:00.000Z' },
];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const dialog = page.locator('[role=alertdialog]');
const section = page.locator('section:has-text("Atualização dos pacotes")');
const settle = () => page.waitForTimeout(300);
const msg = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const release = (commit) => page.locator(`.dl-pack-releases > li:has-text("${commit.repeat(8)}")`);

await page.goto(ORIGIN + '/admin?tab=settings', { waitUntil: 'networkidle' });
let text = await section.innerText();
expect('ligada por padrão', await page.locator('#yara-auto-update').isChecked());
expect('versão e última verificação', text.includes('versão de 2026-10-29') && text.includes('ainda não verificado'), text.slice(0, 300));
expect('falha da última verificação', text.includes('Última tentativa falhou: GitHub respondeu 503'));
expect('motivo da retida', text.includes('A licença da fonte mudou') && text.includes('3 novos, 2 alterados, 1 removidos, 1 não compilam'));
expect('motivo como texto', text.includes('<b>limpa</b>'));
await section.screenshot({ path: `${OUT}/yara-atualizacao.png` });

// Ligar e desligar.
await page.locator('label[for="yara-auto-update"]').click();
await settle();
expect('desliga', state.yaraUpdates.autoUpdate === false && !(await page.locator('#yara-auto-update').isChecked()));
await page.locator('label[for="yara-auto-update"]').click();
await settle();

// Verificar: ja atualizado.
const verify = section.locator('.dl-pack-update:has-text("ReversingLabs") button:has-text("Verificar agora")');
await verify.click();
await settle();
expect('já atualizado', (await msg()).includes('ReversingLabs já está na versão mais recente'), await msg());
expect('verifica sem aplicar', state.yaraUpdateCalls.at(-1) === 'check:reversinglabs:false');

// Previa: confirma antes de aplicar.
state.yaraCheckResult = (apply) => ({ outcome: apply ? 'applied' : 'preview', commit: 'd'.repeat(40), summary });
await verify.click();
await settle();
expect('mostra o que muda', (await dialog.innerText()).includes('3 novos, 2 alterados, 1 removidos'));
await dialog.locator('button:has-text("Agora não")').click();
await settle();
expect('agora não: não aplica', state.yaraUpdateCalls.at(-1) === 'check:reversinglabs:false' && (await msg()).includes('nada mudou'), await msg());
await verify.click();
await settle();
await dialog.locator('button:has-text("Aplicar")').click();
await settle();
expect('aplica depois de confirmar', state.yaraUpdateCalls.at(-1) === 'check:reversinglabs:true' && (await msg()).includes('ReversingLabs atualizado'));

// Retida ao verificar.
state.yaraCheckResult = () => ({ outcome: 'held', commit: 'e'.repeat(40), reasons: ['x'], summary });
await verify.click();
await settle();
expect('retida avisa', (await msg()).includes('atualização retida'));

// Aprovar, descartar e voltar.
await release('a').locator('button:has-text("Aprovar")').click();
await settle();
expect('aprovar confirma', (await dialog.innerText()).includes('mesmo com os motivos acima'));
await dialog.locator('button:has-text("Cancelar")').click();
await settle();
expect('cancelar não aprova', !state.yaraUpdateCalls.includes('approve:r1'));
await release('a').locator('button:has-text("Aprovar")').click();
await settle();
await dialog.locator('button:has-text("Aprovar")').click();
await settle();
expect('aprova', state.yaraUpdateCalls.includes('approve:r1') && (await release('a').innerText()).includes('Aplicada'), await release('a').innerText());
expect('aprovada pode voltar', (await release('a').locator('button:has-text("Voltar a versão")').count()) === 1);

await release('c').locator('button:has-text("Descartar")').click();
await settle();
await dialog.locator('button:has-text("Descartar")').click();
await settle();
expect('descarta', (await release('c').innerText()).includes('Descartada') && (await release('c').locator('button').count()) === 0);

await release('b').locator('button:has-text("Voltar a versão")').click();
await settle();
expect('voltar avisa', (await dialog.innerText()).includes('não volta sozinha'));
await dialog.locator('button:has-text("Voltar")').click();
await settle();
expect('volta', (await release('b').innerText()).includes('Desfeita') && (await release('b').locator('button').count()) === 0);

// Aviso na caixa de entrada abre as Configuracoes.
state.notifications = [
  { id: 'n1', type: 'YARA_PACK_UPDATE', detail: 'signature-base: atualização retida para aprovação', readAt: null, createdAt: '2026-11-01T10:00:00.000Z', entry: null, case: null, actor: null },
];
await page.goto(ORIGIN + '/inbox', { waitUntil: 'networkidle' });
const inbox = await page.locator('body').innerText();
expect('aviso legível', inbox.includes('Pacotes de regras: signature-base: atualização retida') && inbox.includes('Pacotes de regras YARA'), inbox.slice(0, 200));

// Quem nao e admin nao ve.
state.role = 'ANALYST';
await page.goto(ORIGIN + '/admin?tab=settings', { waitUntil: 'networkidle' });
expect('analista sem acesso', new URL(page.url()).pathname !== '/admin');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\natualização dos pacotes: tudo ok');
process.exit(failures ? 1 : 0);
