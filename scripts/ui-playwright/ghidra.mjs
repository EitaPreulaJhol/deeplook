// Analise com o Ghidra (item 7.3): secao "Analise com o Ghidra" na aba Detalhes, sob demanda
// (so analistas pedem), situacao, programa, link do projeto .gzf (so quem pode baixar a amostra),
// pseudo-C recolhivel por funcao e as maiores funcoes; .NET com o motivo, desligado, fila e falha.
// E a janela com o pseudo-C de todas as funcoes (plans/ghidra-pseudo-c): lista com busca e
// filtros, nomes clicaveis no codigo, voltar e avancar, Esc e o download do .c.
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
    hasPseudo: true,
    pseudoFunctions: 5,
    pseudoTotal: 6,
    pseudoDeadlineHit: true,
    pseudoCapHit: false,
    pseudoError: null,
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

const fn = (entry, name, extra) => ({
  entry,
  name,
  size: 100,
  complexity: 2,
  isEntryPoint: false,
  library: false,
  sensitive: [],
  apis: [],
  callers: [],
  callerCount: 0,
  callees: [],
  calleeCount: 0,
  c: null,
  truncated: false,
  skipped: null,
  error: null,
  ...extra,
});
const ref = (entry, name) => ({ entry, name });
const PSEUDO = {
  total: 6,
  deadlineHit: true,
  capHit: false,
  functions: [
    fn('0x1400013f0', 'entry', {
      isEntryPoint: true,
      c: 'void entry(void)\n{\n  FUN_140001180();\n  return;\n}\n',
      callees: [ref('0x140001180', 'FUN_140001180')],
      calleeCount: 1,
    }),
    fn('0x140001451', 'FUN_140001451', {
      sensitive: ['CreateRemoteThread', 'OpenProcess'],
      apis: ['CreateRemoteThread', 'OpenProcess'],
      c: C,
      callers: [ref('0x140001180', 'FUN_140001180')],
      callerCount: 1,
    }),
    fn('0x140001180', 'FUN_140001180', {
      size: 554,
      c: 'void FUN_140001180(void)\n{\n  /* injeta */\n  FUN_140001451(4);\n}\n',
      callers: [ref('0x1400013f0', 'entry')],
      callerCount: 1,
      callees: [ref('0x140001451', 'FUN_140001451'), ref('0x140777777', null)],
      calleeCount: 3,
    }),
    fn('0x140009999', 'FUN_140009999', { skipped: 'deadline' }),
    fn('0x140002000', '__security_init_cookie', { library: true, c: 'void __security_init_cookie(void)\n{\n}\n' }),
  ],
};

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
// O botao de pedir (os outros botoes da secao abrem a janela de funcoes).
const action = () => section.locator('button.dl-link-button', { hasText: /^(Analisar|Pedindo)/ });
const open = (id) => page.goto(`${ORIGIN}/entries/${id}`, { waitUntil: 'networkidle' });
state.ghidraFns.e1 = PSEUDO;

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
expect('pseudo-C aberto, com quem chama, cópia e "abrir na janela"', (await inj.locator('pre').innerText()).includes('CreateRemoteThread(hProcess') && (await inj.innerText()).includes('Chamada por: FUN_140001180') && (await inj.locator('button').count()) === 2 && (await inj.locator('button.dl-link-button').innerText()) === 'Abrir na janela');
expect('ponto de entrada marcado', (await fns.first().locator('summary').innerText()).includes('ponto de entrada'));
await fns.last().locator('summary').click();
expect('falha do descompilador com o motivo', (await fns.last().innerText()).includes('O descompilador não conseguiu: Decompiler process died.'));
const rows = section.locator('table[aria-label="Maiores funções do executável"] tbody tr');
expect('maiores funções', (await rows.count()) === 2 && (await rows.first().innerText()).includes('VirtualProtect, Sleep, malloc (+1)'));
expect('analista pode pedir de novo', (await action().innerText()) === 'Analisar de novo');
await section.screenshot({ path: `${OUT}/ghidra.png` });

