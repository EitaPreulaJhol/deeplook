// Monitoramento (plans/monitoramento): a aba da Administracao pelo navegador. Ambientes do sandbox
// (encerrar um e todos, com a confirmacao pelo numero), filas (pausar, ver e cancelar trabalhos,
// refazer as falhas), plataforma e os graficos do historico. Confere o que aparece e os pedidos.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
const queue = (id, extra = {}) => ({
  id,
  paused: false,
  ready: 0,
  scheduled: 0,
  running: 0,
  oldestRunningAt: null,
  oldestPendingAt: null,
  done24h: 0,
  failed24h: 0,
  done1m: 0,
  failed1m: 0,
  avgMs: null,
  p95Ms: null,
  service: { level: 'ok', summary: 'livre' },
  ...extra,
});
state.monitor = {
  checkedAt: new Date(now).toISOString(),
  sandbox: {
    enabled: true,
    limit: 4,
    perUserLimit: 2,
    node: { available: false, reason: 'permission', cpu: null, memUsed: null, memTotal: null, diskUsed: null, diskTotal: null },
    orphans: { vms: 1, isos: 0 },
    sessions: [
      {
        id: 'sb1', status: 'RUNNING', phase: 'pronto', vmid: 9001, createdAt: iso(40), startedAt: iso(38), expiresAt: new Date(now + 6 * 60_000).toISOString(),
        entry: { id: 'e1', title: 'instalador_suspeito.exe' }, analyst: { id: 'u2', displayName: 'Bruno Lima' }, analystAtLimit: true,
        vm: { status: 'running', cpu: 0.42, cpus: 4, mem: 3_221_225_472, maxmem: 6_442_450_944, netin: 1000, netout: 2000 },
      },
      {
        id: 'sb2', status: 'RUNNING', phase: 'pronto', vmid: 9002, createdAt: iso(10), startedAt: iso(9), expiresAt: new Date(now + 50 * 60_000).toISOString(),
        entry: { id: 'e2', title: 'boleto.exe' }, analyst: { id: 'u2', displayName: 'Bruno Lima' }, analystAtLimit: true,
        vm: { status: 'running', cpu: 0.05, cpus: 4, mem: 2_147_483_648, maxmem: 6_442_450_944, netin: 10, netout: 20 },
      },
    ],
  },
  queues: [
    queue('capa', { ready: 3, scheduled: 1, running: 2, oldestRunningAt: iso(7), done24h: 41, failed24h: 2, avgMs: 48_000, p95Ms: 410_000 }),
    queue('ghidra', { paused: true, ready: 5, done24h: 6, avgMs: 220_000, p95Ms: 840_000 }),
    queue('unpack', { done24h: 12, avgMs: 3_200, p95Ms: 9_800 }),
    queue('oletools', { done24h: 30, avgMs: 2_100, p95Ms: 6_000 }),
    queue('qr', { done24h: 18, avgMs: 900, p95Ms: 2_000 }),
    queue('emulation', { service: { level: 'off', summary: 'desligado (EMULATE_URL vazio)' } }),
    queue('android', { service: { level: 'off', summary: 'desligado (ANDROID_URL vazio)' } }),
    queue('config', { done24h: 3, avgMs: 15_000, p95Ms: 20_000 }),
    queue('dotnet', { failed24h: 1, service: { level: 'error', summary: 'conexão recusada' } }),
    queue('suricata', { done24h: 4, avgMs: 11_000, p95Ms: 14_000 }),
    queue('memdump', {}),
  ],
  platform: {
    uptimeS: 3 * 3600 + 12 * 60, rss: 402_653_184, heapUsed: 180_355_072, heapTotal: 240_123_904,
    loop: { p50: 11, p99: 38 }, workerRestarts: 0, sigmaRetro: { current: null, queued: 0 }, yaraRetroscans: 1,
    dbBytes: 1_288_490_188, storage: { bytes: 52_613_349_376, objects: 18_420, partial: false, at: iso(5) },
  },
};
// 24 h em intervalos de 15 min: ambientes, fila, memoria da API e falhas.
const buckets = Array.from({ length: 96 }, (_, i) => now - (95 - i) * 15 * 60_000);
const wave = (i, base, amp, period) => Math.max(0, Math.round((base + amp * Math.sin(i / period)) * 10) / 10);
state.monitorHistory = {
  range: '24h',
  since: new Date(now - 24 * 3_600_000).toISOString(),
  bucketMs: 15 * 60_000,
  series: {
    'sandbox.active': buckets.map((t, i) => [t, Math.round(wave(i, 2, 2, 9))]),
    'queue.capa': buckets.map((t, i) => [t, wave(i, 3, 3, 7)]),
    'queue.ghidra': buckets.map((t, i) => [t, i > 80 ? 5 : wave(i, 1, 1, 5)]),
    'jobs.running': buckets.map((t, i) => [t, wave(i, 2, 1.5, 6)]),
    'jobs.done': buckets.map((t, i) => [t, Math.round(wave(i, 5, 4, 8))]),
    'jobs.failed': buckets.map((t, i) => [t, i % 23 === 0 ? 2 : 0]),
    'api.rss': buckets.map((t, i) => [t, (360 + 30 * Math.sin(i / 10)) * 1024 * 1024]),
    'api.loopP99': buckets.map((t, i) => [t, wave(i, 25, 12, 4)]),
  },
  durations: {
    capa: [
      { day: new Date(now - 86_400_000).toISOString().slice(0, 10), n: 38, avgMs: 51_000, p95Ms: 380_000 },
      { day: new Date(now).toISOString().slice(0, 10), n: 41, avgMs: 48_000, p95Ms: 410_000 },
    ],
  },
};
state.monitorJobs = {
  'ghidra:pending': {
    queue: 'ghidra', state: 'pending', page: 1, total: 2,
    jobs: [
      { id: 'j1', state: 'PENDING', attempts: 0, createdAt: iso(30), startedAt: null, finishedAt: null, error: null, entryId: 'e1', entryTitle: 'instalador_suspeito.exe' },
      { id: 'j2', state: 'PENDING', attempts: 1, createdAt: iso(12), startedAt: null, finishedAt: null, error: null, entryId: 'e2', entryTitle: 'boleto.exe' },
    ],
  },
  'ghidra:failed': {
    queue: 'ghidra', state: 'failed', page: 1, total: 1,
    jobs: [{ id: 'j3', state: 'FAILED', attempts: 1, createdAt: iso(90), startedAt: iso(80), finishedAt: iso(70), error: 'cancelado pela administração', entryId: 'e1', entryTitle: 'instalador_suspeito.exe' }],
  },
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const requests = (kind) => (state.monitorRequests ?? []).filter((r) => r.kind === kind);

await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('.hpsm-tree a:has-text("Monitoramento")');
await settle(800);
expect('navegador abre a aba', new URL(page.url()).search === '?tab=monitor');
const text = await page.locator('.hpsm-tabpanel').innerText();
expect('uso e limite por analista', text.includes('2 de 4 ambiente(s) em uso · até 2 por analista'));
expect('nó sem permissão explicado', text.includes('sem permissão para ler o nó'));
expect('órfãs com o botão de limpar', text.includes('VMs órfãs desta instalação: 1') && (await page.locator('button:has-text("Limpar agora")').count()) === 1);
const sessionRow = page.locator('tbody tr:has-text("instalador_suspeito.exe")').first();
const sessionText = (await sessionRow.innerText()).replace(/\s+/g, ' ');
expect('ambiente: analista no limite, VM e expiração perto do fim', sessionText.includes('no limite') && sessionText.includes('CPU 42%') && /em [56] min/.test(sessionText), sessionText);
expect('expiração perto do fim em laranja', (await sessionRow.locator('.hpsm-status--orange').count()) >= 2);
await page.screenshot({ path: `${OUT}/monitor-sandbox.png`, fullPage: false });

// Encerrar um: pede o motivo e manda o id.
await sessionRow.locator('button:has-text("Encerrar")').click();
await page.locator('[role=dialog] input, [role=alertdialog] input').fill('manutenção do Proxmox');
await page.locator('[role=dialog] button:has-text("Encerrar"), [role=alertdialog] button:has-text("Encerrar")').last().click();
await settle();
const stop1 = requests('sandbox/stop')[0];
expect('encerrar um: id e motivo', stop1?.body.ids?.join() === 'sb1' && stop1.body.reason === 'manutenção do Proxmox', JSON.stringify(stop1));
expect('aviso de sucesso', (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('1 ambiente(s) encerrado(s).')));

// Encerrar todos: numero errado nao manda nada.
await page.click('button:has-text("Encerrar todos")');
await page.locator('[role=dialog] input, [role=alertdialog] input').fill('3');
await page.locator('[role=dialog] button:has-text("Encerrar todos"), [role=alertdialog] button:has-text("Encerrar todos")').last().click();
await settle();
expect('número errado: nada encerrado', requests('sandbox/stop').length === 1 && (await page.locator('.hpsm-msg__text').allTextContents()).some((t) => t.includes('não confere')));
await page.click('button:has-text("Encerrar todos")');
await page.locator('[role=dialog] input, [role=alertdialog] input').fill('2');
await page.locator('[role=dialog] button:has-text("Encerrar todos"), [role=alertdialog] button:has-text("Encerrar todos")').last().click();
// O segundo dialogo (motivo) abre depois do primeiro: espera o campo dele, vazio.
await page.waitForSelector('label:has-text("Motivo (opcional)")');
expect('motivo abre vazio', (await page.locator('[role=dialog] input, [role=alertdialog] input').inputValue()) === '');
await page.locator('[role=dialog] button:text-is("Encerrar"), [role=alertdialog] button:text-is("Encerrar")').click();
await settle();
const stopAll = requests('sandbox/stop')[1]?.body;
// O motivo abre vazio: nao herda o numero digitado na confirmacao anterior.
expect('encerrar todos: all, sem motivo herdado', stopAll?.all === true && !('reason' in stopAll), JSON.stringify(stopAll));

// Filas: a pausada em destaque, falhas em laranja, servico desligado em cinza.
const ghidraRow = page.locator('tbody tr:has(td strong:text-is("Ghidra"))');
expect('fila pausada: situação e botão Retomar', (await ghidraRow.innerText()).includes('Pausada') && (await ghidraRow.locator('button:has-text("Retomar")').count()) === 1);
const capaRow = (await page.locator('tbody tr:has(td strong:text-is("capa e FLOSS"))').innerText()).replace(/\s+/g, ' ');
expect('capa: agendadas, há quanto tempo, médio · p95', capaRow.includes('+1 agendada(s)') && capaRow.includes('há 7 min') && capaRow.includes('48 s · 6 min'), capaRow);
await page.locator('tbody tr:has(td strong:text-is("capa e FLOSS")) button:has-text("Pausar")').click();
await settle();
expect('pausar manda paused', requests('queues/capa').at(-1)?.body.paused === true);

// Trabalhos da fila: cancelar um pendente, refazer as falhas.
await ghidraRow.locator('button:has-text("Trabalhos")').click();
await settle();
expect('trabalhos pendentes listados', (await page.locator('.dl-monitor__jobs tbody tr').count()) === 2);
await page.locator('.dl-monitor__jobs tbody tr:has-text("boleto.exe") button:has-text("Cancelar")').click();
await page.locator('[role=alertdialog] button, [role=dialog] button').filter({ hasText: /Confirmar|OK|Sim|Cancelar análise/ }).last().click().catch(() => undefined);
await settle();
const cancel = requests('queues/ghidra/cancel')[0];
expect('cancelar o pendente pelo id', cancel?.body.ids?.join() === 'j2', JSON.stringify(state.monitorRequests));
await page.selectOption('#mon-jobs-state', 'failed');
await settle();
expect('falhas com o motivo', (await page.locator('.dl-monitor__jobs').innerText()).includes('cancelado pela administração'));
await page.click('button:has-text("Refazer as falhas das últimas 24 h")');
await settle();
expect('refazer as falhas de 24 h', requests('queues/ghidra/retry')[0]?.body.failedSinceHours === 24);
await page.screenshot({ path: `${OUT}/monitor-filas.png`, fullPage: true });

// Plataforma e historico.
const platform = await page.locator('.dl-monitor__platform').innerText();
expect('plataforma: memória, event loop e armazenamento', platform.includes('p50 11 ms · p99 38 ms') && platform.includes('49.0 GB') && platform.includes('18420'), platform);
expect('gráficos do histórico', (await page.locator('.dl-monchart svg').count()) >= 7);
expect('linha do limite no gráfico de ambientes', (await page.locator('.dl-monchart__ref').count()) === 1);
const chart = page.locator('.dl-monchart svg').first();
const box = await chart.boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
await settle(200);
expect('tooltip ao passar o mouse', (await page.locator('.dl-monchart .dl-chart__tooltip').count()) === 1);
expect('tempo por dia na tabela', (await page.locator('table[aria-label="Tempo das análises por dia"] tbody tr').count()) === 2);
await page.locator('section:has-text("Histórico")').last().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/monitor-historico.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nmonitoramento: tudo ok');
process.exit(failures ? 1 : 0);
