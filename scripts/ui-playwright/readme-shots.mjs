// Capturas de tela do README (pagina inicial do repositorio no GitHub): as mesmas telas em ingles
// (README.md) e em portugues (README.pt-BR.md), com a API simulada e o relogio parado, para o
// resultado sair igual a cada rodada.
//
//   (no container do Playwright, como os cenarios)
//   node readme-shots.mjs            grava em out/readme/<en|pt-BR>/<tela>.png
//
// Depois, copie para .github/screenshots/ (fora do pacote de implantacao):
//   cp -r scripts/ui-playwright/out/readme/* .github/screenshots/
import { mkdirSync } from 'node:fs';

import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock } from './mock-api.mjs';
import { installScreenRoutes, seedRecords } from './screen-data.mjs';

/** O mesmo instante da suite visual: as idades das amostras do mock saem em horas e dias. */
const NOW = Date.parse('2026-10-20T13:00:00.000Z');
const at = (min) => new Date(NOW - (60 - min) * 60_000).toISOString();

/** Artefatos do ambiente isolado (os do cenario sandbox-artifacts.mjs, so o da amostra e1). */
function sandboxArtifacts() {
  const shots = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, createdAt: at(i) }));
  const sp = (time, pid, ppid, image, cmd, parentImage) => ({ time: at(time), pid, ppid, image, cmd, parentImage, user: null, hashes: null });
  return {
    status: 'RUNNING',
    note: null,
    intervalS: 60,
    screenshots: shots,
    processes: {
      at: at(11),
      firstAt: at(0),
      lists: 12,
      current: [],
      appeared: [
        { pid: 4410, ppid: 3020, name: 'fatura.exe', cmd: '"D:\\fatura.exe" /silent' },
        { pid: 4512, ppid: 4410, name: 'powershell.exe', cmd: 'powershell -enc SQBFAFgA' },
      ],
    },
    sysmon: {
      at: at(11),
      available: true,
      events: 6,
      truncated: false,
      processes: [
        sp(1, 4410, 3020, 'D:\\fatura.exe', '"D:\\fatura.exe" /silent', 'C:\\Windows\\explorer.exe'),
        sp(2, 4512, 4410, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell -enc SQBFAFgA', 'D:\\fatura.exe'),
      ],
      network: [{ time: at(3), image: 'powershell.exe', protocol: 'tcp', dstIp: '203.0.113.7', dstPort: 443, dstHost: null }],
      dns: [{ time: at(3), image: 'powershell.exe', query: 'c2.evil.example', results: '203.0.113.7;' }],
      files: [{ time: at(4), image: 'powershell.exe', path: 'C:\\Users\\Public\\stage2.dll' }],
      registry: [{ time: at(5), image: 'powershell.exe', action: 'SetValue', key: 'HKU\\S-1-5-21\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\upd', details: 'C:\\Users\\Public\\stage2.dll' }],
    },
    captureEnabled: true,
    network: {
      status: 'STORED', error: null, mac: 'BC:24:11:00:23:8D', packets: 1532, bytes: 2_400_000, truncated: false,
      startedAt: at(0), stoppedAt: at(11), pcap: true,
      ids: {
        status: 'DONE', error: null, ms: 26000, finishedAt: at(12),
        result: {
          alertsTotal: 3, version: '7.0.10 RELEASE', rules: { count: 53477, updatedAt: at(0) },
          alerts: [
            { sid: 2027865, signature: 'ET MALWARE Possible Cobalt Strike Beacon', severity: 1, proto: 'TCP', src: '10.10.0.2:49711', dst: '203.0.113.7:443', count: 2 },
            { sid: 2013028, signature: 'ET POLICY curl User-Agent Outbound', severity: 3, proto: 'TCP', src: '10.10.0.2:49712', dst: '198.51.100.4:80', count: 1 },
          ],
          dns: [{ name: 'c2.evil.example', type: 'A', answers: ['203.0.113.7'], count: 4 }],
          http: [{ host: 'evil.example', method: 'GET', url: '/stage2.bin', status: 200, dst: '198.51.100.4:80', count: 1 }],
          tls: [{ sni: 'c2.evil.example', issuer: 'CN=Fake CA', dst: '203.0.113.7:443', count: 3 }],
        },
      },
    },
  };
}

