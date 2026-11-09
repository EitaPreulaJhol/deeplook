// Analise estatica (33): aviso de executavel disfarcado, secao na aba Detalhes
// (tipo real, entropia, PE com empacotador, funcoes suspeitas, secoes e imports,
// strings por categoria, IOCs sugeridos com link), "Inserir IOCs sugeridos" no
// Novo relatorio, "Analisar agora" para amostras antigas e linha na ficha impressa.
// Item 7.1: alertas do PE, imphash, Rich header, assinatura, versao, recursos, exports, .NET
// e o aviso da analise antiga (o INFO abaixo tem o formato de antes do 7.1).
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

// 5. Executavel Linux (168): bloco ELF com alertas, bibliotecas, funcoes e secoes.
const e1 = entries.find((e) => e.id === 'e1');
const peInfo = e1.staticInfo;
e1.staticInfo = {
  ...INFO,
  detectedType: { id: 'elf', label: 'Executável Linux (ELF)', extensions: ['', 'elf'], executable: true },
  extensionMismatch: null,
  pe: null,
  elf: {
    class: 64, endian: 'little', machine: 'x86-64', type: 'executável (PIE)', entry: '0x4010',
    interpreter: '/lib64/ld-linux-x86-64.so.2', stripped: true, static: false,
    sections: [{ name: '.text', type: 'PROGBITS', size: 40960, entropy: 7.9 }, { name: 'UPX1', type: 'PROGBITS', size: 4096, entropy: 6.1 }],
    needed: ['libc.so.6'], importedSymbols: 42, suspiciousSymbols: ['ptrace', 'memfd_create'],
    rwxSegments: 1, packer: 'UPX', alerts: ['segmento gravável e executável', 'empacotado com UPX'],
  },
};
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const elfBlock = section.locator('.dl-static-block', { hasText: 'Executável Linux (ELF)' });
const elfText = (await elfBlock.innerText()).replace(/\s+/g, ' ');
expect('bloco ELF com arquitetura e tipo', elfText.includes('x86-64 · 64 bits · little-endian') && elfText.includes('executável (PIE) · sem símbolos (stripped)'), elfText.slice(0, 300));
expect('alertas do ELF na seção', (await elfBlock.locator('.dl-doc-alerts li').allInnerTexts()).includes('segmento gravável e executável'));
expect('bibliotecas e funções suspeitas', elfText.includes('libc.so.6') && elfText.includes('memfd_create') && elfText.includes('42 função(ões) importada(s)'));
expect('seção de entropia alta destacada', (await elfBlock.locator('tbody tr').count()) === 2);
await elfBlock.screenshot({ path: `${OUT}/analise-elf.png` });
e1.staticInfo = peInfo;

