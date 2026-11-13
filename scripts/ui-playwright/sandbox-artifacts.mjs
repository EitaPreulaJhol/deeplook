// Artefatos do sandbox (revisao de novembro, 3.7): no painel do ambiente isolado, as miniaturas dos
// prints com a hora, os processos que surgiram desde a primeira listagem (com a linha de comando),
// o aviso quando o agente da VM nao responde e os artefatos depois de o ambiente encerrar.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const t = (min) => new Date(Date.UTC(2026, 10, 12, 15, min)).toISOString();
const shots = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, createdAt: t(i) }));
const proc = (pid, ppid, name, cmd) => ({ pid, ppid, name, cmd });
const appeared = [proc(4410, 3020, 'fatura.exe', '"D:\\fatura.exe" /silent'), proc(4512, 4410, 'powershell.exe', 'powershell -enc SQBFAFgA')];
state.sandboxes.e1 = runningSandbox('e1', 40);
state.sandboxArtifacts = {
  'sb-e1': { status: 'RUNNING', note: null, intervalS: 60, screenshots: shots, processes: { at: t(11), firstAt: t(0), lists: 12, current: [], appeared } },
  'sb-e4': { status: 'RUNNING', note: 'o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)', intervalS: 60, screenshots: shots.slice(0, 2), processes: null },
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const block = page.locator('.dl-sandbox-artifacts');

// 1. Em execucao: miniaturas e processos novos.
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
const thumbs = block.locator('.dl-sandbox-artifacts__shots li');
expect('8 miniaturas: o primeiro print e os 7 mais recentes', (await thumbs.count()) === 8);
const links = await thumbs.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
expect('a primeira é o primeiro print, a última o mais recente', links[0].endsWith('/s0') && links[7].endsWith('/s11'), links.join(' '));
expect('a imagem carrega', await thumbs.first().locator('img').evaluate((img) => img.complete && img.naturalWidth > 0));
expect('aviso de quantos foram guardados', (await block.innerText()).includes('12 prints guardados'));
const summary = await block.locator('.dl-sandbox-artifacts__summary').innerText();
expect('resumo dos processos novos', summary.startsWith('2 processo(s) surgiram desde a primeira listagem'), summary);
const rows = (await block.locator('table[aria-label="Processos que surgiram"] tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
expect('processo com o pai e a linha de comando', rows[1] === '4512 4410 powershell.exe powershell -enc SQBFAFgA', rows.join(' || '));
expect('aviso de que o guest pode esconder processos', (await block.innerText()).includes('um malware pode esconder processos'));
await block.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/sandbox-artefatos.png`, fullPage: true });

// 2. Agente que nao responde: o motivo, e os prints continuam.
state.sandboxes.e4 = runningSandbox('e4', 40);
await page.goto(ORIGIN + '/entries/e4?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
expect('motivo do agente', (await page.locator('.hpsm-msg--warning .hpsm-msg__text').allInnerTexts()).join(' ').includes('qemu-guest-agent não respondeu'));
expect('prints mesmo sem o agente', (await block.locator('.dl-sandbox-artifacts__shots li').count()) === 2);

// 3. Encerrado: os artefatos ficam.
state.sandboxes.e1 = { ...runningSandbox('e1', 40), status: 'STOPPED' };
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
expect('encerrado: artefatos continuam visíveis', (await block.locator('.dl-sandbox-artifacts__shots li').count()) === 8);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nartefatos do sandbox: tudo ok');
process.exit(failures ? 1 : 0);
