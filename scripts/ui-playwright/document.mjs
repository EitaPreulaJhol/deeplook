// Analise de documentos (70): aviso no topo com risco alto, secao "Documento"
// com risco, alertas coloridos, links so como texto, objetos embutidos e
// macros VBA (roda ao abrir, chamadas suspeitas, "Ver código" como texto);
// documento limpo sem aviso.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const section = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Documento"))');

const base = entries[2].staticInfo ?? {
  version: 1, analyzedAt: '2026-10-24T10:00:00.000Z', size: 88211, bytesAnalyzed: 88211,
  detectedType: { id: 'ole', label: 'Documento Office antigo / MSI (OLE)', extensions: ['doc'], executable: false },
  extensionMismatch: null, entropy: 5.1, entropyLevel: 'normal',
  strings: { total: 10, urls: [], ips: [], emails: [], paths: [], registry: [], suspicious: [] }, pe: null, iocCandidates: [],
};
entries[2].staticInfo = {
  ...base,
  document: {
    format: 'ole',
    risk: 'high',
    alerts: [
      { level: 'high', text: 'Contém macros VBA (1 módulo(s)); executam ao abrir: AutoOpen.' },
      { level: 'high', text: 'Chamadas suspeitas nas macros: Shell, URLDownloadToFile.' },
      { level: 'medium', text: '1 objeto(s) embutido(s).' },
    ],
    office: {
      macros: true,
      modules: [{ name: 'Module1', lines: 7, autoExec: ['AutoOpen'], suspicious: ['Shell', 'URLDownloadToFile'], code: 'Sub AutoOpen()\n  Shell "cmd /c <script>x</script>"\nEnd Sub', truncated: false }],
      externalLinks: [],
      remoteTemplate: null,
      embedded: ['ObjectPool/_1234'],
      dde: false,
    },
    links: ['http://evil.test/p.exe'],
  },
};

// 1. Documento perigoso.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('aviso no topo', (await messages()).some((t) => t.startsWith('Atenção: documento com conteúdo ativo. Contém macros VBA')), (await messages()).join(' | '));
expect('seção com o formato', (await section.locator('.hpsm-section__head').innerText()).includes('Documento (Office antigo (OLE))'));
const text = (await section.innerText()).replace(/\s+/g, ' ');
expect('risco alto', text.includes('Risco: Alto'));
expect('alertas com cor', (await section.locator('.dl-doc-alerts .hpsm-status--red').count()) === 2 && (await section.locator('.dl-doc-alerts .hpsm-status--orange').count()) === 1);
expect('links só como texto', text.includes('http://evil.test/p.exe') && (await section.locator('a[href*="evil.test"]').count()) === 0);
expect('objeto embutido', text.includes('ObjectPool/_1234'));
expect('macro com roda ao abrir e suspeitas', text.includes('Module1') && text.includes('roda ao abrir: AutoOpen') && text.includes('Shell, URLDownloadToFile'));
await section.locator('button:has-text("Ver código")').click();
const code = section.locator('pre.dl-doc-macros__code');
expect('código como texto', (await code.innerText()).includes('<script>x</script>') && (await section.locator('pre script').count()) === 0);
await page.screenshot({ path: `${OUT}/documento.png`, fullPage: true });
await section.locator('button:has-text("Ocultar código")').click();
expect('ocultar código', (await code.count()) === 0);

// 2. Documento limpo: sem aviso, risco baixo.
entries[2].staticInfo = { ...base, document: { format: 'ooxml', risk: 'low', alerts: [], links: [], office: { macros: false, modules: [], externalLinks: [], remoteTemplate: null, embedded: [], dde: false } } };
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('limpo: sem aviso', !(await messages()).some((t) => t.startsWith('Atenção: documento')));
expect('limpo: risco baixo e nada ativo', (await section.innerText()).replace(/\s+/g, ' ').includes('Risco: Baixo') && (await section.innerText()).includes('Nada de conteúdo ativo encontrado.'));

// 3. Arquivo que nao e documento: sem secao.
entries[2].staticInfo = { ...base, document: null };
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('não documento: sem seção', (await section.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndocumento: tudo ok');
process.exit(failures ? 1 : 0);