// 2b. Janela com o pseudo-C de todas as funcoes.
const dialog = page.locator('dialog.dl-ghidra-code');
const items = dialog.locator('.dl-ghidra-code__items li');
const code = dialog.locator('pre.dl-ghidra-code__src');
const shownName = () => dialog.locator('.dl-ghidra-code__name code').innerText();
const waitName = (name) => dialog.locator('.dl-ghidra-code__name code', { hasText: name }).waitFor();
const all = section.locator('button', { hasText: 'Ver todas as funções (5)' });
await all.click();
await dialog.waitFor();
await waitName('entry');
expect('janela modal aberta, com título e foco na busca', (await dialog.evaluate((d) => d.open && d.matches(':modal'))) && (await page.evaluate(() => document.activeElement?.type)) === 'search' && (await dialog.locator('h2').innerText()) === 'Funções do executável (pseudo-C)');
const counts = await dialog.locator('.dl-ghidra-code__count').innerText();
expect('contagem, funções fora da lista e aviso do prazo', counts.includes('5 de 5 função(ões)') && counts.includes('O programa tem 6; a lista para em 5.') && counts.includes('O prazo da análise acabou antes'), counts);
expect('lista na ordem, ponto de entrada escolhido', (await items.count()) === 5 && (await items.first().locator('button').getAttribute('aria-current')) === 'true' && (await shownName()) === 'entry');
expect('código com números de linha e realce', (await dialog.locator('.dl-ghidra-code__gutter').innerText()).startsWith('1\n2\n3') && (await code.locator('.dl-c-keyword', { hasText: 'return' }).count()) === 1 && (await code.locator('.dl-c-type', { hasText: 'void' }).count()) >= 1);
await code.locator('button.dl-ghidra-code__link', { hasText: 'FUN_140001180' }).click();
await waitName('FUN_140001180');
const meta = await dialog.locator('.dl-ghidra-code__meta').innerText();
expect('nome no código leva à função; chamadores e chamadas, a de fora só com endereço', meta.includes('Chamada por: entry') && meta.includes('Chama: FUN_140001451, 0x140777777 e mais 1'), meta);
await dialog.locator('button', { hasText: '‹ Voltar' }).click();
await waitName('entry');
const forward = dialog.locator('button', { hasText: 'Avançar ›' });
expect('voltar', (await shownName()) === 'entry' && (await forward.isEnabled()));
await forward.click();
await waitName('FUN_140001180');
expect('avançar', (await shownName()) === 'FUN_140001180');
await code.locator('button.dl-ghidra-code__link', { hasText: 'FUN_140001451' }).click();
await waitName('FUN_140001451');
expect('função sensível: APIs em laranja e o código', (await dialog.locator('.dl-ghidra-code__meta .hpsm-status--orange').innerText()).includes('CreateRemoteThread') && (await code.innerText()).includes('OpenProcess(0x1fffff'));
await dialog.screenshot({ path: `${OUT}/ghidra-funcoes-codigo.png` });
await dialog.getByLabel('Só as que chamam APIs sensíveis').check({ force: true });
await page.waitForTimeout(300);
expect('filtro: só as sensíveis, pedido ao servidor', (await items.count()) === 1 && state.ghidraFnQueries.at(-1).includes('sensitive=true'));
await dialog.getByLabel('Só as que chamam APIs sensíveis').uncheck({ force: true });
await dialog.getByLabel('Esconder as de biblioteca').check({ force: true });
await page.waitForTimeout(300);
expect('esconder as de biblioteca', (await items.count()) === 4 && !(await dialog.locator('.dl-ghidra-code__items').innerText()).includes('__security_init_cookie'));
await dialog.getByLabel('Esconder as de biblioteca').uncheck({ force: true });
await dialog.locator('input[type="search"]').fill('9999');
await page.waitForTimeout(600);
expect('busca pelo endereço', (await items.count()) === 1 && state.ghidraFnQueries.at(-1).includes('q=9999'));
await items.first().locator('button').click();
await waitName('FUN_140009999');
expect('função pulada pelo prazo: sem código, com o motivo', (await dialog.innerText()).includes('Sem pseudo-C: o prazo da análise acabou antes desta função.') && (await code.count()) === 0);
const dl = dialog.locator('a', { hasText: 'Baixar tudo (.c)' });
expect('download do .c para quem pode baixar', (await dl.getAttribute('href')) === '/api/entries/e1/ghidra/pseudo-c');
await dialog.screenshot({ path: `${OUT}/ghidra-funcoes.png` });