// 6. Analise nova do PE (item 7.1): alertas, hashes, assinatura, versao, recursos, exports.
const SIGNER = {
  subject: 'Fornecedor Teste Ltda', issuer: 'DeepLook Teste AC', serial: '0A1B', validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2036-01-01T00:00:00.000Z', sha1: 'c'.repeat(40), sha256: 'd'.repeat(64),
};
const NEW_PE = {
  ...INFO.pe,
  machine: 'x64 (64 bits)', is64: true, packer: null,
  sections: [
    { name: '.text', virtualSize: 8192, rawSize: 8192, entropy: 6.1, flags: 'R-X' },
    { name: '.injt', virtualSize: 4096, rawSize: 4096, entropy: 7.4, flags: 'RWX' },
  ],
  imports: [
    { dll: 'kernel32.dll', functions: 3, names: ['OpenProcess', 'VirtualAllocEx', 'WriteProcessMemory'] },
    { dll: 'ws2_32.dll', functions: 1, names: ['socket'] },
  ],
  imphash: 'b1f24be7621e0e845cc9e28d113ca280',
  rich: { hash: '2f3d7179f6890c4f2b6e9625cd202627', checksumValid: false, entries: [{ product: 261, build: 30795, count: 12 }] },
  exports: { dll: 'teste.dll', total: 2, truncated: false, symbols: [{ ordinal: 1, name: 'ServiceMain', forwarder: null }, { ordinal: 2, name: 'Dormir', forwarder: 'kernel32.Sleep' }] },
  entryPoint: { rva: 0x13f0, section: '.text' },
  tlsCallbacks: 3,
  overlay: { offset: 31232, size: 964, entropy: 7.9, type: 'Arquivo ZIP' },
  checksum: { declared: 82427, computed: 82427 },
  resources: [
    { type: 'RCDATA', name: '101', lang: 1049, size: 14336, entropy: 5.9, content: 'pe' },
    { type: 'VERSION', name: '1', lang: 1033, size: 688, entropy: 3.2, content: null },
  ],
  resourcesTruncated: false,
  version: { CompanyName: 'Microsoft Corporation', OriginalFilename: 'svchost.exe' },
  manifest: { executionLevel: 'requireAdministrator', uiAccess: false },
  signature: {
    digestAlgorithm: 'sha256', digestMatches: false, signatureValid: true, programName: 'Teste DeepLook', programUrl: 'https://deeplook.test',
    signer: SIGNER, chain: [SIGNER, { ...SIGNER, subject: 'DeepLook Teste AC' }], selfSigned: false, timestamp: '2026-01-01T12:00:00.000Z', nested: 0,
  },
  dotnet: null,
  alerts: [
    { level: 'high', text: 'A assinatura não confere com o conteúdo: o arquivo foi alterado depois de assinado.' },
    { level: 'medium', text: 'O manifesto pede execução como administrador.' },
    { level: 'info', text: '964 bytes anexados depois do fim do executável (Arquivo ZIP).' },
  ],
};
e1.staticInfo = { ...INFO, pe: NEW_PE };
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const peBlock = section.locator('.dl-static-block', { hasText: 'Executável do Windows (PE)' }).first();
expect('análise nova: sem o aviso de análise antiga', (await section.getByText('Análise anterior ao imphash').count()) === 0);
const peAlerts = peBlock.locator('.dl-doc-alerts li');
expect(
  'alertas do PE com o tom de cada nível',
  (await peAlerts.count()) === 3 &&
    (await peAlerts.nth(0).locator('.hpsm-status--red').count()) === 1 &&
    (await peAlerts.nth(1).locator('.hpsm-status--orange').count()) === 1 &&
    (await peAlerts.nth(2).locator('.hpsm-status--none').count()) === 1,
);
expect('imphash com botão de copiar', (await field('Imphash').innerText()).includes('b1f24be7621e0e845cc9e28d113ca280') && (await field('Imphash').locator('button').count()) === 1);
expect('Rich header editado em laranja', (await field('Rich header').locator('.hpsm-status--orange').innerText()) === 'editado');
expect('ponto de entrada', (await field('Ponto de entrada').innerText()) === '0x13f0 na seção .text', await field('Ponto de entrada').innerText());
expect('checksum confere', (await field('Checksum').innerText()) === 'Confere');
expect('dados anexados', (await field('Dados anexados').innerText()).startsWith('964 B · Arquivo ZIP · entropia 7.90'), await field('Dados anexados').innerText());
expect('manifesto pede administrador', (await field('Manifesto').innerText()) === 'pede administrador');
const rwx = await section.locator('table[aria-label="Seções do executável"] tbody tr:has-text(".injt") .hpsm-status--red').textContent();
expect('seção gravável e executável em vermelho', rwx === 'RWX', rwx);
const sigBlock = section.locator('.dl-static-block:has(> .dl-static-title:text-is("Assinatura digital"))');
const sigField = (label) => sigBlock.locator(`.hpsm-field:has(.hpsm-field__label:text-is("${label}:")) .hpsm-readonly`).first();
expect('assinatura alterada em vermelho', (await sigField('Situação').locator('.hpsm-status--red').innerText()) === 'Alterado depois de assinado');
expect('quem assinou, cadeia e carimbo', (await sigField('Assinado por').innerText()) === 'Fornecedor Teste Ltda' && (await sigField('Cadeia no arquivo').innerText()) === 'Fornecedor Teste Ltda → DeepLook Teste AC' && (await sigField('Carimbo de tempo').innerText()).startsWith('01/01/2026'));
const versionRows = await section.locator('table[aria-label="Informações de versão"] tbody tr').allInnerTexts();
expect('informações de versão com rótulo', versionRows.map((r) => r.replace(/\s+/g, ' ')).join('|') === 'Empresa Microsoft Corporation|Nome original svchost.exe', versionRows.join('|'));
const resRow = section.locator('table[aria-label="Recursos do executável"] tbody tr').first();
expect('recurso com executável dentro e idioma russo', (await resRow.locator('.hpsm-status--orange').innerText()) === 'pe' && (await resRow.innerText()).includes('russo'));
const details = section.locator('.dl-static-strings summary');
expect('exports e funções importadas recolhidos', (await details.filter({ hasText: 'Exports (2) · teste.dll' }).count()) === 1 && (await details.filter({ hasText: 'Funções importadas (4)' }).count()) === 1);
await details.filter({ hasText: 'Exports (2)' }).click();
expect('export encaminhado', (await section.locator('table[aria-label="Funções exportadas"] tbody tr:has-text("Dormir")').innerText()).includes('kernel32.Sleep'));
await page.screenshot({ path: `${OUT}/analise-pe.png`, fullPage: true });

