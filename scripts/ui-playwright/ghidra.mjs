// Analise com o Ghidra (item 7.3): secao "Analise com o Ghidra" na aba Detalhes, sob demanda
// (so analistas pedem), situacao, programa, link do projeto .gzf (so quem pode baixar a amostra),
// pseudo-C recolhivel por funcao e as maiores funcoes; .NET com o motivo, desligado, fila e falha.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const C = `bool FUN_140001451(int param_1)\n{\n  hProcess = OpenProcess(0x1fffff,0,4);\n  CreateRemoteThread(hProcess,0,0,lpStartAddress,0,0,0);\n  return true;\n}`;
const DONE = {
  enabled: true,
  applicable: true,
  eligible: true,
  reason: null,
  maxMb: 32,
  canDownload: true,
  analysis: {
    status: 'DONE',
    summary: {
      format: 'Portable Executable (PE)',
      language: 'x86:LE:64:default',
      compiler: 'windows',
      imageBase: '0x140000000',
      entryPoint: '0x1400013f0',
      functions: 44,
      thunks: 21,
      sensitiveFunctions: 3,
      largest: [
        { name: 'FUN_140001a90', entry: '0x140001a90', size: 813, complexity: 42, calls: 5, callers: 1, apis: ['VirtualProtect', 'Sleep', 'malloc', 'free'] },
        { name: 'FUN_140001180', entry: '0x140001180', size: 554, complexity: 17, calls: 15, callers: 1, apis: [] },
      ],
      decompiled: [
        { name: 'entry', entry: '0x1400013f0', isEntryPoint: true, sensitive: [], callers: [], c: 'void entry(void)\n{\n  FUN_140001180();\n}' },
        { name: 'FUN_140001451', entry: '0x140001451', isEntryPoint: false, sensitive: ['CreateRemoteThread', 'OpenProcess'], callers: ['FUN_140001180'], c: C },
        { name: 'FUN_140009999', entry: '0x140009999', isEntryPoint: false, sensitive: ['VirtualProtect'], callers: [], error: 'Decompiler process died' },
      ],
    },
    hasProject: true,
    gzfSize: 106817,
    gzfError: null,
    error: null,
    version: '12.2',
    ms: 18107,
    attempts: 1,
    createdAt: '2026-11-09T12:00:00.000Z',
    startedAt: '2026-11-09T12:00:01.000Z',
    finishedAt: '2026-11-09T12:00:19.000Z',
    requestedBy: { id: 'u1', displayName: 'Ana Souza' },
    ahead: null,
  },
};
const empty = { ...DONE, analysis: null };

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
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Análise com o Ghidra"))');
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`).first();
const action = () => section.locator('button.dl-link-button');
const open = (id) => page.goto(`${ORIGIN}/entries/${id}`, { waitUntil: 'networkidle' });

// 1. Ninguem pediu: o analista pede.
state.ghidra.e1 = empty;
await open('e1');
expect('sob demanda: explica e oferece o botão', (await section.innerText()).includes('Sob demanda') && (await action().innerText()) === 'Analisar com o Ghidra');
await action().click();
await page.waitForTimeout(300);
expect('pedido enviado', state.ghidraPosts.includes('e1'));

// 2. Concluida.
state.ghidra.e1 = DONE;
await open('e1');
expect('situação em verde', (await field('Situação').locator('.hpsm-status--green').innerText()).startsWith('Concluída em'));
expect('quem pediu', (await field('Pedida por').innerText()).startsWith('Ana Souza em'));
expect('programa', (await field('Programa').innerText()) === 'Portable Executable (PE) · x86:LE:64:default · windows');
expect('funções e as que chamam APIs sensíveis em laranja', (await field('Funções').locator('.hpsm-status--orange').innerText()) === '3 chamam APIs sensíveis');
const link = field('Projeto').locator('a');
expect('link do projeto com o tamanho', (await link.getAttribute('href')) === '/api/entries/e1/ghidra/project' && (await link.innerText()).startsWith('Baixar projeto (.gzf, '));
expect('versão e duração', (await field('Ferramenta').innerText()) === 'Ghidra 12.2 · 18 s');
const fns = section.locator('details.dl-ghidra-fn');
expect('três funções descompiladas, recolhidas', (await fns.count()) === 3 && !(await fns.first().evaluate((el) => el.open)));
const inj = fns.filter({ hasText: 'FUN_140001451' });
expect('resumo da função: endereço e o que chama', (await inj.locator('summary').innerText()).includes('0x140001451 · chama CreateRemoteThread, OpenProcess'));
await inj.locator('summary').click();
expect('pseudo-C aberto, com quem chama e cópia', (await inj.locator('pre').innerText()).includes('CreateRemoteThread(hProcess') && (await inj.innerText()).includes('Chamada por: FUN_140001180') && (await inj.locator('button').count()) === 1);
expect('ponto de entrada marcado', (await fns.first().locator('summary').innerText()).includes('ponto de entrada'));
await fns.last().locator('summary').click();
expect('falha do descompilador com o motivo', (await fns.last().innerText()).includes('O descompilador não conseguiu: Decompiler process died.'));
const rows = section.locator('table[aria-label="Maiores funções do executável"] tbody tr');
expect('maiores funções', (await rows.count()) === 2 && (await rows.first().innerText()).includes('VirtualProtect, Sleep, malloc (+1)'));
expect('analista pode pedir de novo', (await action().innerText()) === 'Analisar de novo');
await section.screenshot({ path: `${OUT}/ghidra.png` });

// 3. Usuario comum: ve, nao pede; sem permissao de baixar, sem link.
state.role = 'USER';
state.ghidra.e1 = { ...DONE, canDownload: false };
await open('e1');
expect('usuário comum: sem botão e sem link', (await action().count()) === 0 && (await field('Projeto').innerText()) === 'Só quem enviou e os analistas baixam.');
state.role = undefined;

// 4. .NET: motivo, sem botao.
state.ghidra.e3 = { ...empty, eligible: false, reason: 'Executável .NET: o Ghidra não descompila o código intermediário (IL).' };
await open('e3');
expect('.NET: o motivo e nenhum botão', (await section.innerText()).includes('não descompila o código intermediário') && (await action().count()) === 0);

// 5. Na fila e falha.
state.ghidra.e3 = { ...DONE, analysis: { ...DONE.analysis, status: 'PENDING', summary: null, hasProject: false, ahead: 1, attempts: 0 } };
await open('e3');
expect('na fila, sem botão', (await field('Situação').innerText()) === 'Na fila, 1 antes desta' && (await action().count()) === 0);
state.ghidra.e3 = { ...DONE, analysis: { ...DONE.analysis, status: 'FAILED', summary: null, hasProject: false, error: 'tempo esgotado (900 s)' } };
await open('e3');
expect('falha em laranja com o motivo', (await field('Situação').locator('.hpsm-status--orange').innerText()) === 'Falhou: tempo esgotado (900 s)');

// 6. Desligado e nao executavel.
state.ghidra.e4 = { ...empty, enabled: false };
await open('e4');
expect('desligado: aviso sem botão', (await section.innerText()).includes('desligada (GHIDRA_URL vazio)') && (await action().count()) === 0);
state.ghidra.e4 = { ...empty, applicable: false, eligible: false, reason: 'Só executáveis do Windows (PE) e do Linux (ELF).' };
await open('e4');
expect('não executável: seção escondida', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nGhidra: tudo ok');
process.exit(failures ? 1 : 0);
