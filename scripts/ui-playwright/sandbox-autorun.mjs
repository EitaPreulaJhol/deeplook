// Execucao automatica da amostra no ambiente isolado: a caixa ao abrir o ambiente (lembrada no
// navegador), o pedido que vai para a API, o estado enquanto espera o Windows e o Sysmon, a
// execucao feita (com e sem o Sysmon, na sessao do usuario ou como SYSTEM), a falha com o motivo e
// o evento no historico da amostra.
import { chromium } from 'playwright';

import { createState, events, ORIGIN, OUT, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
// A janela do console abre num popup: fecha (o roteiro olha o painel).
context.on('page', (p) => {
  if (p !== page) void p.close();
});

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const panel = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Ambiente isolado"))');
const box = () => page.locator('#sandbox-autorun-e1');
const panelText = async () => (await panel.innerText()).replace(/\s+/g, ' ');

// 1. Sem ambiente: a secao so aponta para o botao da barra; o dialogo tem as opcoes de inicio.
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await panel.waitFor();
const toolbarOpen = page.locator('.hpsm-toolbar button', { hasText: 'Abrir ambiente isolado' });
const dialog = page.locator('dialog.dl-launch-dialog');
expect(
  '"Abrir ambiente isolado" na barra de ferramentas; na seção, nem botão nem caixa',
  (await toolbarOpen.count()) === 1 &&
    (await panel.locator('button', { hasText: 'Abrir ambiente' }).count()) === 0 &&
    (await box().count()) === 0 &&
    (await panelText()).includes('use "Abrir ambiente isolado" na barra de ferramentas'),
);
await page.locator('.hpsm-toolbar').first().screenshot({ path: `${OUT}/barra-amostra-sandbox.png` });
await toolbarOpen.click();
await dialog.waitFor();
const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ');
expect(
  'diálogo modal com o título, a amostra, a caixa desmarcada e o foco em "Iniciar ambiente"',
  (await dialog.evaluate((d) => d.open && d.matches(':modal'))) &&
    (await dialog.locator('h2').innerText()) === 'Abrir ambiente isolado' &&
    dialogText.includes('Amostra: setup_v2.exe') &&
    dialogText.includes('a amostra roda sozinha na sessão do usuário da VM') &&
    !(await box().isChecked()) &&
    (await page.evaluate(() => document.activeElement?.textContent)) === 'Iniciar ambiente',
  dialogText,
);
await dialog.screenshot({ path: `${OUT}/sandbox-iniciar.png` });
await dialog.locator('button', { hasText: 'Cancelar' }).click();
await dialog.waitFor({ state: 'detached' });
expect(
  'Cancelar fecha sem pedir nada e o foco volta ao botão da barra',
  !state.sandboxOpens && (await page.evaluate(() => document.activeElement?.textContent)) === 'Abrir ambiente isolado',
);
// Erro da API: aparece no dialogo, que continua aberto.
state.sandboxOpenError = 'Limite de ambientes ativos atingido.';
await toolbarOpen.click();
await dialog.waitFor();
await dialog.locator('button', { hasText: 'Iniciar ambiente' }).click();
await dialog.locator('[role="alert"]').waitFor();
expect('erro da API dentro do diálogo, aberto', (await dialog.locator('[role="alert"]').innerText()) === 'Limite de ambientes ativos atingido.' && (await dialog.evaluate((d) => d.open)));
state.sandboxOpenError = undefined;
// Marcada a caixa, "Iniciar ambiente" pede com autoRun e leva para a aba Analise.
await dialog.locator('label[for="sandbox-autorun-e1"]').click();
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await toolbarOpen.click();
await dialog.waitFor();
expect('a escolha da caixa fica lembrada no navegador', await box().isChecked());
await dialog.locator('button', { hasText: 'Iniciar ambiente' }).click();
await dialog.waitFor({ state: 'detached' });
await page.locator('.dl-sandbox__autorun').first().waitFor();
expect('pedido com autoRun e a aba Análise aberta', state.sandboxOpens?.at(-1)?.body?.autoRun === true && page.url().includes('tab=analise'), JSON.stringify(state.sandboxOpens));
expect('esperando o Windows e o Sysmon', (await panelText()).includes('Execução automática: aguardando o Windows e o Sysmon'));

// 2. Executada, sem o Sysmon: a hora, o usuario e o aviso.
const at = new Date(Date.UTC(2026, 10, 14, 15, 2)).toISOString();
state.sandboxes.e1 = { ...runningSandbox('e1', 40), autoRun: 'DONE', autoRunAt: at, autoRunUser: 'DEEPLOOK\\DeepLookUser', autoRunSysmon: false };
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.dl-sandbox__autorun').first().waitFor();
let text = await panelText();
expect('executada, com a conta', text.includes('Amostra executada automaticamente às') && text.includes('na sessão de DEEPLOOK\\DeepLookUser'), text.slice(0, 300));
expect('aviso de que o Sysmon não estava no ar', text.includes('O Sysmon não estava no ar'));
await panel.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/sandbox-autorun.png`, fullPage: true });

// 3. Como SYSTEM (nenhum usuario logado): o aviso de que nao aparece no console.
state.sandboxes.e1 = { ...state.sandboxes.e1, autoRunUser: 'SYSTEM', autoRunSysmon: true };
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.dl-sandbox__autorun').first().waitFor();
text = await panelText();
expect('como SYSTEM: o aviso', text.includes('a amostra rodou como SYSTEM e não aparece no console') && !text.includes('O Sysmon não estava no ar'));

// 4. Falhou: o motivo.
state.sandboxes.e1 = { ...state.sandboxes.e1, autoRun: 'FAILED', autoRunError: 'o agente da VM não respondeu a tempo; a amostra não foi executada' };
await page.reload({ waitUntil: 'networkidle' });
expect('falha com o motivo', (await panelText()).includes('A execução automática falhou: o agente da VM não respondeu a tempo'));

// 5. Ambiente encerrado: o botao da barra volta, e o dialogo lembra a escolha.
state.sandboxes.e1 = { ...runningSandbox('e1', 40), status: 'STOPPED', stoppedAt: at };
await page.reload({ waitUntil: 'networkidle' });
await toolbarOpen.click();
await dialog.waitFor();
expect('encerrado: o botão volta e a escolha continua lembrada', await box().isChecked());
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });

// 6. Historico da amostra.
events.e1.push({ id: 'e1-autorun', entryId: 'e1', type: 'SANDBOX_AUTORUN', toValue: 'no-sysmon', detail: 'DEEPLOOK\\DeepLookUser', createdAt: at, actor: { id: 'u1', displayName: 'Ana Souza' } });
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
const row = page.locator('tbody tr', { hasText: 'Amostra executada automaticamente' });
const rowText = (await row.first().innerText()).replace(/\s+/g, ' ');
expect('evento no histórico, de quem pediu, com a conta e sem o Sysmon', (await row.count()) === 1 && rowText.includes('Ana Souza') && rowText.includes('na sessão de DEEPLOOK\\DeepLookUser (sem o Sysmon)'), rowText);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nexecução automática do sandbox: tudo ok');
process.exit(failures ? 1 : 0);