/** Relatorio gerencial (os numeros do cenario management.mjs). */
async function routeManagement(context) {
  const dur = (n, avgHours, medianHours) => ({ n, avgHours, medianHours });
  await context.route('**/api/management?*', (route) => {
    const url = new URL(route.request().url());
    const data = {
      period: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), tz: url.searchParams.get('tz'), since: '', until: '' },
      received: { total: 42, files: 30, urls: 12 },
      completed: 35,
      timeToComplete: { all: dur(35, 20.5, 9), byPriority: { P1: dur(3, 2.5, 2), P2: dur(5, 8, 7), P3: dur(25, 22, 10), P4: dur(2, 120, 120) } },
      verdicts: { MALICIOUS: 12, SUSPICIOUS: 8, CLEAN: 10, UNKNOWN: 5 },
      techniques: [{ id: 'T1566', name: 'Phishing', count: 9 }, { id: 'T1059.001', name: 'PowerShell', count: 4 }],
      cases: { opened: 4, closed: 3, openNow: 6 },
      workload: [
        { id: 'u2', name: 'Bruno Lima', completed: 20, avgHours: 18.2, reports: 22, reviews: 3 },
        { id: 'u1', name: 'Ana Souza', completed: 15, avgHours: 24, reports: 14, reviews: 9 },
      ],
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

/**
 * As telas: `scrollTo` rola ate o bloco (a tabela de processos dos artefatos, depois das miniaturas
 * de tela, que no mock sao quadros de cor), para a captura mostrar o que importa.
 */
const SCREENS = [
  { name: 'history', path: '/history' },
  { name: 'sample-reports', path: '/entries/e1?tab=relatorios' },
  { name: 'sandbox-artifacts', path: '/entries/e1?tab=analise', scrollTo: '.dl-sandbox-artifacts table' },
  { name: 'case', path: '/casos/cs1' },
  { name: 'management', path: '/gerencial' },
  { name: 'compare', path: '/comparar?a=e1&b=e3' },
];

const browser = await chromium.launch();
for (const lang of ['en', 'pt-BR']) {
  const dir = `${OUT}/readme/${lang}`;
  mkdirSync(dir, { recursive: true });
  for (const screen of SCREENS) {
    const state = createState({ loggedIn: true });
    state.preferences.language = lang;
    seedRecords(state, { now: NOW });
    state.sandboxArtifacts = { 'sb-e1': sandboxArtifacts() };
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: lang === 'en' ? 'en-US' : 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    await context.addInitScript((l) => window.localStorage.setItem('dl-locale', l), lang);
    await setupMock(context, state);
    await installScreenRoutes(context, { now: NOW });
    await routeManagement(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto(ORIGIN + screen.path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (screen.scrollTo) {
      await page.locator(screen.scrollTo).first().evaluate((el) => {
        // Abaixo da topbar e da barra de abas fixas, com a linha que apresenta a tabela.
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 95);
      });
    }
    await page.waitForTimeout(500);
    // Sem rolagem, a captura acaba logo depois do conteudo (lista curta nao deixa meia tela vazia).
    const bottom = screen.scrollTo
      ? 900
      : await page.evaluate(() => Math.max(...[...document.querySelectorAll('.dl-content > *')].map((e) => e.getBoundingClientRect().bottom)));
    const height = Math.round(Math.min(900, Math.max(560, bottom + 16)));
    await page.screenshot({ path: `${dir}/${screen.name}.png`, clip: { x: 0, y: 0, width: 1440, height } });
    console.log(`${lang}/${screen.name}.png`);
    await context.close();
  }
}
await browser.close();
