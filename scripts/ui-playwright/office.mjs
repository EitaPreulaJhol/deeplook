// Documento (oletools, item 7.14; revisao de novembro, 3.2): secao da ficha com a situacao, o
// MacroRaptor, os alertas, os campos DDE, as palavras-chave e o codigo das macros recolhido; a
// atualizacao sozinha enquanto esta na fila; "Analisar de novo" so para analistas; secao escondida
// quando o arquivo nao e documento.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const at = '2026-10-22T15:00:00.000Z';
const done = {
  enabled: true,
  eligible: true,
  maxMb: 32,
  analysis: {
    status: 'DONE',
    result: {
      vba: {
        macros: true,
        xlm: false,
        stomping: false,
        modules: [{ name: 'ThisDocument.cls', lines: 4, code: 'Sub AutoOpen()\n  Shell "powershell -enc SQBFAFgA"\nEnd Sub', truncated: false }],
        keywords: [
          { type: 'AutoExec', keyword: 'AutoOpen', description: 'Runs when the Word document is opened' },
          { type: 'Suspicious', keyword: 'Shell', description: 'May run an executable file or a system command' },
        ],
        xlmLines: [],
        mraptor: { suspicious: true, autoexec: true, write: false, execute: true, flags: 'A-X' },
        error: null,
      },
      dde: { links: ['DDEAUTO c:\\windows\\system32\\cmd.exe "/k calc.exe"'], error: null },
      rtf: null,
    },
    alerts: [
      { level: 'high', text: 'Macro suspeita pelo MacroRaptor: executa ao abrir, executa programas.' },
      { level: 'high', text: 'Campo DDE (executa comandos sem macro): DDEAUTO c:\\windows\\system32\\cmd.exe' },
    ],
    error: null,
    version: '0.60.2',
    ms: 1840,
    attempts: 1,
    createdAt: at,
    startedAt: at,
    finishedAt: at,
  },
};
state.office = {
  e3: [{ ...done, analysis: { ...done.analysis, status: 'PENDING', result: null, alerts: null, finishedAt: null } }, done],
  e4: { enabled: false, eligible: true, maxMb: 32, analysis: null },
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Documento (oletools)"))');
const text = async () => (await section.innerText()).replace(/\s+/g, ' ');

// 1. Na fila e, sozinha, concluida.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('na fila', (await text()).includes('Na fila'), await text());
await page.waitForFunction(() => document.body.textContent?.includes('Achados de risco'), null, { timeout: 12000 });
expect('atualiza sozinha: achados de risco com o tempo', (await text()).includes('Achados de risco') && (await text()).includes('(1.8 s)'), await text());
expect('MacroRaptor suspeita com as flags', (await text()).includes('Suspeita (A-X)'));
expect('alertas em vermelho', (await section.locator('.dl-office__alerts .hpsm-status--red').count()) === 2);
expect('campo DDE com o comando', (await section.locator('.dl-office__list').innerText()).includes('DDEAUTO'));
const keywords = await section.locator('table[aria-label="Palavras-chave das macros"] tbody tr').count();
expect('palavras-chave das macros', keywords === 2, keywords);
const code = section.locator('details.dl-office__code').first();
expect('código recolhido por padrão', (await code.getAttribute('open')) === null);
await code.locator('summary').click();
expect('código abre ao clicar', (await code.locator('pre').innerText()).includes('Shell "powershell'));
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/documento-oletools.png`, fullPage: true });

// 2. Analisar de novo (analista).
await section.locator('button:has-text("Analisar de novo")').click();
await page.waitForTimeout(400);
expect('POST de nova análise', state.calls.includes('POST /api/entries/e3/office'));

// 3. Desligado: diz por que.
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('desligado: diz por quê, sem botão', (await text()).includes('OLETOOLS_URL vazio') && (await section.locator('button:has-text("Analisar")').count()) === 0, await text());

// 4. Nao e documento: a secao nem aparece.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('fora de documento: sem seção', (await section.count()) === 0);

// 5. Usuario comum: ve o resultado, sem o botao.
state.role = 'USER';
state.office.e3 = done;
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('usuário comum vê sem o botão', (await section.count()) === 1 && (await section.locator('button:has-text("Analisar")').count()) === 0);
state.role = undefined;

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ndocumento (oletools): tudo ok');
process.exit(failures ? 1 : 0);
