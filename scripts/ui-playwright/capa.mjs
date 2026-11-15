// Analise de funcoes (item 7.2): secao "Analise de funcoes (capa)" na aba Detalhes (situacao,
// capacidades com grupo e ATT&CK, strings escondidas do FLOSS, IOCs delas), fila e falha com
// "Analisar de novo" (so analistas), desligado, fora dos executaveis, e as sugestoes no Novo
// relatorio: tecnicas do capa e IOCs do FLOSS.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const DONE = {
  enabled: true,
  eligible: true,
  maxMb: 32,
  analysis: {
    status: 'DONE',
    capa: {
      format: 'pe',
      arch: 'amd64',
      os: 'windows',
      functions: 67,
      libraryFunctions: 12,
      truncated: false,
      rules: [
        {
          name: 'contain obfuscated stackstrings',
          namespace: 'anti-analysis/obfuscation/string/stackstring',
          attack: [],
          mbc: ['ANTI-STATIC ANALYSIS::Executable Code Obfuscation::Argument Obfuscation [B0032.020]'],
          matches: 1,
          addresses: ['0x14000156c'],
        },
        {
          name: 'run PowerShell expression',
          namespace: 'load-code/powershell',
          attack: ['T1059.001'],
          mbc: [],
          matches: 2,
          addresses: ['0x140001530', '0x140001600'],
        },
        { name: 'parse PE header', namespace: 'load-code/pe', attack: [], mbc: [], matches: 0, addresses: [] },
        {
          name: 'spawn thread to RWX shellcode',
          namespace: 'load-code/shellcode',
          attack: [],
          mbc: [],
          matches: 1,
          addresses: ['0x140001700'],
        },
        {
          name: 'encrypt data using AES',
          namespace: 'data-manipulation/encryption/aes',
          attack: ['T1486'],
          mbc: [],
          matches: 1,
          addresses: ['0x140002000'],
        },
      ],
    },
    floss: {
      stack: [{ string: 'stack.evil.test', function: '0x14000156c' }],
      tight: [],
      decoded: [{ string: 'http://xor.evil.test/painel', function: '0x140001530' }],
      truncated: false,
    },
    attack: ['T1059.001', 'T1486'],
    iocCandidates: [
      { kind: 'URL', value: 'http://xor.evil.test/painel' },
      { kind: 'DOMAIN', value: 'xor.evil.test' },
      { kind: 'DOMAIN', value: 'stack.evil.test' },
    ],
    capaError: null,
    flossError: null,
    error: null,
    versions: { capa: '10.0.0', floss: '3.2.0', rules: '10.0.0' },
    ms: 28461,
    attempts: 1,
    nextAttemptAt: '2026-11-09T11:00:00.000Z',
    createdAt: '2026-11-09T11:00:00.000Z',
    startedAt: '2026-11-09T11:00:01.000Z',
    finishedAt: '2026-11-09T11:00:30.000Z',
    ahead: null,
  },
};
const bare = { capa: null, floss: null, attack: [], iocCandidates: null, capaError: null, flossError: null, versions: null, ms: null, startedAt: null, finishedAt: null };

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
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Análise de funções (capa)"))');
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`).first();
const open = async (id) => {
  await page.goto(`${ORIGIN}/entries/${id}`, { waitUntil: 'networkidle' });
};

// 1. Concluida.
state.capa.e1 = DONE;
await open('e1');
expect('seção aparece com a situação em verde', (await field('Situação').locator('.hpsm-status--green').innerText()).startsWith('Concluída em'));
expect('executável e funções', (await field('Executável').innerText()) === 'pe · amd64 · windows · 67 função(ões), 12 de biblioteca', await field('Executável').innerText());
expect('versões e duração', (await field('Ferramentas').innerText()) === 'capa 10.0.0 · regras 10.0.0 · FLOSS 3.2.0 · 28 s', await field('Ferramentas').innerText());
const rows = section.locator('table[aria-label="Capacidades encontradas pelo capa"] tbody tr');
expect('cinco capacidades', (await rows.count()) === 5);
const first = rows.first();
expect(
  'grupo em português, risco em laranja e o MBC abaixo',
  (await first.locator('.hpsm-status--orange').innerText()) === 'contain obfuscated stackstrings' &&
    (await first.innerText()).includes('Antianálise') &&
    (await first.locator('.dl-capa-mbc').innerText()).includes('B0032.020'),
);
const ps = rows.filter({ hasText: 'run PowerShell expression' });
expect('técnica da regra é link para o Histórico filtrado', (await ps.locator('a.dl-capa-attack').getAttribute('href')) === '/history?attack=T1059.001');
expect('funções: contagem com os endereços na dica', (await ps.locator('td').nth(3).innerText()) === '2' && (await ps.locator('td span[title]').last().getAttribute('title')) === '0x140001530\n0x140001600');
expect('regra do arquivo inteiro diz "arquivo"', (await rows.filter({ hasText: 'parse PE header' }).locator('td').nth(3).innerText()) === 'arquivo');
expect(
  'no grupo de carga de código, só o ramo de risco em destaque (shellcode sim, parse PE header não)',
  (await rows.filter({ hasText: 'parse PE header' }).locator('.hpsm-status--orange').count()) === 0 &&
    (await rows.filter({ hasText: 'spawn thread to RWX shellcode' }).locator('.hpsm-status--orange').count()) === 1,
);
const attackList = await section.locator('.dl-attack-list li').allInnerTexts();
expect('técnicas ATT&CK da análise com nome', attackList.join('|') === 'T1059.001 PowerShell|T1486 Data Encrypted for Impact', attackList.join('|'));
const floss = section.locator('.dl-static-block', { hasText: 'Strings escondidas (FLOSS)' });
const summaries = await floss.locator('summary').allInnerTexts();
expect('FLOSS por tipo', summaries.join('|') === 'Decifradas (1)|Montadas na pilha (1)|Montadas na pilha, com laço (tight) (0)', summaries.join('|'));
expect('string decifrada com a função', (await floss.locator('details').first().innerText()).includes('http://xor.evil.test/painel · função 0x140001530'));
const iocLinks = section.locator('.dl-ioc-list a');
expect('IOCs das strings escondidas com link e origem FLOSS', (await iocLinks.count()) === 3 && (await section.locator('.dl-ioc-list__source').first().innerText()) === 'FLOSS');
expect('analista pode pedir de novo', (await section.locator('button:has-text("Analisar de novo")').count()) === 1);
await section.screenshot({ path: `${OUT}/capa.png` });

// 2. Sugestoes no Novo relatorio: tecnicas do capa e IOCs do FLOSS.
await page.goto(`${ORIGIN}/entries/e1?tab=relatorios`, { waitUntil: 'networkidle' });
const insertAttack = page.locator('button:has-text("Inserir técnicas sugeridas pelo capa (2)")');
expect('botão de técnicas sugeridas', (await insertAttack.count()) === 1);
await insertAttack.click();
const chips = await page.locator('.dl-attack-picker__chips li').allInnerTexts();
expect('técnicas inseridas no seletor', chips.some((c) => c.includes('T1059.001')) && chips.some((c) => c.includes('T1486')), chips.join('|'));
await insertAttack.click();
expect('inserir de novo não duplica', (await page.locator('.dl-attack-picker__chips li').count()) === 2);
const insertIocs = page.locator('button:has-text("Inserir IOCs sugeridos")');
await insertIocs.click();
const iocs = (await page.inputValue('#report-iocs')).split('\n');
expect('IOCs do FLOSS entram nas sugestões', iocs.includes('http://xor.evil.test/painel') && iocs.includes('stack.evil.test'), iocs.join('|'));
await page.fill('#report-iocs', '');

// 3. Na fila: posicao, sem botao; analisando.
state.capa.e3 = { ...DONE, analysis: { ...DONE.analysis, ...bare, status: 'PENDING', ahead: 2, attempts: 0 } };
await open('e3');
expect('na fila com a posição', (await field('Situação').innerText()) === 'Na fila, 2 antes desta', await field('Situação').innerText());
expect('na fila: sem botão', (await section.locator('button.dl-link-button').count()) === 0);
state.capa.e3 = { ...DONE, analysis: { ...DONE.analysis, ...bare, status: 'PENDING', ahead: 0, attempts: 1, error: 'o serviço capa não respondeu' } };
await open('e3');
expect('nova tentativa mostra o motivo', (await field('Situação').innerText()) === 'Na fila (nova tentativa: o serviço capa não respondeu)', await field('Situação').innerText());
state.capa.e3 = { ...DONE, analysis: { ...DONE.analysis, ...bare, status: 'RUNNING', startedAt: '2026-11-09T11:00:01.000Z' } };
await open('e3');
expect('analisando', (await field('Situação').innerText()).startsWith('Analisando desde'));

// 4. Falha e "Analisar de novo".
state.capa.e3 = { ...DONE, analysis: { ...DONE.analysis, ...bare, status: 'FAILED', error: 'tempo esgotado (600 s)' } };
await open('e3');
expect('falha em laranja com o motivo', (await field('Situação').locator('.hpsm-status--orange').innerText()) === 'Falhou: tempo esgotado (600 s)');
expect('falha: sem tabela de capacidades', (await section.locator('table').count()) === 0);
expect('falha por tempo: a dica de executável grande', (await section.innerText()).includes('Executáveis grandes ou em Go costumam passar do teto da análise de funções'));
await section.locator('button:has-text("Analisar de novo")').click();
await page.waitForTimeout(300);
expect('pedido enviado', state.capaPosts.includes('e3'), state.capaPosts.join(','));

// 4b. Analise de funcoes que nao terminou num executavel do Windows: so as regras do nivel do
// arquivo (plans/ajustes-usabilidade, item 3), com a explicacao e o motivo.
state.capa.e1 = {
  ...DONE,
  analysis: {
    ...DONE.analysis,
    capa: { ...DONE.analysis.capa, functions: null, libraryFunctions: null, fileOnly: true },
    capaError: 'tempo esgotado (600 s)',
  },
};
await open('e1');
expect('só o arquivo: o executável diz que a análise de funções não terminou', (await field('Executável').innerText()) === 'pe · amd64 · windows · só o nível do arquivo (a análise de funções não terminou)', await field('Executável').innerText());
const fileOnlyText = await section.innerText();
expect(
  'só o arquivo: a explicação, a dica e o motivo, com as capacidades',
  fileOnlyText.includes('estas são só as regras do nível do arquivo') &&
    fileOnlyText.includes('Executáveis grandes ou em Go') &&
    fileOnlyText.includes('capa: tempo esgotado (600 s)') &&
    (await rows.count()) === 5,
  fileOnlyText.slice(0, 400),
);
await section.screenshot({ path: `${OUT}/capa-so-arquivo.png` });
state.capa.e1 = DONE;

// 5. Usuario comum: ve, mas nao pede.
state.role = 'USER';
await open('e3');
expect('usuário comum não vê o botão', (await section.locator('button.dl-link-button').count()) === 0 && (await section.count()) === 1);
state.role = undefined;

// 6. Executavel sem analise: pedir; desligado: aviso; fora dos executaveis: secao escondida.
state.capa.e4 = { enabled: true, eligible: true, maxMb: 32, analysis: null };
await open('e4');
expect('sem análise: botão "Analisar funções"', (await section.innerText()).includes('ainda não teve as funções analisadas') && (await section.locator('button:has-text("Analisar funções")').count()) === 1);
state.capa.e4 = { enabled: false, eligible: true, maxMb: 32, analysis: null };
await open('e4');
expect('desligado: aviso e sem botão', (await section.innerText()).includes('desligada (CAPA_URL vazio)') && (await section.locator('button.dl-link-button').count()) === 0);
state.capa.e4 = { enabled: true, eligible: false, maxMb: 32, analysis: null };
await open('e4');
expect('não executável: seção escondida', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncapa: tudo ok');
process.exit(failures ? 1 : 0);
