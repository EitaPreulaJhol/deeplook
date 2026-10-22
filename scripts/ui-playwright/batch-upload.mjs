// Envio em lote (44): varios arquivos no Enviar Amostra (lista com Remover,
// total, limite de 20, titulo some, um envio por arquivo com descricao e tags
// em comum, resultado ao vivo com falha e "ja enviada antes") e o .zip
// desmembrado (caixa so para .zip, senha "infected", senha errada no campo,
// resultado com ignorados).
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

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
const settle = (ms = 500) => page.waitForTimeout(ms);
const file = (name, size = 64) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.alloc(size, name) });
const messages = async () => (await page.locator('.hpsm-msg__text').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const button = () => page.locator('.hpsm-toolbar__action').first();
const rows = async () =>
  Promise.all(
    (await page.locator('table[aria-label="Resultado do envio"] tbody tr').all()).map(async (r) =>
      (await r.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
    ),
  );

// 1. Varios arquivos: lista, total, titulo some, botao conta.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
expect('botão "Selecionar arquivos"', (await page.locator('#file-pick').innerText()).trim() === 'Selecionar arquivos');
await page.setInputFiles('input[type=file]', [file('a.exe'), file('b.dll', 2048)]);
await page.setInputFiles('input[type=file]', [file('c.js'), file('a.exe')]);
await settle();
expect('nova escolha soma sem repetir', (await page.locator('.hpsm-filedrop__name').allInnerTexts()).join('|') === 'a.exe|b.dll|c.js');
expect('total da lista', (await page.locator('.hpsm-filedrop__total').innerText()).trim() === '3 arquivos · 2.1 KB (máximo de 20 por envio)', await page.locator('.hpsm-filedrop__total').innerText());
expect('sem campo Título', (await page.locator('#file-title').count()) === 0);
expect('dica do lote', (await page.locator('.hpsm-field:has(#file-pick) .hpsm-field__help').innerText()).startsWith('Cada arquivo vira uma amostra'));
expect('botão conta os arquivos', (await button().innerText()).trim() === 'Enviar 3 arquivos');
await page.click('button[aria-label="Remover b.dll"]');
expect('Remover tira só aquele', (await page.locator('.hpsm-filedrop__name').allInnerTexts()).join('|') === 'a.exe|c.js');

// 2. Limite de 20.
await page.setInputFiles('input[type=file]', Array.from({ length: 25 }, (_, i) => file(`lote${i}.bin`)));
await settle();
expect('limite de 20', (await page.locator('.hpsm-filedrop__file').count()) === 20);
expect('aviso do limite', (await messages()).includes('Selecione no máximo 20 arquivos por envio; os excedentes foram ignorados.'));
for (let i = 0; i < 18; i++) await page.locator('.hpsm-filedrop__remove').last().click();

// 3. Envio: um por arquivo, descricao e tags em comum, falha e repetida.
await page.setInputFiles('input[type=file]', [file('falha-grande.iso'), file('repetida.exe')]);
expect('quatro na lista', (await page.locator('.hpsm-filedrop__file').count()) === 4);
await page.fill('#file-description', 'Anexos do e-mail de cobrança');
await page.fill('#file-tags', 'phishing, lote');
await page.keyboard.press('Control+KeyS');
await page.waitForFunction(() => document.querySelectorAll('.hpsm-msg__text').length > 0 && !document.querySelector('.hpsm-toolbar__loading'));
await settle();
expect('quatro envios, títulos pelo nome', state.uploads.map((u) => u.title).join('|') === 'a.exe|c.js|falha-grande.iso|repetida.exe', state.uploads.map((u) => u.title).join('|'));
expect('descrição e tags em todos', state.uploads.every((u) => u.description === 'Anexos do e-mail de cobrança' && u.tags === 'phishing, lote'));
const result = await rows();
expect('resultado: quatro linhas', result.length === 4);
expect('enviada com link', result[0][2] === 'Enviada' && result[0][3] === 'a.exe');
expect('falha com o motivo', result[2][2] === 'Falha: Arquivo maior que o limite de 200 MB.' && result[2][3] === '—', result[2].join(' | '));
expect('já enviada antes', result[3][3] === `repetida.exe · já enviada antes: ${'relatorio_trimestral.docm'}` || result[3][3].startsWith('repetida.exe · já enviada antes:'), result[3][3]);
expect('resumo', (await messages()).includes('3 amostras criadas; 1 arquivo não foi enviado. Veja o motivo de cada um abaixo.'), (await messages()).join(' / '));
expect('formulário limpo', (await page.locator('.hpsm-filedrop__file').count()) === 0 && (await page.inputValue('#file-description')) === '' && (await page.inputValue('#file-tags')) === '');
await page.screenshot({ path: `${OUT}/envio-lote.png`, fullPage: true });
await page.click('table[aria-label="Resultado do envio"] a:has-text("c.js")');
await settle();
expect('link abre a amostra', new URL(page.url()).pathname === '/entries/n2', page.url());

// 4. .zip: caixa so aparece para um .zip; senha padrao "infected".
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', [file('a.exe')]);
expect('sem caixa para arquivo comum', (await page.locator('#zip-unzip').count()) === 0);
expect('um arquivo: título continua', (await page.locator('#file-title').count()) === 1);
await page.click('.hpsm-filedrop__remove');
await page.setInputFiles('input[type=file]', [file('pacote.zip', 4096)]);
await settle();
expect('caixa Desmembrar para .zip', (await page.locator('#zip-unzip').count()) === 1 && !(await page.isChecked('#zip-unzip')));
expect('sem desmembrar: envio comum', (await button().innerText()).trim() === 'Enviar arquivo' && (await page.locator('#zip-password').count()) === 0);
await page.locator('label[for="zip-unzip"]').click();
expect('desmembrar: senha "infected" e botão', (await page.inputValue('#zip-password')) === 'infected' && (await button().innerText()).trim() === 'Desmembrar e enviar' && (await page.locator('#file-title').count()) === 0);

// 5. Senha errada destaca o campo.
await page.fill('#zip-password', 'errada');
await page.fill('#file-tags', 'emotet');
await button().click();
await settle(700);
expect('senha errada no campo', (await page.locator('#zip-password').getAttribute('aria-invalid')) === 'true' || (await page.locator('.hpsm-field:has(#zip-password)').getAttribute('class')).includes('invalid'), await page.locator('.hpsm-field:has(#zip-password)').getAttribute('class'));
expect('mensagem da senha', (await messages()).some((m) => m.includes('Senha do .zip') && m.includes('Senha incorreta')), (await messages()).join(' / '));
expect('formulário mantido', (await page.locator('.hpsm-filedrop__name').innerText()) === 'pacote.zip');

// 6. Senha certa: resultado com criadas e ignorado.
await page.fill('#zip-password', 'infected');
await button().click();
await settle(700);
expect('campos do .zip', state.lastZipFields?.password === 'infected' && state.lastZipFields?.tags === 'emotet', JSON.stringify(state.lastZipFields));
const zr = await rows();
expect('título do resultado', (await page.locator('.hpsm-section__head:has-text("Resultado do envio") > span:last-child').innerText()).trim() === 'Resultado do envio — pacote.zip');
expect('linhas do .zip', zr.map((r) => `${r[0]}=${r[2]}`).join('|') === 'dropper.exe=Enviada|payload/config.bin=Enviada|vazio.txt=Ignorado: arquivo vazio', zr.map((r) => `${r[0]}=${r[2]}`).join('|'));
expect('tamanho vindo do servidor', zr[0][1] === '47.1 KB', zr[0][1]);
expect('resumo do .zip', (await messages()).includes('2 amostras criadas; 1 arquivo não foi enviado. Veja o motivo de cada um abaixo.'));
await page.screenshot({ path: `${OUT}/envio-zip.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nenvio em lote: tudo ok');
process.exit(failures ? 1 : 0);