// 2b'. Busca no codigo de todas as funcoes (fase 5).
await dialog.getByLabel('Busca no código').check();
const go = dialog.locator('button[type="submit"]', { hasText: 'Procurar' });
const hits = dialog.locator('button.dl-ghidra-code__hit');
expect('modo busca: lista some, botão só com texto suficiente', (await dialog.locator('input[type="search"]').count()) === 1 && !(await go.isEnabled()));
await dialog.getByLabel('Texto no pseudo-C de todas as funções').fill('process');
await go.click();
await hits.first().waitFor();
const found = await dialog.locator('.dl-ghidra-code__count').innerText();
expect(
  'busca: linhas por função, com as ocorrências marcadas',
  found.includes('2 linha(s) em 1 de 4 função(ões) com código') &&
    (await hits.count()) === 2 &&
    (await dialog.locator('.dl-ghidra-code__hit-name code').innerText()) === 'FUN_140001451' &&
    (await hits.first().locator('mark').allInnerTexts()).join() === 'Process,Process' &&
    state.ghidraSearchQueries.at(-1) === 'q=process',
  found,
);
await hits.nth(1).click();
await waitName('FUN_140001451');
await page.waitForTimeout(100);
const marked = await page.evaluate(() => ({
  all: CSS.highlights.get('dl-ghidra-match')?.size ?? -1,
  current: [...(CSS.highlights.get('dl-ghidra-match-current') ?? [])].map((r) => r.toString()),
}));
expect(
  'resultado abre a função na linha: número destacado e as ocorrências marcadas no código',
  (await dialog.locator('.dl-ghidra-code__gutter .is-focus').innerText()) === '4' &&
    (await hits.nth(1).getAttribute('aria-current')) === 'true' &&
    marked.all === 2 &&
    marked.current.join() === 'Process',
  JSON.stringify(marked),
);
await dialog.screenshot({ path: `${OUT}/ghidra-funcoes-busca.png` });
await dialog.getByLabel('Diferenciar maiúsculas e minúsculas').check({ force: true });
await go.click();
await dialog.locator('.dl-ghidra-code__count', { hasText: 'Nenhuma ocorrência' }).waitFor();
expect(
  'com caixa: nenhuma ocorrência, pedido com caseSensitive',
  (await dialog.locator('.dl-ghidra-code__count').innerText()).includes('Nenhuma ocorrência em 4 função(ões) com código.') &&
    (await hits.count()) === 0 &&
    state.ghidraSearchQueries.at(-1) === 'q=process&caseSensitive=true',
);
await dialog.getByLabel('Lista de funções').check();
expect(
  'de volta à lista: as marcas saem do código',
  (await items.count()) === 1 && (await page.evaluate(() => CSS.highlights.has('dl-ghidra-match'))) === false,
  `${await items.count()} ${await page.evaluate(() => [...CSS.highlights.keys()].join())}`,
);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
expect('Esc fecha e o foco volta para quem abriu', (await page.evaluate(() => document.activeElement?.textContent)) === 'Ver todas as funções (5)');
await inj.locator('button', { hasText: 'Abrir na janela' }).click();
await dialog.waitFor();
await waitName('FUN_140001451');
expect('"Abrir na janela" já mostra a função', (await shownName()) === 'FUN_140001451' && !(await dialog.locator('button', { hasText: '‹ Voltar' }).isEnabled()));
await dialog.locator('button', { hasText: 'Fechar' }).click();
await dialog.waitFor({ state: 'detached' });
expect('Fechar fecha', (await dialog.count()) === 0);

// 2c. Sem o pseudo-C completo: analise antiga, ou o motivo.
state.ghidra.e1 = { ...DONE, analysis: { ...DONE.analysis, hasPseudo: false, pseudoFunctions: 0 } };
await open('e1');
expect('análise antiga: pede para analisar de novo, sem janela', (await section.innerText()).includes('Análise anterior ao pseudo-C completo') && (await section.locator('button', { hasText: 'Abrir na janela' }).count()) === 0);
state.ghidra.e1 = { ...DONE, analysis: { ...DONE.analysis, hasPseudo: false, pseudoFunctions: 0, pseudoError: 'o pseudo-C completo não foi gerado' } };
await open('e1');
expect('sem o pseudo-C: o motivo', (await section.innerText()).includes('Pseudo-C completo indisponível: o pseudo-C completo não foi gerado.'));

// 3. Usuario comum: ve, nao pede; sem permissao de baixar, sem link.
state.role = 'USER';
state.ghidra.e1 = { ...DONE, canDownload: false };
await open('e1');
expect('usuário comum: sem botão e sem link', (await action().count()) === 0 && (await field('Projeto').innerText()) === 'Só quem enviou e os analistas baixam.');
await section.locator('button', { hasText: 'Ver todas as funções (5)' }).click();
await dialog.waitFor();
expect('usuário comum: vê a janela, sem o download do .c', (await items.count()) === 5 && (await dialog.locator('a', { hasText: 'Baixar tudo (.c)' }).count()) === 0);
await page.keyboard.press('Escape');
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
