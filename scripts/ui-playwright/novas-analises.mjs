// Novas analises (plans/novas-analises): na ficha, as secoes de emulacao, configuracao extraida e
// APK; no ambiente isolado, as deteccoes Sigma, a memoria dos processos da amostra e o diff entre
// execucoes; nos relatorios, o rascunho por IA. Confere o que aparece, os filtros e os pedidos.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const t = (min) => new Date(Date.UTC(2026, 10, 12, 15, min)).toISOString();
const done = (result, alerts, iocs = [], version = 'v') => ({
  status: 'DONE',
  options: null,
  result,
  alerts,
  iocs,
  error: null,
  version,
  ms: 1200,
  attempts: 1,
  createdAt: t(0),
  startedAt: t(0),
  finishedAt: t(1),
});
state.serviceAnalyses = {
  e1: {
    emulation: {
      enabled: true,
      auto: true,
      manual: true,
      maxMb: 32,
      analysis: done(
        {
          kind: 'pe',
          arch: 'x86',
          filetype: 'exe',
          runtimeS: 0.4,
          apiTotal: 21,
          apis: [
            { name: 'KERNEL32.IsDebuggerPresent', count: 1, order: 0, args: [], ret: '0x0' },
            { name: 'WININET.InternetOpenUrlA', count: 1, order: 1, args: ['0xcc0', 'http://deeplook-emulado.top/stage2.bin'], ret: '0xcc4' },
            { name: 'KERNEL32.CreateRemoteThread', count: 1, order: 2, args: ['0x220', '0x0', '0x0', '0x50000'], ret: '0x230' },
          ],
          entryPoints: [{ type: 'module_entry', start: '0x4013f0', apis: 20, error: null }],
          files: [{ event: 'write', path: 'C:\\Users\\Public\\stage2.exe' }],
          registry: [],
          network: { dns: [], traffic: [{ server: 'deeplook-emulado.top', port: 80, proto: 'tcp.http', method: null, url: null }] },
          processes: [
            { event: 'create', pid: 1140, path: 'cmd.exe', cmdline: 'cmd.exe /c whoami', protect: null, size: null },
            { event: 'thread_inject', pid: 1140, path: 'cmd.exe', cmdline: null, protect: null, size: null },
          ],
          dropped: [{ path: 'C:\\Users\\Public\\stage2.exe', size: 8, sha256: '9335348808c9f6a81426b67eec4c22700ea67df06e079d08fc0a09302e39ce40' }],
          dynamicCode: 1,
          strings: [],
          errors: [],
        },
        [
          { level: 'high', text: 'Injeta código em outro processo (cmd.exe).' },
          { level: 'high', text: 'Contata a rede e abre outro programa: deeplook-emulado.top → cmd.exe /c whoami' },
          { level: 'medium', text: 'Checa se está sendo depurado.' },
        ],
        ['deeplook-emulado.top'],
        'speakeasy 1.5.11',
      ),
    },
    config: {
      enabled: true,
      auto: true,
      manual: true,
      maxMb: 64,
      analysis: done(
        {
          parsers: 64,
          matches: [{ rule: 'Remcos', family: 'Remcos' }],
          configs: [{ family: 'Remcos', config: { CNCs: ['deeplook-c2.top:2404'], 'Botnet': 'RemoteHost', Mutex: 'Rmc-ABC123', Keys: { rc4: '0xa1b2' } } }],
          errors: [],
        },
        [{ level: 'high', text: 'Configuração de Remcos extraída (família identificada).' }],
        ['deeplook-c2.top'],
        'CAPE-parsers 0.1.73 (regras 25ed598ca1fb)',
      ),
    },
  },
};
state.sandboxes.e1 = runningSandbox('e1', 40);
state.sandboxArtifacts = {
  'sb-e1': { status: 'RUNNING', note: null, intervalS: 60, screenshots: [], processes: { at: t(11), firstAt: t(0), lists: 12, current: [], appeared: [] }, sysmon: { at: t(11), available: true, events: 30, truncated: false, processes: [], network: [], dns: [], files: [], registry: [] } },
};
const hit = (title, level, sample, image, pid, techniques = []) => ({
  ruleId: title,
  title,
  level,
  techniques,
  image,
  pid,
  sample,
  eventId: 1,
  event: { Image: image, CommandLine: `${image} /x`, ProcessId: String(pid) },
  count: 1,
  firstAt: t(2),
  lastAt: t(2),
  description: 'Detecta a modificação de chaves de inicialização.',
  author: 'SigmaHQ',
  falsepositives: ['Instaladores legítimos'],
  references: [],
  url: 'https://github.com/SigmaHQ/sigma/blob/r2026-07-01/rules/windows/x.yml',
});
state.sandboxSigma = {
  'sb-e1': {
    rules: { name: 'SigmaHQ (sigma_core+)', release: 'r2026-07-01', license: 'DRL 1.1', url: 'https://github.com/SigmaHQ/sigma', count: 1637 },
    sample: { name: 'fatura.exe', found: true },
    pending: 0,
    hits: [
      hit('CurrentVersion Autorun Keys Modification', 'medium', true, 'D:\\fatura.exe', 4410, ['T1547.001']),
      hit('Enumerate All Information With Whoami.EXE', 'medium', true, 'C:\\Windows\\System32\\whoami.exe', 4600, ['T1033']),
      hit('Suspicious Encoded PowerShell Command Line', 'high', false, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 900, ['T1059.001']),
    ],
  },
};
state.sandboxMemory = {
  'sb-e1': {
    enabled: true,
    analysis: true,
    running: true,
    scheduledAt: null,
    requested: true,
    dumps: [
      {
        id: 'd1',
        pid: 4410,
        image: 'D:\\fatura.exe',
        status: 'DONE',
        size: 11630297,
        storedSize: 4228634,
        sha256: 'ab'.repeat(32),
        error: null,
        result: {
          modules: 12,
          regionsTotal: 128,
          privateScanned: 40,
          privateExecutable: 1,
          regions: [{ base: '0x2ea7f3e0000', size: 45056, protect: 'RWX', kind: 'pe', entropy: 3.1, head: '4d5a90000300000004000000ffff0000', sha256: 'cd'.repeat(32), carved: '34'.repeat(32) }],
          urls: ['http://deeplook-realcheck.top/beacon'],
        },
        children: [{ entryId: 'e2', sha256: '34'.repeat(32), base: '0x2ea7f3e0000' }],
        createdAt: t(3),
        storedAt: t(4),
        finishedAt: t(5),
      },
    ],
  },
};
state.sandboxRuns = {
  e1: [
    { ...runningSandbox('e1', 40), autoRun: 'DONE', autoRunAt: t(1), autoRunUser: 'SANDBOX\\analista', autoRunSysmon: true, autoRunError: null, startedAt: t(0), analyst: { id: 'u1', displayName: 'Ana Souza' } },
    { ...runningSandbox('e1', 0), id: 'sb-e1-old', status: 'STOPPED', autoRun: 'DONE', autoRunAt: t(-50), autoRunUser: 'SANDBOX\\analista', autoRunSysmon: true, autoRunError: null, startedAt: t(-60), analyst: { id: 'u2', displayName: 'Bruno Lima' } },
  ],
};
const cat = (onlyA, onlyB, both) => ({
  onlyA: onlyA.map((x) => ({ key: x, example: x, count: 1 })),
  onlyB: onlyB.map((x) => ({ key: x, example: x, count: 1 })),
  both: both.map((x) => ({ key: x, exampleA: x, exampleB: x })),
  counts: { onlyA: onlyA.length, onlyB: onlyB.length, both: both.length },
});
state.sandboxCompare = {
  'sb-e1-old:sb-e1': {
    a: { id: 'sb-e1-old', startedAt: t(-60), stoppedAt: t(-30) },
    b: { id: 'sb-e1', startedAt: t(0), stoppedAt: null },
    scope: 'sample',
    sample: { name: 'fatura.exe', foundA: true, foundB: true },
    categories: {
      process: cat([], ['cmd.exe /c whoami /all'], ['"D:\\fatura.exe" /silent']),
      dns: cat(['c2.evil.example'], [], []),
      network: cat([], [], []),
      file: cat([], [], ['C:\\Users\\a\\AppData\\Local\\Temp\\tmp1A2B.tmp']),
      registry: cat([], [], ['HKU\\S-1-5-21-1-2-3-1001\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Upd = x']),
      sigma: cat([], ['Enumerate All Information With Whoami.EXE (medium)'], []),
      ids: cat(['ET MALWARE Teste'], [], []),
    },
  },
};
state.aiStatus = { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', destination: 'https://api.anthropic.com', dailyLimit: 30 };
state.aiDraft = {
  draft: {
    summary: 'Executável que baixa um segundo estágio e grava na chave Run.',
    findings: '- Sigma: chave Run\n- Emulação: injeta em cmd.exe',
    iocs: ['deeplook-c2.top'],
    verdict: 'MALICIOUS',
    attackTechniques: ['T1547.001'],
  },
  dropped: ['T9999'],
  model: 'claude-opus-5-5',
  provider: 'anthropic',
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);
const settle = (ms = 600) => page.waitForTimeout(ms);
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

// 1. Ficha: emulacao e configuracao (o APK nao aparece: a amostra nao e APK nem foi pedida).
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await settle();
const text = await page.locator('main').innerText();
expect('seção da emulação com o alerta de injeção', text.includes('Emulação (Speakeasy)') && text.includes('Injeta código em outro processo'));
expect('chamadas de API em ordem', text.indexOf('IsDebuggerPresent') < text.indexOf('CreateRemoteThread'));
expect('seção da configuração com o C2', text.includes('Configuração extraída (CAPE)') && text.includes('CNCs: deeplook-c2.top:2404'));
expect('sem a seção do APK', !text.includes('Android (APK)'));
expect('botão do shellcode para analistas', await page.getByRole('button', { name: 'Emular como shellcode' }).isVisible());
await page.locator('section, .hpsm-section').filter({ hasText: 'Emulação (Speakeasy)' }).first().screenshot({ path: `${OUT}/novas-emulacao.png` }).catch(() => undefined);
await page.screenshot({ path: `${OUT}/novas-ficha.png`, fullPage: true });
await page.getByRole('button', { name: 'Emular como shellcode' }).click();
await settle(300);
expect('pedido de shellcode com a arquitetura', state.serviceRequests?.[0]?.body?.kind === 'shellcode' && state.serviceRequests[0].body.arch === 'x86', JSON.stringify(state.serviceRequests));

// 2. Ambiente isolado: Sigma, memoria e o diff entre execucoes.
await page.goto(ORIGIN + '/entries/e1?tab=analise', { waitUntil: 'networkidle' });
await settle();
const sigma = page.locator('.dl-sigma');
const sigmaText = await sigma.innerText();
expect('Sigma: só a amostra por padrão', sigmaText.includes('CurrentVersion Autorun') && !sigmaText.includes('Suspicious Encoded PowerShell'), sigmaText.slice(0, 200));
await sigma.getByLabel('Tudo (inclusive o Windows)').check();
expect('Sigma: "Tudo" mostra o resto do Windows', (await sigma.innerText()).includes('Suspicious Encoded PowerShell'));
await sigma.getByRole('button', { name: 'CurrentVersion Autorun Keys Modification' }).click();
expect('Sigma: o evento ao abrir a linha', (await sigma.innerText()).includes('Falsos positivos conhecidos'));
await sigma.screenshot({ path: `${OUT}/novas-sigma.png` });
const memory = page.locator('.dl-memory');
const memText = await memory.innerText();
expect('memória: dump, região e amostra filha', memText.includes('fatura.exe') && memText.includes('PE fora de imagem') && memText.includes('amostra filha'), memText.slice(0, 300));
await memory.getByRole('button', { name: 'Capturar memória agora' }).click();
await settle(300);
expect('memória: pedido de captura', state.memoryRequests?.[0] === 'sb-e1');
await memory.screenshot({ path: `${OUT}/novas-memoria.png` });
const compare = page.locator('.dl-runcompare');
await compare.locator('summary').click();
await settle();
const cmpText = await compare.innerText();
expect('diff: diferenças e o que só uma execução fez', cmpText.includes('diferença(s)') && cmpText.includes('cmd.exe /c whoami /all') && cmpText.includes('c2.evil.example'), cmpText.slice(0, 300));
await compare.screenshot({ path: `${OUT}/novas-diff.png` });

// 3. Relatorios: o rascunho por IA preenche o formulario com o aviso.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await settle();
await page.getByRole('button', { name: 'Rascunho por IA' }).click();
await settle();
expect('rascunho preenche o resumo', (await page.locator('#report-summary').inputValue()).startsWith('Executável que baixa'));
const reportsText = await page.locator('main').innerText();
expect('aviso de texto gerado e técnica descartada', reportsText.includes('Texto gerado por IA (claude-opus-5-5)') && reportsText.includes('T9999'));
await page.screenshot({ path: `${OUT}/novas-rascunho.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo');
process.exit(failures ? 1 : 0);
