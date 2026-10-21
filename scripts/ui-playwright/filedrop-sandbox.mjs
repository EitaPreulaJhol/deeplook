// Arrastar e soltar o arquivo em Enviar Amostra e prazo do sandbox a vista.
import { chromium } from 'playwright';

import {
  createState,
  DUPLICATE_SAMPLE,
  ORIGIN,
  OUT,
  runningSandbox,
  setupMock,
  watchErrors,
} from './mock-api.mjs';

const state = createState({ loggedIn: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const docTabs = () => page.locator('.hpsm-doctab__link').allTextContents();

// 1. Soltar um arquivo na area: aparece nome/tamanho, o hash e o aviso de duplicata.
await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
const bytes = [...DUPLICATE_SAMPLE];
await page.evaluate((data) => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array(data)], 'arrastada.exe'));
  const zone = document.querySelector('.hpsm-filedrop__zone');
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true }));
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
}, bytes);
await page.waitForTimeout(800);
expect('arquivo solto aparece com o nome', (await page.locator('.hpsm-filedrop__name').textContent()) === 'arrastada.exe');
expect('tamanho exibido', (await page.locator('.hpsm-filedrop__size').textContent()).includes('B)'));
expect('hash calculado e aviso de duplicata', (await messages()).join(' ').includes('Esta amostra já foi enviada'));
await page.screenshot({ path: `${OUT}/arrastar-arquivo.png` });
await page.click('.hpsm-filedrop__remove');
expect('"Remover" limpa o arquivo', (await page.locator('.hpsm-filedrop__file').count()) === 0);
expect('botão "Selecionar arquivo" continua acionando o input', (await page.locator('input[type=file]').count()) === 1);

// 2. Sandbox expirando em 4 min: prazo na aba de documento e aviso com "Estender".
state.sandboxes.e2 = runningSandbox('e2', 4);
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const tabTitle = (await docTabs()).find((t) => t.includes('Página de login falsa do banco')) ?? '';
expect('aba mostra o prazo antes do nome', /^\d+min · Página de login falsa do banco$/.test(tabTitle), tabTitle);
expect('aviso de expiração nos últimos 5 min', (await messages()).join(' ').includes('expira em'));
await page.screenshot({ path: `${OUT}/prazo-sandbox.png` });
await page.click('.dl-link-button:has-text("Estender prazo")');
await page.waitForTimeout(800);
expect('"Estender prazo" chama a API', state.calls.includes('POST /api/sandbox/sb-e2/extend'));
const extended = (await docTabs()).find((t) => t.includes('Página de login falsa do banco')) ?? '';
expect(
  'após estender: aviso some e o prazo da aba aumenta',
  !(await messages()).join(' ').includes('expira em') && /^3\dmin · /.test(extended),
  extended,
);

// 3. Ao sair da amostra, a aba volta ao nome simples (sem prazo parado).
await page.click('.hpsm-tree__leaf:has-text("Histórico Global")');
await page.waitForTimeout(400);
expect(
  'fora da tela a aba volta ao nome simples',
  (await docTabs()).includes('Página de login falsa do banco'),
  (await docTabs()).join(' | '),
);

await browser.close();
process.exit(failures ? 1 : 0);
