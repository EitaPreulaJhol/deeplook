// Arquivos parecidos (TLSH): motivo "Arquivo parecido (TLSH): N%" na aba
// Relacionadas, filtro de similaridade minima (vai para a API, Limpar volta ao
// padrao, lista vazia mantem o filtro) e TLSH na secao Arquivo da ficha.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const byId = (id) => entries.find((e) => e.id === id);
const TLSH = '6FF02BEF718027B0160B4391212923ED7F1A463D563B1549B86CF62973B197AD2731F8';
byId('e1').tlsh = TLSH;
byId('e3').tlsh = '';
byId('e4').tlsh = null;
const asked = [];
state.related.e1 = (similarity) => {
  asked.push(similarity);
  const items = [
    { entry: byId('e4'), score: 77, reasons: [{ kind: 'SIMILAR', detail: 85 }] },
    { entry: byId('e3'), score: 65, reasons: [{ kind: 'SIMILAR', detail: 72 }] },
  ].filter((i) => i.reasons[0].detail >= similarity);
  return { items, total: items.length, limit: 50 };
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
const rows = page.locator('.hpsm-tabpanel tbody tr');
const select = page.locator('#related-similarity');
const reasons = async () => (await page.locator('.hpsm-tabpanel .dl-related-reasons li').allTextContents()).join('|');

// 1. Motivo com a similaridade, das mais parecidas para as menos.
await page.goto(ORIGIN + '/entries/e1?tab=relacionadas', { waitUntil: 'networkidle' });
expect('padrão sem parâmetro (70)', asked[0] === 70, String(asked));
expect('2 parecidas', (await rows.count()) === 2);
expect(
  'motivo com a %',
  (await reasons()) === 'Arquivo parecido (TLSH): 85%|Arquivo parecido (TLSH): 72%',
  await reasons(),
);
expect('filtro começa em 70% (padrão)', (await select.inputValue()) === '70');
const hint = await page.locator('.dl-related-hint').textContent();
expect('explicação cita o TLSH', hint?.includes('arquivo parecido (TLSH)'), hint);
await page.screenshot({ path: `${OUT}/parecidas.png` });

// 2. Limiar mais alto vai para a API e tira a menos parecida.
await select.selectOption('80');
await settle();
expect('similaridade vai para a API', asked.at(-1) === 80, String(asked));
expect('só a de 85%', (await reasons()) === 'Arquivo parecido (TLSH): 85%', await reasons());

// 3. Nenhuma: aviso, mas o filtro continua para baixar o limiar.
await select.selectOption('90');
await settle();
const msgs = await page.locator('.hpsm-msg__text').allTextContents();
expect('lista vazia avisa', msgs.some((t) => t.startsWith('Nenhuma amostra relacionada')), msgs.join(' | '));
expect('filtro continua na lista vazia', (await select.count()) === 1);

// 4. Limpar volta ao padrao.
await page.click('.hpsm-tabpanel .hpsm-filterbar button:has-text("Limpar")');
await settle();
expect('Limpar volta a 70%', (await select.inputValue()) === '70' && (await rows.count()) === 2);

// 5. Contador da aba usa o padrao.
const tab = page.locator('.hpsm-tab:has-text("Relacionadas")');
expect('aba com (2)', (await tab.textContent())?.trim() === 'Relacionadas (2)', await tab.textContent());

// 6. TLSH na ficha (secao Arquivo), com Copiar.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const field = page.locator('.hpsm-field:has(.hpsm-field__label:text-is("TLSH:"))');
const value = (await field.locator('.hpsm-readonly__text').textContent())?.trim();
expect('TLSH com o prefixo T1', value === `T1${TLSH}`, value);
expect('TLSH tem Copiar', (await field.locator('button[aria-label*="TLSH"]').count()) === 1);
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
const empty = (await field.locator('.hpsm-readonly').textContent())?.trim();
expect('vazio = não calculável', empty?.startsWith('Não calculável'), empty);
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
const pending = (await field.locator('.hpsm-readonly').textContent())?.trim();
expect('null = ainda calculando', pending?.startsWith('Calculando'), pending);
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('URL não tem TLSH', (await field.count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nparecidas: tudo ok');
process.exit(failures ? 1 : 0);