// 7. .NET (item 7.1): P/Invoke, chamadas sensiveis e ofuscador.
e1.staticInfo = {
  ...INFO,
  pe: {
    ...NEW_PE,
    signature: null,
    rich: null,
    dotnet: {
      runtime: 'v4.0.30319', flags: ['IL only'], assembly: { name: 'carregador', version: '1.2.3.4' }, module: 'carregador.exe',
      assemblyRefs: ['mscorlib'], pinvoke: [{ dll: 'kernel32.dll', name: 'VirtualAlloc' }], suspicious: ['Assembly.Load (carrega código da memória)'],
      obfuscator: 'ConfuserEx', types: 4, methods: 12,
    },
  },
};
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const netBlock = section.locator('.dl-static-block:has(> .dl-static-title:text-is(".NET"))');
const netText = (await netBlock.innerText()).replace(/\s+/g, ' ');
expect(
  '.NET: assembly, P/Invoke, chamadas sensíveis e ofuscador',
  netText.includes('carregador 1.2.3.4') && netText.includes('kernel32.dll!VirtualAlloc') && netText.includes('Assembly.Load') && (await netBlock.locator('.hpsm-status--orange').innerText()) === 'ConfuserEx',
  netText.slice(0, 300),
);
expect('sem assinatura', (await sigBlock.innerText()).includes('Sem assinatura digital.'));
expect('sem Rich header', (await field('Rich header').innerText()).startsWith('Ausente'));

// 8. Analise antiga do PE: aviso e "Analisar de novo".
e1.staticInfo = INFO;
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('análise antiga: aviso e botão', (await section.getByText('Análise anterior ao imphash').count()) === 1 && (await section.locator('button:has-text("Analisar de novo")').count()) === 1);
expect('análise antiga: sem os campos novos', (await section.locator('.hpsm-field__label:text-is("Imphash:")').count()) === 0);
e1.staticInfo = peInfo;

// 9. Ficha impressa.
const print = await context.newPage();
await print.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
const printText = await print.locator('.dl-print__kv').innerText();
expect('ficha impressa com tipo real e entropia', printText.includes('Executável do Windows (PE) (executável disfarçado de .pdf)') && printText.includes('7.61 de 8'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nanálise estática: tudo ok');
process.exit(failures ? 1 : 0);
