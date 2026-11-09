// Identificacao e desempacotamento (itens 7.8 e 7.9): secao na aba Detalhes com a situacao, o
// desempacotador, o que o Detect It Easy reconheceu (empacotador e protetor em destaque) e os
// arquivos extraidos (link para a amostra filha com o veredito, ou por que ficou de fora); falha
// com o motivo e "Analisar de novo"; protegido (Themida) com a nota; usuario comum sem botao;
// desligado; nao executavel escondido.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const base = { enabled: true, applicable: true, maxMb: 64 };
const job = {
  status: 'DONE',
  unpacker: 'nsis',
  label: 'NSIS',
  note: null,
  files: [
    { name: 'carga.exe', size: 31232, entryId: 'e2' },
    { name: 'leia.txt', size: 346, entryId: 'e3' },
    { name: 'app/vazio.dat', size: 0, skipped: 'arquivo vazio' },
  ],
  error: null,
  detections: [
    { filetype: 'PE32', type: 'compiler', name: 'MinGW', version: '', info: '', string: 'Compiler: MinGW(GCC: (GNU) 14-win32)' },
    { filetype: 'PE32', type: 'installer', name: 'Nullsoft Scriptable Install System', version: '3.11-1', info: 'zlib, solid', string: 'Installer: Nullsoft Scriptable Install System(3.11-1)[zlib, solid]' },
  ],
  dieVersion: '3.21',
  dieError: null,
  ms: 4,
  attempts: 1,
  createdAt: '2026-11-09T12:00:00.000Z',
  startedAt: '2026-11-09T12:00:01.000Z',
  finishedAt: '2026-11-09T12:00:05.000Z',
};
const DONE = {
  ...base,
  job,
  children: [
    { id: 'e2', title: 'carga.exe', verdict: 'MALICIOUS' },
    { id: 'e3', title: 'leia.txt', verdict: 'UNKNOWN' },
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
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Identificação e desempacotamento"))');
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`).first();
const action = () => section.locator('button.dl-link-button');
const open = (id) => page.goto(`${ORIGIN}/entries/${id}`, { waitUntil: 'networkidle' });

// 1. Concluido com filhas.
state.unpack.e1 = DONE;
await open('e1');
expect('situação com a contagem', (await field('Situação').locator('.hpsm-status--green').innerText()).startsWith('2 arquivo(s) extraído(s) em'));
expect('desempacotador', (await field('Desempacotador').innerText()) === 'NSIS');
const dieItems = await section.locator('.dl-die-list li').allInnerTexts();
expect('Detect It Easy: compilador e instalador, sem destaque (nada esconde o código)', dieItems.join('|') === 'Compiler: MinGW(GCC: (GNU) 14-win32)|Installer: Nullsoft Scriptable Install System(3.11-1)[zlib, solid]' && (await section.locator('.dl-die-list .hpsm-status--orange').count()) === 0, dieItems.join('|'));
const items = section.locator('.dl-unpack-files li');
expect('três arquivos listados', (await items.count()) === 3);
expect('filha com link e veredito', (await items.first().locator('a').getAttribute('href')) === '/entries/e2' && (await items.first().locator('.hpsm-status--red').count()) === 1);
expect('arquivo de fora com o motivo', (await items.last().innerText()).includes('app/vazio.dat') && (await items.last().innerText()).includes('ficou de fora: arquivo vazio'));
expect('com filhas, sem botão', (await action().count()) === 0);
await section.screenshot({ path: `${OUT}/desempacotamento.png` });

// 2. Falha: motivo e tentar de novo.
state.unpack.e3 = { ...base, job: { ...job, status: 'FAILED', unpacker: 'inno', label: 'Inno Setup', files: null, error: 'formato do Inno Setup 6.4.3: o innoextract 1.9 só lê até o 6.2' }, children: [] };
await open('e3');
expect('falha em laranja com o motivo', (await field('Situação').locator('.hpsm-status--orange').innerText()) === 'Falhou: formato do Inno Setup 6.4.3: o innoextract 1.9 só lê até o 6.2');
expect('botão "Analisar de novo"', (await action().innerText()) === 'Analisar de novo');
await action().click();
await page.waitForTimeout(300);
expect('analisar de novo envia o pedido', (await action().count()) <= 1 && state.unpackPosts.includes('e3'));

// 2b. Protegido com Themida: a nota em laranja e o protetor em destaque.
state.unpack.e3 = {
  ...base,
  job: {
    ...job,
    unpacker: null,
    label: null,
    files: [],
    note: 'protegido com Themida (Detect It Easy): precisa de um desempacotador que execute a amostra',
    detections: [{ filetype: 'PE32', type: 'protector', name: 'Themida', version: '3.x', info: '', string: 'Protector: Themida(3.x)' }],
  },
  children: [],
};
await open('e3');
expect('protegido: a nota em laranja', (await field('Situação').locator('.hpsm-status--orange').innerText()) === 'Protegido com Themida (Detect It Easy): precisa de um desempacotador que execute a amostra');
expect('protetor em destaque', (await section.locator('.dl-die-list .hpsm-status--orange').innerText()) === 'Protector: Themida(3.x)');

// 3. Sem identificacao ainda: o botao; usuario comum sem botao.
state.unpack.e4 = { ...base, job: null, children: [] };
await open('e4');
expect('sem identificação: explica e oferece o botão', (await section.innerText()).includes('Ainda não identificado') && (await action().innerText()) === 'Identificar e desempacotar');
state.role = 'USER';
await open('e4');
expect('usuário comum: sem botão', (await action().count()) === 0);
state.role = undefined;

// 4. Na fila, nada reconhecido, desligado e nao executavel.
state.unpack.e4 = { ...base, job: { ...job, status: 'PENDING', files: null }, children: [] };
await open('e4');
expect('na fila, sem botão', (await field('Situação').innerText()) === 'Na fila' && (await action().count()) === 0);
state.unpack.e4 = { ...base, job: { ...job, unpacker: null, label: null, files: [], note: 'nada a desempacotar' }, children: [] };
await open('e4');
const nothing = await field('Situação').innerText();
expect('nada a desempacotar, sem destaque', nothing.startsWith('Nada a desempacotar') && (await field('Situação').locator('.hpsm-status--orange').count()) === 0, nothing);
state.unpack.e4 = { ...base, enabled: false, job: null, children: [] };
await open('e4');
expect('desligado: aviso', (await section.innerText()).includes('desligados (UNPACK_URL vazio)') && (await action().count()) === 0);
state.unpack.e4 = { ...base, applicable: false, job: null, children: [] };
await open('e4');
expect('não executável: seção escondida', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndesempacotamento: tudo ok');
process.exit(failures ? 1 : 0);
