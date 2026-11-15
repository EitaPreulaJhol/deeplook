// Artefatos do sandbox (revisao de novembro, 3.7): no painel do ambiente isolado, as miniaturas dos
// prints com a hora, os processos que surgiram desde a primeira listagem (com a linha de comando),
// o aviso quando o agente da VM nao responde e os artefatos depois de o ambiente encerrar. Com o
// Sysmon no template (plano pos-revisao, 5.3): a arvore de processos, as listas, o motivo quando
// ele falta e os dominios e IPs nos IOCs sugeridos do relatorio. Com a captura pelo MikroTik (5.4):
// o pcap para baixar, o que o Suricata achou e o motivo quando a captura falha.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

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
// Linha do tempo (plans/sandbox-execucoes, fase 3): a amostra, o PowerShell que ela abriu e o ruido
// do Windows (um svchost), com as marcas do ambiente.
const at = (min, sec) => new Date(Date.UTC(2026, 10, 12, 15, min, sec)).toISOString();
const ev = (min, sec, kind, image, pid, sample, detail) => ({ time: at(min, sec), kind, image, pid, sample, detail });
state.sandboxTimelines = {
  'sb-e1': {
    sample: { name: 'fatura.exe', found: true, processes: 2 },
    events: [
      ev(1, 0, 'process', 'D:\\fatura.exe', 4410, true, { cmd: '"D:\\fatura.exe" /silent', parentImage: 'C:\\Windows\\explorer.exe', ppid: 3020, user: null }),
      ev(1, 30, 'process', 'C:\\Windows\\System32\\svchost.exe', 900, false, { cmd: 'svchost.exe -k netsvcs', parentImage: null, ppid: 600, user: null }),
      ev(2, 0, 'process', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 4512, true, { cmd: 'powershell -enc SQBFAFgA', parentImage: 'D:\\fatura.exe', ppid: 4410, user: null }),
      ev(3, 0, 'dns', 'powershell.exe', null, true, { query: 'c2.evil.example', results: '203.0.113.7;' }),
      ev(3, 5, 'network', 'powershell.exe', null, true, { protocol: 'tcp', host: null, ip: '203.0.113.7', port: 443 }),
      ev(3, 20, 'dns', 'svchost.exe', null, false, { query: 'settings-win.data.microsoft.com', results: null }),
      ev(4, 0, 'file', 'powershell.exe', null, true, { path: 'C:\\Users\\Public\\stage2.dll' }),
      ev(5, 0, 'registry', 'powershell.exe', null, true, { action: 'SetValue', key: 'HKU\\S-1-5-21\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\upd', details: 'C:\\Users\\Public\\stage2.dll' }),
    ],
    markers: [
      { kind: 'started', time: at(0, 0) },
      { kind: 'autorun', time: at(0, 55) },
      { kind: 'sample', time: at(1, 0) },
      { kind: 'screenshot', time: at(2, 30), id: 's2' },
    ],
  },
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
// 1f. Linha do tempo da execucao (fase 3): por padrao so a amostra, com as marcas do ambiente.
const timeline = block.locator('details.dl-timeline');
expect('linha do tempo recolhida, sem pedir nada antes de abrir', !(await timeline.evaluate((d) => d.open)) && !(state.timelineQueries ?? []).length);
await timeline.locator('summary').click();
const tlItems = timeline.locator('.dl-timeline__list > li');
await tlItems.first().waitFor();
const tlRows = async () => (await tlItems.allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
let tl = await tlRows();
expect(
  'só a amostra por padrão: 6 eventos e as 4 marcas intercaladas, sem o svchost',
  (await timeline.getByLabel('Só a amostra e o que ela abriu').isChecked()) &&
    tl.length === 10 &&
    tl[0].endsWith('Ambiente no ar') &&
    tl[1].endsWith('Amostra aberta pela execução automática') &&
    !tl.some((r) => r.includes('svchost')),
  tl.join(' || '),
);
expect(
  'evento com tipo, processo e detalhe; print como link',
  tl.some((r) => r.includes('DNS powershell.exe c2.evil.example → 203.0.113.7')) &&
    tl.some((r) => r.includes('rede powershell.exe tcp 203.0.113.7:443')) &&
    (await timeline.locator('.dl-timeline__marker a').getAttribute('href')) === '/api/sandbox/sb-e1/artifacts/s2',
  tl.join(' || '),
);
await timeline.getByLabel('Tudo (com o ruído do Windows)').check();
await page.waitForFunction(() => document.querySelectorAll('details.dl-timeline .dl-timeline__list > li').length === 12);
tl = await tlRows();
const noiseRow = tl.find((r) => r.includes('svchost.exe -k netsvcs')) ?? '';
expect(
  'tudo: o ruído do Windows junto; a amostra marcada em texto, não só em cor',
  noiseRow && !noiseRow.includes('amostra') && (await timeline.locator('.dl-timeline__event.is-sample .dl-timeline__tag').count()) === 6 && state.timelineQueries.at(-1).includes('scope=all'),
  tl.join(' || '),
);
await timeline.getByLabel('processo').uncheck({ force: true });
await page.waitForFunction(() => document.querySelectorAll('details.dl-timeline .dl-timeline__list > li').length === 9);
expect('filtro por tipo vai ao servidor', state.timelineQueries.at(-1).includes('kinds=network%2Cdns%2Cfile%2Cregistry'), state.timelineQueries.at(-1));
await timeline.screenshot({ path: `${OUT}/sandbox-linha-do-tempo.png` });
await timeline.getByLabel('processo').check({ force: true });

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

// 3b. Historico de execucoes (fase 1): a anterior fica recolhida e so carrega ao abrir.
state.sandboxRuns = {
  e1: [
    { id: 'sb-e1', status: 'STOPPED', createdAt: t(0), startedAt: t(0), stoppedAt: t(11), autoRun: 'DONE', autoRunAt: t(1), autoRunUser: 'SANDBOX\\analista', autoRunSysmon: true, autoRunError: null, analyst: { id: 'u1', displayName: 'Ana Souza' } },
    { id: 'sb-e1-old', status: 'EXPIRED', createdAt: '2026-11-10T14:00:00.000Z', startedAt: '2026-11-10T14:00:30.000Z', stoppedAt: '2026-11-10T15:00:30.000Z', autoRun: 'DONE', autoRunAt: '2026-11-10T14:02:00.000Z', autoRunUser: 'SANDBOX\\analista', autoRunSysmon: true, autoRunError: null, analyst: { id: 'u2', displayName: 'Bruno Lima' } },
  ],
};
state.sandboxArtifacts['sb-e1-old'] = { status: 'EXPIRED', note: null, intervalS: 60, screenshots: shots.slice(0, 3), processes: null, sysmon: null };
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
const history = page.locator('.dl-sandbox-history');
await history.waitFor();
const runSummary = (await history.locator('summary').innerText()).replace(/\s+/g, ' ');
expect(
  'execuções anteriores: só a outra, com quem abriu, a situação e a execução automática',
  (await history.locator('h4').innerText()) === 'Execuções anteriores (1)' && runSummary.includes('Bruno Lima') && runSummary.includes('amostra aberta automaticamente às'),
  runSummary,
);
expect('artefatos da anterior só ao abrir', (await history.locator('.dl-sandbox-artifacts').count()) === 0);
await history.locator('summary').click();
await history.locator('.dl-sandbox-artifacts__shots li').first().waitFor();
expect('a anterior mostra os próprios prints', (await history.locator('.dl-sandbox-artifacts__shots li').count()) === 3);
await page.locator('.hpsm-section:has(.dl-sandbox-history)').screenshot({ path: `${OUT}/sandbox-historico.png` });

// 4. Arquivo expurgado pela retencao: nao abre ambiente, mas os artefatos do ultimo continuam.
Object.assign(entries.find((e) => e.id === 'e1'), { storageKey: null, filePurgedAt: '2026-10-01T12:00:00.000Z' });
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await block.waitFor();
const sandboxSection = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Ambiente isolado"))');
expect(
  'expurgado: o aviso, sem abrir ambiente, e os artefatos do último',
  (await sandboxSection.innerText()).includes('expurgado') &&
    (await sandboxSection.locator('button', { hasText: /Abrir/ }).count()) === 0 &&
    (await block.locator('.dl-sandbox-artifacts__shots li').count()) === 8,
);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nartefatos do sandbox: tudo ok');
process.exit(failures ? 1 : 0);
