// Artefatos do sandbox (revisao de novembro, 3.7): no painel do ambiente isolado, as miniaturas dos
// prints com a hora, os processos que surgiram desde a primeira listagem (com a linha de comando),
// o aviso quando o agente da VM nao responde e os artefatos depois de o ambiente encerrar. Com o
// Sysmon no template (plano pos-revisao, 5.3): a arvore de processos, as listas, o motivo quando
// ele falta e os dominios e IPs nos IOCs sugeridos do relatorio.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const t = (min) => new Date(Date.UTC(2026, 10, 12, 15, min)).toISOString();
const shots = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, createdAt: t(i) }));
const proc = (pid, ppid, name, cmd) => ({ pid, ppid, name, cmd });
const appeared = [proc(4410, 3020, 'fatura.exe', '"D:\\fatura.exe" /silent'), proc(4512, 4410, 'powershell.exe', 'powershell -enc SQBFAFgA')];
const sp = (time, pid, ppid, image, cmd, parentImage) => ({ time: t(time), pid, ppid, image, cmd, parentImage, user: null, hashes: null });
const sysmon = {
  at: t(11),
  available: true,
  events: 6,
  truncated: false,
  processes: [
    sp(1, 4410, 3020, 'D:\\fatura.exe', '"D:\\fatura.exe" /silent', 'C:\\Windows\\explorer.exe'),
    sp(2, 4512, 4410, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell -enc SQBFAFgA', 'D:\\fatura.exe'),
  ],
  network: [{ time: t(3), image: 'powershell.exe', protocol: 'tcp', dstIp: '203.0.113.7', dstPort: 443, dstHost: null }],
  dns: [{ time: t(3), image: 'powershell.exe', query: 'c2.evil.example', results: '203.0.113.7;' }],
  files: [{ time: t(4), image: 'powershell.exe', path: 'C:\\Users\\Public\\stage2.dll' }],
  registry: [{ time: t(5), image: 'powershell.exe', action: 'SetValue', key: 'HKU\\S-1-5-21\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\upd', details: 'C:\\Users\\Public\\stage2.dll' }],
};
state.sandboxes.e1 = runningSandbox('e1', 40);
state.sandboxArtifacts = {
  'sb-e1': { status: 'RUNNING', note: null, intervalS: 60, screenshots: shots, processes: { at: t(11), firstAt: t(0), lists: 12, current: [], appeared }, sysmon },
  'sb-e4': { status: 'RUNNING', note: 'o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)', intervalS: 60, screenshots: shots.slice(0, 2), processes: null, sysmon: null },
  'sb-e3': { status: 'RUNNING', note: null, intervalS: 60, screenshots: [], processes: { at: t(1), firstAt: t(0), lists: 2, current: [], appeared: [] }, sysmon: { at: t(1), available: false, reason: 'Sysmon não instalado no template (canal Microsoft-Windows-Sysmon/Operational ausente)' } },
};
state.sysmonIndicators = { e1: ['c2.evil.example', '203.0.113.7'] };
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const settle = (ms = 500) => page.waitForTimeout(ms);

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
const summary = await block.locator('.dl-sandbox-artifacts__summary:not(.dl-sysmon__summary)').innerText();
expect('resumo dos processos novos', summary.startsWith('2 processo(s) surgiram desde a primeira listagem'), summary);
const rows = (await block.locator('table[aria-label="Processos que surgiram"] tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
expect('processo com o pai e a linha de comando', rows[1] === '4512 4410 powershell.exe powershell -enc SQBFAFgA', rows.join(' || '));
expect('aviso de que o guest pode esconder processos', (await block.innerText()).includes('um malware pode esconder processos'));
// 1b. Sysmon: arvore (o PowerShell sob a amostra, que esta sob o explorer) e as listas.
const tree = block.locator('ul[aria-label="Árvore de processos do Sysmon"]');
const root = (await tree.locator(':scope > li > .dl-sysmon__proc').innerText()).replace(/\s+/g, ' ');
expect('raiz da árvore: explorer → fatura.exe', root.startsWith('explorer.exe → fatura.exe PID 4410'), root);
const child = (await tree.locator(':scope > li > ul > li > .dl-sysmon__proc').innerText()).replace(/\s+/g, ' ');
expect('o PowerShell é filho da amostra', child === 'powershell.exe PID 4512', child);
const tableText = async (label) => (await block.locator(`table[aria-label="${label}"] tbody`).innerText()).replace(/\s+/g, ' ');
expect('conexão com destino e porta', (await tableText('Conexões de rede')).includes('203.0.113.7:443'));
expect('consulta DNS com a resposta', (await tableText('Consultas DNS')).includes('c2.evil.example → 203.0.113.7'));
expect('arquivo criado', (await tableText('Arquivos criados')).includes('C:\\Users\\Public\\stage2.dll'));
expect('chave de inicialização', (await tableText('Registro alterado')).includes('CurrentVersion\\Run\\upd = C:'));
await block.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/sandbox-artefatos.png`, fullPage: true });

// 1c. O dominio e o IP vao para os IOCs sugeridos do relatorio.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.locator('button:has-text("Inserir IOCs sugeridos")').click();
await settle(200);
const iocs = await page.inputValue('#report-iocs');
expect('IOCs sugeridos com o que o Sysmon viu', iocs.includes('c2.evil.example') && iocs.includes('203.0.113.7'), iocs);

// 1d. Windows sem Sysmon no template: o motivo, e os processos de sempre.
state.sandboxes.e3 = runningSandbox('e3', 40);
await page.goto(ORIGIN + '/entries/e3?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
expect('sem Sysmon: o motivo na tela', (await block.innerText()).includes('Sysmon: Sysmon não instalado no template'));

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
