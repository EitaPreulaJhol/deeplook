// Analise estatica (33): aviso de executavel disfarcado, secao na aba Detalhes
// (tipo real, entropia, PE com empacotador, funcoes suspeitas, secoes e imports,
// strings por categoria, IOCs sugeridos com link), "Inserir IOCs sugeridos" no
// Novo relatorio, "Analisar agora" para amostras antigas e linha na ficha impressa.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const INFO = {
  version: 1,
  analyzedAt: '2026-10-22T16:00:00.000Z',
  size: 2483712,
  bytesAnalyzed: 2483712,
  detectedType: { id: 'pe', label: 'Executável do Windows (PE)', extensions: ['exe', 'dll'], executable: true },
  extensionMismatch: { declared: 'pdf', expected: ['exe', 'dll'], dangerous: true },
  entropy: 7.61,
  entropyLevel: 'high',
  strings: {
    total: 312,
    urls: ['http://185.0.2.10/p.bin', 'https://updater-cdn.example/gate'],
    ips: ['185.0.2.10'],
    emails: [],
    paths: ['C:\\Users\\Public\\run.exe'],
    registry: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'],
    suspicious: ['powershell', 'vssadmin'],
  },
  pe: {
    machine: 'x86 (32 bits)',
    is64: false,
    isDll: false,
    subsystem: 'Janelas (GUI)',
    compiledAt: '2026-09-30T12:00:00.000Z',
    sections: [
      { name: 'UPX0', virtualSize: 98304, rawSize: 0, entropy: 0 },
      { name: 'UPX1', virtualSize: 65536, rawSize: 61440, entropy: 7.9 },
      { name: '.rsrc', virtualSize: 4096, rawSize: 4096, entropy: 3.1 },
    ],
    imports: [
      { dll: 'kernel32.dll', functions: 6 },
      { dll: 'wininet.dll', functions: 2 },
    ],
    suspiciousImports: ['InternetOpenA', 'VirtualAllocEx', 'WriteProcessMemory'],
    packer: 'UPX',
  },
  iocCandidates: [
    { kind: 'IPV4', value: '185.0.2.10' },
    { kind: 'DOMAIN', value: 'updater-cdn.example' },
  ],
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
entries.find((e) => e.id === 'e1').staticInfo = INFO;
state.staticResult = { ...INFO, detectedType: { id: 'ole', label: 'Documento Office antigo / MSI (OLE)', extensions: ['doc'], executable: false }, extensionMismatch: { declared: 'docm', expected: ['doc'], dangerous: false }, entropy: 5.2, entropyLevel: 'normal', pe: null, iocCandidates: [] };
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Análise estática"))');
const field = (label) => section.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`).first();

// 1. Aviso e secao.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const warning = (await page.locator('.hpsm-msg--warning .hpsm-msg__text').allTextContents()).join(' ');
expect('aviso de executável disfarçado', warning.includes('o nome diz .pdf, mas o conteúdo é Executável do Windows (PE)'), warning);
expect('tipo real + marcação em vermelho', (await field('Tipo real').innerText()).includes('executável disfarçado: .pdf') && (await field('Tipo real').locator('.hpsm-status--red').count()) === 1);
expect('entropia alta em laranja', (await field('Entropia').innerText()).startsWith('7.61 de 8 — alta') && (await field('Entropia').locator('.hpsm-status--orange').count()) === 1);
expect('PE: arquitetura e tipo', (await field('Arquitetura').innerText()) === 'x86 (32 bits)' && (await field('Tipo').innerText()) === 'Programa (EXE) · Janelas (GUI)');
expect('empacotador UPX', (await field('Empacotador').innerText()) === 'UPX');
const chips = await section.locator('.dl-static-chips code').allTextContents();
expect('funções suspeitas', chips.join('|') === 'InternetOpenA|VirtualAllocEx|WriteProcessMemory', chips.join('|'));
const secEntropy = await section.locator('table[aria-label="Seções do executável"] tbody tr:has-text("UPX1") .hpsm-status--orange').textContent();
expect('seção com entropia alta destacada', secEntropy === '7.90', secEntropy);
expect('imports', (await section.locator('table[aria-label="Bibliotecas importadas"] tbody tr').count()) === 2);
const summaries = await section.locator('.dl-static-strings summary').allTextContents();
expect('strings por categoria', summaries.join('|') === 'Palavras suspeitas (2)|URLs (2)|IPs públicos (1)|E-mails (0)|Caminhos (1)|Chaves de registro (1)', summaries.join('|'));
expect('suspeitas abertas por padrão', await section.locator('.dl-static-strings').first().evaluate((el) => el.open));
await page.screenshot({ path: `${OUT}/analise-estatica.png`, fullPage: true });
await section.locator('.dl-ioc-list a:has-text("updater-cdn.example")').click();
await settle();
expect('IOC sugerido abre a ficha', new URL(page.url()).pathname === '/iocs/domain/updater-cdn.example');

// 2. Inserir IOCs sugeridos no relatorio.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.fill('#report-iocs', '203.0.113.9');
const insert = page.locator('button:has-text("Inserir IOCs sugeridos (2)")');
await insert.click();
expect('IOCs sugeridos inseridos', (await page.inputValue('#report-iocs')) === '203.0.113.9\n185.0.2.10\nupdater-cdn.example', JSON.stringify(await page.inputValue('#report-iocs')));
await insert.click();
expect('inserir de novo não duplica', (await page.inputValue('#report-iocs')).split('\n').length === 3);
await page.fill('#report-iocs', '');

// 3. Amostra antiga: "Analisar agora".
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('sem análise: texto e botão', (await section.innerText()).includes('enviada antes da análise estática'));
await section.locator('button:has-text("Analisar agora")').click();
await settle(600);
expect('analisar agora mostra o resultado', (await field('Tipo real').innerText()).includes('Documento Office antigo') && (await field('Tipo real').locator('.hpsm-status--orange').count()) === 1);
expect('sem PE: bloco do executável oculto', (await section.locator('.dl-static-title:has-text("Executável do Windows")').count()) === 0);
expect('extensão divergente não perigosa: sem aviso no topo', (await page.locator('.hpsm-msg--warning').count()) === 0);

// 4. Usuario comum nao ve "Analisar agora".
delete entries.find((e) => e.id === 'e3').staticInfo;
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('usuário comum não vê "Analisar agora"', (await section.locator('button:has-text("Analisar agora")').count()) === 0);
state.role = undefined;

// 5. Ficha impressa.
const print = await context.newPage();
await print.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
const printText = await print.locator('.dl-print__kv').innerText();
expect('ficha impressa com tipo real e entropia', printText.includes('Executável do Windows (PE) (executável disfarçado de .pdf)') && printText.includes('7.61 de 8'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nanálise estática: tudo ok');
process.exit(failures ? 1 : 0);
