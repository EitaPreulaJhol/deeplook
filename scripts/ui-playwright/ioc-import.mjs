// Importar indicadores (78): pela Minha Conta (seguir) e pela lista de
// permissoes; colar ou escolher arquivo, pre-visualizar (situacao, invalidos com
// motivo, repetidos, vagas), importar so os novos, motivo obrigatorio nos
// permitidos, erro de leitura e Esc.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const previews = [];
const imports = [];
await context.route((url) => url.pathname.startsWith('/api/iocs/import'), async (route) => {
  const req = route.request();
  const body = JSON.parse(req.postData() || '{}');
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (req.url().endsWith('/preview')) {
    previews.push(body);
    if (body.text.startsWith('{ quebrado')) {
      return json(400, { error: 'JSON inválido: envie um pacote STIX 2.1 ou uma lista em CSV.', details: { text: ['JSON inválido'] } });
    }
    const watch = body.target === 'watch';
    return json(200, {
      format: body.text.trim().startsWith('{') ? 'stix' : 'csv',
      items: [
        { kind: 'IPV4', value: '185.0.2.10', where: 'linha 2', status: 'new' },
        { kind: 'DOMAIN', value: 'evil.test', where: 'linha 3', fromUrl: true, status: 'exists' },
        { kind: 'DOMAIN', value: watch ? 'cdn.evil.test' : 'mail.empresa.test', where: 'linha 4', status: watch ? 'new' : 'covered' },
        { kind: 'MD5', value: 'd41d8cd98f00b204e9800998ecf8427e', where: 'linha 5', status: watch ? 'limit' : 'new' },
      ],
      invalid: [{ where: 'linha 6', text: '192.168.1.5', reason: 'IP privado não aparece nos relatórios' }],
      repeated: 1,
      counts: watch ? { new: 2, exists: 1, covered: 0, limit: 1 } : { new: 2, exists: 1, covered: 1, limit: 0 },
      room: watch ? 2 : null,
    });
  }
  imports.push(body);
  return json(200, { added: body.items.length, rejected: 0, exists: 1, covered: 0, limit: 0 });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const dialog = page.locator('[role=dialog]');
const importButton = dialog.locator('.hpsm-modal__actions button', { hasText: /^Importar/ });
const messages = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const LIST = 'tipo;valor\nip;185.0.2.10\nhxxps://evil[.]test/x\ncdn.evil.test\nd41d8cd98f00b204e9800998ecf8427e\n192.168.1.5\n185.0.2.10\n';

// 1. Seguir: pela Minha Conta.
await page.goto(ORIGIN + '/user?tab=indicadores', { waitUntil: 'networkidle' });
await page.click('button:has-text("importe uma lista (CSV ou STIX)")');
await settle();
expect('abre o diálogo de seguir', (await dialog.locator('.hpsm-modal__head').innerText()) === 'Importar indicadores para seguir');
expect('foco no campo da lista', await page.locator('#import-text').evaluate((el) => el === document.activeElement));
expect('Importar desligado antes de pré-visualizar', await importButton.isDisabled() && (await importButton.innerText()) === 'Importar 0');
await page.fill('#import-text', LIST);
await dialog.locator('button:has-text("Pré-visualizar")').click();
await settle();
expect('pré-visualização com o destino', previews.at(-1)?.target === 'watch' && previews.at(-1)?.text === LIST, JSON.stringify(previews.at(-1)));
const summary = (await dialog.locator('.dl-import__summary').innerText()).replace(/\s+/g, ' ');
expect('resumo com novos, já seguidos, sem vaga, inválidos, repetidos e vagas', summary === 'Lista: 2 novo(s), 1 já seguido(s), 1 sem vaga, 1 inválido(s), 1 repetido(s). Vagas para seguir: 2.', summary);
const rows = (await dialog.locator('table[aria-label="Indicadores reconhecidos"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('situação por indicador', rows[1] === 'Domínio evil.test (de uma URL) linha 3 Já sigo' && rows[3].endsWith('Sem vaga (limite de 200)'), rows.join(' | '));
const invalid = (await dialog.locator('table[aria-label="Linhas não importadas"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('inválido com o motivo', invalid[0] === 'linha 6 192.168.1.5 IP privado não aparece nos relatórios', invalid.join(' | '));
expect('Importar 2', (await importButton.innerText()) === 'Importar 2');
await page.screenshot({ path: `${OUT}/importar-indicadores.png` });
await importButton.click();
await settle();
expect('importa só os novos', JSON.stringify(imports.at(-1)) === JSON.stringify({ target: 'watch', items: [{ kind: 'IPV4', value: '185.0.2.10' }, { kind: 'DOMAIN', value: 'cdn.evil.test' }] }), JSON.stringify(imports.at(-1)));
expect('fecha e avisa', (await dialog.count()) === 0 && (await messages()).includes('2 indicador(es) passaram a ser seguidos'), await messages());

// 2. Arquivo, erro de leitura e Esc.
await page.click('button:has-text("importe uma lista (CSV ou STIX)")');
await settle();
await page.setInputFiles('#import-file', { name: 'pacote.json', mimeType: 'application/json', buffer: Buffer.from('{ quebrado') });
await settle();
expect('arquivo vai para o campo', (await page.inputValue('#import-text')) === '{ quebrado');
await dialog.locator('button:has-text("Pré-visualizar")').click();
await settle();
expect('erro de leitura no diálogo', (await dialog.locator('.dl-import__error').innerText()).includes('JSON inválido'));
await page.keyboard.press('Escape');
await settle();
expect('Esc fecha', (await dialog.count()) === 0);

// 3. Lista de permissoes: motivo obrigatorio.
await page.goto(ORIGIN + '/permitidos', { waitUntil: 'networkidle' });
await page.click('.hpsm-toolbar__action:has-text("Importar…")');
await settle();
expect('abre o diálogo de permitidos', (await dialog.locator('.hpsm-modal__head').innerText()) === 'Importar indicadores permitidos');
await page.fill('#import-text', 'empresa.test\n10.0.0.0/8');
await dialog.locator('button:has-text("Pré-visualizar")').click();
await settle();
const rowsAllow = (await dialog.locator('table[aria-label="Indicadores reconhecidos"] tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
expect('já permitido e coberto', rowsAllow[1].endsWith('Já permitido') && rowsAllow[2].endsWith('Já coberto (domínio ou faixa)'), rowsAllow.join(' | '));
const before = imports.length;
await importButton.click();
await settle();
expect('sem motivo não importa', imports.length === before && (await dialog.locator('.dl-import__error').innerText()).includes('motivo'));
await page.fill('#import-reason', 'lista do parceiro');
await importButton.click();
await settle();
expect('importa com o motivo', imports.at(-1)?.target === 'allow' && imports.at(-1)?.reason === 'lista do parceiro' && imports.at(-1)?.items.length === 2, JSON.stringify(imports.at(-1)));
expect('avisa na lista', (await messages()).includes('2 indicador(es) incluídos na lista de permissões'), await messages());

// 4. Usuario comum: segue por importacao, mas nao ve a lista de permissoes.
state.role = 'USER';
await page.goto(ORIGIN + '/user?tab=indicadores', { waitUntil: 'networkidle' });
expect('usuário comum pode importar para seguir', (await page.locator('button:has-text("importe uma lista (CSV ou STIX)")').count()) === 1);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nimportar indicadores: tudo ok');
process.exit(failures ? 1 : 0);
