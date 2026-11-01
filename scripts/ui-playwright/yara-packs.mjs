// Pacotes de regras YARA (143, 144, 145): Configuracoes liga e desliga com confirmacao,
// licenca, autor e link; tela Regras YARA lista os pacotes, busca, le o texto como
// texto, desativa, exclui e aplica as amostras, sem editar; a ficha mostra o autor.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const state = createState({ loggedIn: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const go = (path) => page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
const dialog = page.locator('[role=alertdialog]');
const settle = () => page.waitForTimeout(300);
const box = (id) => page.locator(`#yara-pack-${id}`);
const packRow = (name) => page.locator(`table[aria-label="Pacotes de regras YARA"] tbody tr:has-text("${name}")`);
const ruleRows = page.locator('table[aria-label="Regras do pacote"] tbody tr');

// 1. Configuracoes.
await go('/admin?tab=settings');
expect('padrão: dois ligados', (await box('reversinglabs').isChecked()) && (await box('bartblaze').isChecked()));
expect('signature-base desligada', !(await box('signature-base').isChecked()));
const section = await page.locator('section:has-text("Pacotes de regras YARA")').innerText();
expect('licença, autor e origem à vista', section.includes('DRL 1.1') && section.includes('Florian Roth') && section.includes('MIT'), section.slice(0, 300));
expect('link da fonte', (await page.locator('a[href="https://github.com/Neo23x0/signature-base"]').getAttribute('rel'))?.includes('noreferrer'));
await page.locator('label[for="yara-pack-signature-base"]').click();
const asked = await dialog.innerText();
expect('confirma explicando o custo', asked.includes('752') && asked.includes('mais lenta'), asked);
await dialog.locator('button:has-text("Cancelar")').click();
await settle();
expect('cancelar não muda', !(await box('signature-base').isChecked()) && !state.yaraPacks.find((p) => p.id === 'signature-base').enabled);
await page.locator('label[for="yara-pack-signature-base"]').click();
await dialog.locator('button:has-text("Ligar")').click();
await page.waitForSelector('.hpsm-msg--success');
expect('liga', (await box('signature-base').isChecked()) && state.yaraPackCalls.at(-1) === 'signature-base:true', JSON.stringify(state.yaraPackCalls));
await page.screenshot({ path: `${OUT}/configuracoes-yara.png`, fullPage: true });

// 2. Tela de regras.
await go('/yara');
expect('pacote na lista', (await packRow('signature-base').innerText()).replace(/\s+/g, ' ').includes('DRL 1.1 752 de 752 Ligado'), await packRow('signature-base').innerText());
expect('sem regra de pacote na lista da equipe', (await page.locator('table[aria-label="Regras YARA"]').count()) === 0);
await packRow('bartblaze').locator('button:has-text("Ver regras")').click();
await settle();
expect('abre as regras', (await ruleRows.count()) === 2);
await page.fill('#yara-pack-search', 'autumn');
await settle();
expect('busca', (await ruleRows.count()) === 1 && (await ruleRows.first().innerText()).includes('Autumn'));
await ruleRows.first().locator('button:has-text("Ler")').click();
await settle();
const text = await page.locator('.dl-compiler-output pre').innerText();
expect('lê o texto', text.includes('author = "@bartblaze"'), text);
expect('texto não vira HTML', (await page.locator('.dl-compiler-output pre b').count()) === 0 && text.includes('<b>'));
expect('sem editar', (await ruleRows.first().locator('button:has-text("Editar")').count()) === 0);
await page.screenshot({ path: `${OUT}/yara-pacotes.png`, fullPage: true });
await ruleRows.first().locator('button:has-text("Desativar")').click();
await settle();
expect('desativa', (await ruleRows.first().innerText()).includes('Inativa'));
await ruleRows.first().locator('button:has-text("Aplicar às amostras")').click();
await settle();
expect('aplicar pede confirmação', (await dialog.innerText()).includes('Aplicar'));
await dialog.locator('button:has-text("Cancelar")').click();
await ruleRows.first().locator('button:has-text("Excluir")').click();
await settle();
expect('excluir avisa que não volta', (await dialog.innerText()).includes('não volta'));
await dialog.locator('button:has-text("Excluir")').click();
await settle();
expect('exclui', (await ruleRows.count()) === 0);
expect('leitura fechada ao excluir', (await page.locator('.dl-compiler-output pre').count()) === 0);

// 3. Analista: nao liga pacote.
state.role = 'ANALYST';
await go('/yara');
expect('analista vê que é com a administração', (await page.locator('section:has-text("Pacotes de regras")').innerText()).includes('só administradores'));

// 4. Resultado na ficha com o autor.
state.yara.e1 = {
  activeRules: 400,
  pending: false,
  scan: {
    status: 'MATCHED',
    rulesCount: 400,
    error: null,
    scannedAt: '2026-11-01T10:00:00.000Z',
    matches: [
      { rule: 'bartblaze/APT/Autumn', identifier: 'Autumn_Backdoor_Loader', tags: [], description: 'Loader', matches: 1, author: '@bartblaze', pack: 'bartblaze' },
      { rule: 'Da equipe', identifier: 'da_equipe', tags: [], description: null, matches: 2, author: null, pack: null },
    ],
  },
};
await go('/entries/e1');
const table = await page.locator('table[aria-label="Regras YARA que casaram"]').innerText();
expect('autor e pacote', table.replace(/\s+/g, ' ').includes('@bartblaze (pacote bartblaze)'), table);
expect('regra da equipe sem autor', /da_equipe\s+Da equipe[\s\S]*—/.test(table), table);
await page.screenshot({ path: `${OUT}/yara-autor.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npacotes de regras YARA: tudo ok');
process.exit(failures ? 1 : 0);
