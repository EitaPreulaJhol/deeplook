// Artefatos do sandbox (revisao de novembro, 3.7): no painel do ambiente isolado, as miniaturas dos
// prints com a hora, os processos que surgiram desde a primeira listagem (com a linha de comando),
// o aviso quando o agente da VM nao responde e os artefatos depois de o ambiente encerrar. Com o
// Sysmon no template (plano pos-revisao, 5.3): a arvore de processos, as listas, o motivo quando
// ele falta e os dominios e IPs nos IOCs sugeridos do relatorio. Com a captura pelo MikroTik (5.4):
// o pcap para baixar, o que o Suricata achou e o motivo quando a captura falha.
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
const network = {
  status: 'STORED',
  error: null,
  mac: 'BC:24:11:00:23:8D',
  packets: 1532,
  bytes: 2_400_000,
  truncated: false,
  startedAt: t(0),
  stoppedAt: t(11),
  pcap: true,
  ids: {
    status: 'DONE',
    error: null,
    ms: 26000,
    finishedAt: t(12),
    result: {
      alertsTotal: 3,
      version: '7.0.10 RELEASE',
      rules: { count: 53477, updatedAt: t(0) },
      alerts: [
        { sid: 2027865, signature: 'ET MALWARE Possible Cobalt Strike Beacon', severity: 1, proto: 'TCP', src: '10.10.0.2:49711', dst: '203.0.113.7:443', count: 2 },
        { sid: 2013028, signature: 'ET POLICY curl User-Agent Outbound', severity: 3, proto: 'TCP', src: '10.10.0.2:49712', dst: '198.51.100.4:80', count: 1 },
      ],
      dns: [{ name: 'c2.evil.example', type: 'A', answers: ['203.0.113.7'], count: 4 }],
      http: [{ host: 'evil.example', method: 'GET', url: '/stage2.bin', status: 200, dst: '198.51.100.4:80', count: 1 }],
      tls: [{ sni: 'c2.evil.example', issuer: 'CN=Fake CA', dst: '203.0.113.7:443', count: 3 }],
    },
  },
};
state.sandboxes.e1 = runningSandbox('e1', 40);
state.sandboxArtifacts = {
  'sb-e1': { status: 'RUNNING', note: null, intervalS: 60, screenshots: shots, processes: { at: t(11), firstAt: t(0), lists: 12, current: [], appeared }, sysmon, captureEnabled: true, network },
  'sb-e4': { status: 'RUNNING', note: 'o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)', intervalS: 60, screenshots: shots.slice(0, 2), processes: null, sysmon: null, captureEnabled: true, network: { status: 'FAILED', error: 'sniffer do MikroTik: o RouterOS recusou o usuário ou a senha', mac: 'BC:24:11:00:23:8E', packets: null, bytes: null, truncated: false, startedAt: t(0), stoppedAt: t(0), pcap: false, ids: null } },
  'sb-e3': { status: 'RUNNING', note: null, intervalS: 60, screenshots: [], processes: { at: t(1), firstAt: t(0), lists: 2, current: [], appeared: [] }, sysmon: { at: t(1), available: false, reason: 'Sysmon não instalado no template (canal Microsoft-Windows-Sysmon/Operational ausente)' } },
};
state.sysmonIndicators = { e1: ['c2.evil.example', '203.0.113.7'] };
state.networkIndicators = { e1: ['c2.evil.example', 'evil.example'] };
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
const summary = await block.locator('.dl-sandbox-artifacts__summary:not(.dl-sysmon__summary):not(.dl-network__summary)').innerText();
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
// 1e. Trafego de rede (5.4): o pcap e o Suricata.
const net = block.locator('.dl-network');
const netSummary = (await net.locator('.dl-network__summary').allInnerTexts()).join(' | ');
expect('pcap: pacotes e tamanho', netSummary.includes('1532 pacote(s), 2,3 MB'), netSummary);
expect('link de download do pcap', (await net.locator('a[download]').getAttribute('href')) === '/api/sandbox/sb-e1/pcap');
expect('resumo do Suricata com as regras', netSummary.includes('Suricata: 3 alerta(s).') && netSummary.includes('Regras ET Open: 53477'), netSummary);
const alertRows = (await net.locator('table[aria-label="Alertas do Suricata"] tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
expect('alerta de severidade alta primeiro, com o fluxo', alertRows[0]?.startsWith('alta ET MALWARE Possible Cobalt Strike Beacon TCP 10.10.0.2:49711 → 203.0.113.7:443 2'), alertRows.join(' || '));
const netTable = async (label) => (await net.locator(`table[aria-label="${label}"] tbody`).innerText()).replace(/\s+/g, ' ');
expect('DNS com a resposta', (await netTable('Consultas DNS no tráfego')).includes('c2.evil.example A 4 203.0.113.7'));
expect('HTTP com host e caminho', (await netTable('Pedidos HTTP')).includes('evil.example/stage2.bin'));
expect('TLS com o SNI e o emissor', (await netTable('Conexões TLS')).includes('CN=Fake CA c2.evil.example'));
await block.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/sandbox-artefatos.png`, fullPage: true });

// 1c. O dominio e o IP vao para os IOCs sugeridos do relatorio.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.locator('button:has-text("Inserir IOCs sugeridos")').click();
await settle(200);
const iocs = await page.inputValue('#report-iocs');
expect('IOCs sugeridos com o que o Sysmon viu', iocs.includes('c2.evil.example') && iocs.includes('203.0.113.7'), iocs);
expect('IOCs sugeridos com o host do tráfego (Suricata)', iocs.split('\n').includes('evil.example'), iocs);

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
expect('captura de rede com falha: o motivo', (await page.locator('.hpsm-msg--warning .hpsm-msg__text').allInnerTexts()).join(' ').includes('A captura de rede não funcionou: sniffer do MikroTik: o RouterOS recusou'));

// 3. Encerrado: os artefatos ficam.
state.sandboxes.e1 = { ...runningSandbox('e1', 40), status: 'STOPPED' };
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
expect('encerrado: artefatos continuam visíveis', (await block.locator('.dl-sandbox-artifacts__shots li').count()) === 8);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nartefatos do sandbox: tudo ok');
process.exit(failures ? 1 : 0);
