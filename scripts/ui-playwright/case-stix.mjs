// Pacote STIX no caso (revisao de novembro, 3.5): Exportar > Importar pacote STIX abre a janela,
// o arquivo escolhido gera a previa (o que acontece com cada link e cada arquivo), Importar manda o
// mesmo texto e mostra o resultado; JSON invalido mostra o erro; caso encerrado nao importa.
import { writeFileSync } from 'node:fs';

import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const at = '2026-10-24T09:00:00.000Z';
const ana = { id: 'u1', displayName: 'Ana Souza' };
const e1 = entries.find((e) => e.id === 'e1');
const ce = (e) => ({
  addedAt: at,
  addedBy: ana,
  entry: { id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: 'P3', createdAt: e.createdAt, sha256: e.sha256 ?? null, url: e.url ?? null, reports: [] },
});
const base = { createdAt: at, updatedAt: at, closedAt: null, assignee: ana, createdBy: ana, description: null, entries: [ce(e1)], events: [{ id: 'ev1', type: 'CREATED', detail: null, fromValue: null, toValue: null, createdAt: at, actor: ana, entry: null }] };
state.cases = [
  { ...base, id: 'cs1', number: 1, code: 'CASO-0001', title: 'Campanha do boleto', status: 'IN_PROGRESS' },
  { ...base, id: 'cs2', number: 2, code: 'CASO-0002', title: 'Encerrado', status: 'CLOSED', closedAt: at },
];
state.caseStixPreview = {
  name: 'CASO-0007 Campanha da fatura',
  links: [
    { url: 'https://pagamento.banco-falso.example/pix', status: 'new', entry: null },
    { url: 'http://login.banco-falso.example/entrar', status: 'existing', entry: { id: 'e2', title: 'login' } },
    { url: 'http://x.example/', status: 'in-case', entry: { id: 'e1', title: 'x' } },
  ],
  hashes: [
    { sha256: 'ab'.repeat(32), status: 'existing', entry: { id: 'e3', title: 'fatura.exe' } },
    { sha256: 'cd'.repeat(32), status: 'unknown', entry: null },
  ],
  others: 3,
  invalid: 0,
  maxNewLinks: 50,
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const exportMenu = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]', { hasText: 'Exportar' });
const item = (label) => page.locator(`.hpsm-ctxmenu button:has-text("${label}")`);
const dialog = page.locator('[role=dialog]', { hasText: 'Importar pacote STIX no caso' });
const bundle = `${OUT}/pacote.stix.json`;
writeFileSync(bundle, JSON.stringify({ type: 'bundle', id: 'bundle--1', objects: [] }));
const junk = `${OUT}/lixo.json`;
writeFileSync(junk, 'não é json');

// 1. Abrir, escolher o arquivo e ver a previa.
await page.goto(ORIGIN + '/casos/cs1', { waitUntil: 'networkidle' });
await exportMenu.click();
await settle(200);
await item('Importar pacote STIX').click();
expect('janela abre', (await dialog.count()) === 1);
expect('foco no botão de escolher', await page.evaluate(() => document.activeElement?.textContent?.includes('Escolher arquivo')));
expect('Importar desligado antes da prévia', await dialog.locator('button:has-text("Importar")').first().isDisabled());
await dialog.locator('#case-stix-file').setInputFiles(bundle);
await dialog.locator('.dl-import__summary').waitFor();
const summary = (await dialog.locator('.dl-import__summary').innerText()).replace(/\s+/g, ' ');
expect('prévia: nome e quantas entram', summary.includes('Pacote "CASO-0007 Campanha da fatura"') && summary.includes('3 amostra(s) entram no caso') && summary.includes('3 outro(s) indicador(es) não entram'), summary);
const cells = async (label) => (await dialog.locator(`table[aria-label="${label}"] tbody tr`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const links = await cells('Links do pacote');
expect('cada link com o que acontece', links[0].endsWith('Vira amostra nova') && links[1].endsWith('Já é amostra: entra no caso') && links[2].endsWith('Já está no caso'), links.join(' || '));
const files = await cells('Arquivos do pacote');
expect('arquivo desconhecido fica de fora', files[0].endsWith('Já foi enviado: entra no caso') && files[1].endsWith('Nunca enviado: não entra'), files.join(' || '));
expect('a prévia mandou o conteúdo do arquivo', state.caseStix[0]?.step === 'preview' && state.caseStix[0].text.includes('"bundle"'));
await page.screenshot({ path: `${OUT}/caso-stix-previa.png` });

// 2. Importar.
await dialog.locator('button:has-text("Importar 3")').click();
await page.locator('.hpsm-msg--success').waitFor();
const message = await page.locator('.hpsm-msg--success .hpsm-msg__text').innerText();
expect('importa o mesmo texto', state.caseStix[1]?.step === 'import' && state.caseStix[1].text === state.caseStix[0].text);
expect('janela fecha e mostra o resultado', (await dialog.count()) === 0 && message.includes('1 link(s) novo(s)') && message.includes('1 arquivo(s) nunca enviado(s)'), message);

// 3. JSON invalido: erro dentro da janela.
await exportMenu.click();
await settle(200);
await item('Importar pacote STIX').click();
await dialog.locator('#case-stix-file').setInputFiles(junk);
await dialog.locator('.dl-import__error').waitFor();
expect('JSON inválido mostra o motivo', (await dialog.locator('.dl-import__error').innerText()).includes('JSON inválido'));
await page.keyboard.press('Escape');
expect('Esc fecha', (await dialog.count()) === 0);

// 4. Caso encerrado: a opcao fica desligada.
await page.goto(ORIGIN + '/casos/cs2', { waitUntil: 'networkidle' });
await exportMenu.click();
await settle(200);
expect('caso encerrado não importa', await item('Importar pacote STIX').isDisabled());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npacote STIX no caso: tudo ok');
process.exit(failures ? 1 : 0);
