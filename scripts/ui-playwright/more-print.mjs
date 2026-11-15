// Menu "Mais" da toolbar da amostra (28) e ficha para impressao (29): abrir pelo
// mouse e teclado, Esc devolve o foco, copiar link, abrir em nova janela, exportar
// relatorios em Markdown (desabilitado sem relatorio publicado) e a ficha impressa
// (dados, relatorios, historico, "Impresso por / em", impressao automatica, sem
// dados do sandbox, toolbar oculta no papel, PDF em A4). Com uma execucao no
// ambiente isolado, o resumo dela na ficha e no Markdown (ajustes, item 6).
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
// A caixa de impressao do navegador nao existe no headless: conta as chamadas.
await context.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const more = page.locator('.hpsm-toolbar__action[aria-haspopup="menu"]:has-text("Mais")');
const menu = page.locator('.hpsm-ctxmenu');
const item = (label) => menu.locator(`button:has-text("${label}")`);
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());

// 1. Abrir/fechar.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('botão "Mais ▾" na toolbar', (await more.textContent())?.replace(/\s+/g, '') === 'Mais▾');
await more.click();
expect('clique abre o menu', await menu.isVisible() && (await more.getAttribute('aria-expanded')) === 'true');
const labels = (await menu.locator('button').allTextContents()).map((t) => t.trim());
expect(
  'itens do menu',
  labels.join('|') ===
    'Copiar link do registro|Abrir em nova janela|Marcar como duplicata…|Comparar com…|Adicionar a caso…|Decodificar texto…|Baixar arquivo original…|Imprimir ficha…|Exportar relatórios (Markdown)|Exportar IOCs (CSV)|Exportar IOCs (STIX 2.1)|Exportar IOCs (MISP)|Mover para a lixeira…',
  labels.join('|'),
);
const box = await menu.boundingBox();
const btn = await more.boundingBox();
expect('menu abre logo abaixo do botão', Math.abs(box.y - (btn.y + btn.height)) <= 3 && Math.abs(box.x - btn.x) <= 3, `${box.x},${box.y} vs ${btn.x},${btn.y + btn.height}`);
await page.screenshot({ path: `${OUT}/mais-menu.png` });
await more.click();
expect('clicar de novo fecha', !(await menu.isVisible()));
await more.focus();
await page.keyboard.press('ArrowDown');
expect('seta para baixo abre com foco no 1º item', (await menu.isVisible()) && (await focused()) === 'Copiar link do registro');
await page.keyboard.press('Escape');
expect('Esc fecha e devolve o foco ao botão', !(await menu.isVisible()) && (await focused())?.startsWith('Mais'));
await page.keyboard.press('Enter');
expect('Enter no botão abre', await menu.isVisible());
await page.keyboard.press('Escape');

// 2. Copiar link.
await more.click();
await item('Copiar link do registro').click();
await settle();
const clip = await page.evaluate(() => navigator.clipboard.readText());
expect('link copiado', clip === `${ORIGIN}/entries/e1`, clip);
expect('mensagem de cópia', (await page.locator('.hpsm-msg__text').allTextContents()).includes('Link do registro copiado.'));

// 3. Abrir em nova janela.
await more.click();
const [popup] = await Promise.all([context.waitForEvent('page'), item('Abrir em nova janela').click()]);
await popup.waitForLoadState();
expect('nova janela com o registro', new URL(popup.url()).pathname === '/entries/e1');
await popup.close();

// 4. Exportar relatorios (Markdown).
await more.click();
const [download] = await Promise.all([page.waitForEvent('download'), item('Exportar relatórios (Markdown)').click()]);
expect('nome do arquivo', download.suggestedFilename() === 'deeplook-e1-relatorios.md', download.suggestedFilename());
const md = readFileSync(await download.path(), 'utf8');
expect('Markdown com título e dados', md.startsWith('# instalador_suspeito.exe') && md.includes('| SHA-256 |') && md.includes('Exportado do DeepLook por Ana Souza'));
expect('Markdown com o relatório publicado', md.includes('## Relatórios publicados (1)') && md.includes('Executável empacotado com UPX') && md.includes('185.0.2.10'));
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
await more.click();
expect('sem relatório publicado: exportar desabilitado', await item('Exportar relatórios (Markdown)').isDisabled());
await page.keyboard.press('Escape');

// 5. Imprimir ficha.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
const [print] = await Promise.all([context.waitForEvent('page'), item('Imprimir ficha…').click()]);
await print.waitForLoadState('networkidle');
await print.waitForTimeout(600);
const printUrl = new URL(print.url());
expect('ficha abre fora da casca', printUrl.pathname === '/entries/e1/imprimir' && (await print.locator('.dl-shell').count()) === 0);
expect('impressão automática (uma vez)', (await print.evaluate(() => window.__printed)) === 1);
expect('título da janela', (await print.title()) === 'Ficha — instalador_suspeito.exe', await print.title());
const meta = (await print.locator('.dl-print__meta').innerText()).replace(/\s+/g, ' ');
expect('"Impresso por / em"', /^Impresso por Ana Souza em \d{2}\/\d{2}\/\d{4}/.test(meta), meta);
const sections = await print.locator('.dl-print h2').allTextContents();
expect('dados, relatórios e histórico de uma vez', sections.join('|') === 'Dados da amostra|Relatórios publicados (1)|Histórico (1)', sections.join('|'));
const text = await print.locator('.dl-print').innerText();
expect('SHA-256 e relatório na ficha', text.includes('Executável empacotado com UPX') && text.includes('Cria HKCU'));
expect('nada do ambiente isolado', !/console|vnc|senha|sandbox|ambiente isolado/i.test(text.replace('Manuseie arquivos e links apenas em ambiente isolado.', '')));
await print.screenshot({ path: `${OUT}/ficha-tela.png`, fullPage: true });

// No papel: toolbar some; gera o PDF em A4 para conferencia.
await print.emulateMedia({ media: 'print' });
expect('toolbar oculta na impressão', !(await print.locator('.dl-print__toolbar').isVisible()));
await print.pdf({ path: `${OUT}/ficha.pdf`, format: 'A4', printBackground: true });
await print.emulateMedia({ media: 'screen' });
await print.click('.hpsm-toolbar__action:has-text("Imprimir")');
expect('botão Imprimir', (await print.evaluate(() => window.__printed)) === 2);

// Sem ?auto=1 nao imprime sozinha.
const manual = await context.newPage();
await manual.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
await manual.waitForTimeout(600);
expect('sem ?auto=1 não imprime sozinha', (await manual.evaluate(() => window.__printed)) === 0);

// 6. Com uma execucao no ambiente isolado (plans/ajustes-usabilidade, item 6): o resumo
// na ficha e no Markdown; console e credenciais continuam de fora.
state.sandboxRuns = {
  e1: [
    { id: 'sb-run2', status: 'STOPPED', createdAt: '2026-11-12T15:00:00.000Z', startedAt: '2026-11-12T15:01:00.000Z', stoppedAt: '2026-11-12T15:30:00.000Z', autoRun: 'DONE', autoRunAt: '2026-11-12T15:02:00.000Z', autoRunUser: 'analista', autoRunSysmon: true, autoRunError: null, analyst: { id: 'u1', displayName: 'Ana Souza' } },
  ],
};
state.sandboxSummaries = {
  'sb-run2': {
    session: { id: 'sb-run2', status: 'STOPPED', createdAt: '2026-11-12T15:00:00.000Z', startedAt: '2026-11-12T15:01:00.000Z', stoppedAt: '2026-11-12T15:30:00.000Z', analyst: 'Ana Souza', autoRun: 'DONE', autoRunAt: '2026-11-12T15:02:00.000Z', autoRunUser: 'analista', autoRunSysmon: true },
    sample: { name: 'instalador_suspeito.exe', found: true, processes: 2 },
    sysmon: { available: true, reason: null, events: 214 },
    processes: [
      { time: '2026-11-12T15:02:01.000Z', image: 'C:\\Users\\analista\\Desktop\\instalador_suspeito.exe', pid: 4410, ppid: 900, cmd: '"C:\\Users\\analista\\Desktop\\instalador_suspeito.exe"' },
      { time: '2026-11-12T15:02:03.000Z', image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', pid: 4512, ppid: 4410, cmd: 'powershell -enc SQBFAFgA' },
    ],
    dns: [{ query: 'c2.evil.example', results: '203.0.113.7;' }],
    network: [{ destination: '203.0.113.7:443', protocol: 'tcp' }],
    files: ['C:\\Users\\Public\\stage2.dll'],
    registry: [{ key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\upd', action: 'SetValue', details: 'C:\\Users\\Public\\stage2.dll' }],
    appeared: [],
    screenshots: 3,
  },
};
const withRun = await context.newPage();
await withRun.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
const runSections = await withRun.locator('.dl-print h2').allTextContents();
expect('ficha: a execução entre os relatórios e o histórico', runSections.join('|') === 'Dados da amostra|Relatórios publicados (1)|Ambiente isolado: última execução|Histórico (1)', runSections.join('|'));
const runText = await withRun.locator('.dl-print__section:has(h2:text-is("Ambiente isolado: última execução"))').innerText();
expect(
  'ficha: Sysmon, execução automática, processos, DNS, conexões, arquivos e registro',
  runText.includes('214 evento(s)') &&
    runText.includes('na sessão de analista') &&
    runText.includes('powershell.exe (PID 4512) — powershell -enc SQBFAFgA') &&
    runText.includes('c2.evil.example → 203.0.113.7') &&
    runText.includes('tcp 203.0.113.7:443') &&
    runText.includes('C:\\Users\\Public\\stage2.dll') &&
    runText.includes('SetValue HKCU\\Software'),
  runText,
);
expect('ficha: nada de console nem credenciais', !/console|vnc|senha/i.test(runText));
await withRun.screenshot({ path: `${OUT}/ficha-execucao.png`, fullPage: true });
await withRun.close();
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await more.click();
const [runDownload] = await Promise.all([page.waitForEvent('download'), item('Exportar relatórios (Markdown)').click()]);
const runMd = readFileSync(await runDownload.path(), 'utf8');
expect(
  'Markdown: a execução depois dos relatórios, em bloco de código',
  runMd.indexOf('## Ambiente isolado: última execução') > runMd.indexOf('## Relatórios publicados (1)') &&
    runMd.includes('| Sysmon | 214 evento(s) |') &&
    runMd.includes('**Consultas DNS**\n\n```\nc2.evil.example → 203.0.113.7\n```'),
  runMd.slice(runMd.indexOf('## Ambiente')),
);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmais/imprimir: tudo ok');
process.exit(failures ? 1 : 0);
