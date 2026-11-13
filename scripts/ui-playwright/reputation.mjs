// Reputacao externa (35): secao da ficha com o indicador consultado, um
// resultado por servico (cores, resumo, link externo), resumo no topo,
// atualizacao automatica enquanto consulta, "Consultar de novo" so para
// analistas, secao escondida sem servico configurado.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const services = [
  { id: 'virustotal', name: 'VirusTotal' },
  { id: 'malwarebazaar', name: 'MalwareBazaar' },
  { id: 'urlhaus', name: 'URLhaus' },
  { id: 'threatfox', name: 'ThreatFox' },
  { id: 'abuseipdb', name: 'AbuseIPDB' },
];
const at = '2026-10-22T15:00:00.000Z';
const row = (service, name, status, verdict, summary, link = null) => ({ service, name, kind: 'HASH', indicator: 'aa11', status, verdict, summary, link, checkedAt: at });
const done = {
  services,
  indicator: { kind: 'HASH', value: 'aa11' },
  pending: false,
  results: [
    row('virustotal', 'VirusTotal', 'FOUND', 'MALICIOUS', '40/70 motores detectaram · trojan.emotet', 'https://www.virustotal.com/gui/file/aa11'),
    row('malwarebazaar', 'MalwareBazaar', 'FOUND', 'MALICIOUS', 'Emotet · exe · visto em 2026-10-01', 'https://bazaar.abuse.ch/sample/aa11/'),
    row('threatfox', 'ThreatFox', 'NOT_FOUND', 'UNKNOWN', 'não encontrado na base'),
  ],
};
// e3: a consulta do envio ainda roda no primeiro GET e termina no segundo.
state.reputation.e3 = [
  { ...done, pending: true, results: [{ ...done.results[0], status: 'PENDING', verdict: 'UNKNOWN', summary: 'consultando...' }] },
  done,
];
state.reputation.e2 = {
  services,
  indicator: { kind: 'DOMAIN', value: 'banco-seguro-login.example' },
  pending: false,
  results: [
    { ...row('virustotal', 'VirusTotal', 'FOUND', 'CLEAN', '0/70 motores detectaram'), kind: 'DOMAIN' },
    { ...row('urlhaus', 'URLhaus', 'ERROR', 'UNKNOWN', 'chave recusada pelo serviço'), kind: 'DOMAIN' },
    { ...row('threatfox', 'ThreatFox', 'NOT_FOUND', 'UNKNOWN', 'não encontrado na base'), kind: 'DOMAIN' },
  ],
};
// e4: enriquecimento de links (revisao 3.3): registro novo vira suspeito, o resto e informativo.
state.reputation.e4 = {
  services: [...services, { id: 'rdap', name: 'Registro (RDAP)' }, { id: 'crtsh', name: 'Certificados (crt.sh)' }, { id: 'vtdns', name: 'DNS passivo (VirusTotal)' }],
  indicator: { kind: 'DOMAIN', value: 'login.novo.top' },
  pending: false,
  results: [
    { ...row('virustotal', 'VirusTotal', 'FOUND', 'CLEAN', '0/70 motores detectaram'), kind: 'DOMAIN' },
    { ...row('rdap', 'Registro (RDAP)', 'FOUND', 'SUSPICIOUS', 'domínio novo: novo.top registrado em 2026-10-19 (há 3 dias)'), kind: 'DOMAIN' },
    { ...row('crtsh', 'Certificados (crt.sh)', 'FOUND', 'UNKNOWN', '4 certificados, o primeiro em 2025-01-02 (há 658 dias), o último em 2026-10-01', 'https://crt.sh/?q=login.novo.top'), kind: 'DOMAIN' },
    { ...row('vtdns', 'DNS passivo (VirusTotal)', 'FOUND', 'UNKNOWN', 'apontou para: 203.0.113.9 (último visto em 2026-10-21)'), kind: 'DOMAIN' },
  ],
};
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 500) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Reputação externa"))');
const summaryText = async () => (await page.locator('.dl-summary').innerText()).replace(/\s+/g, ' ');
const rows = async () =>
  Promise.all((await section.locator('tbody tr').all()).map(async (r) => (await r.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())));

// 1. Consulta em andamento e atualizacao automatica.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('topo e seção dividem a mesma consulta', state.reputationGets === 1, state.reputationGets);
expect('topo: consultando', (await summaryText()).includes('Reputação: consultando...'), await summaryText());
expect('linha consultando', (await rows())[0]?.[1] === 'Consultando...');
await page.waitForFunction(() => document.querySelector('.dl-summary')?.textContent?.includes('malicioso em'), null, { timeout: 8000 });
expect('atualiza sozinha ao terminar', state.reputationGets >= 2);
expect('topo: malicioso em 2 de 3', (await summaryText()).includes('Reputação: malicioso em 2 de 3 serviços'), await summaryText());
const note = (await section.locator('.dl-reputation__note').innerText()).replace(/\s+/g, ' ');
expect('nota do indicador e do que não sai', note.startsWith('Consultado: SHA-256 aa11. Só o indicador sai do DeepLook; o arquivo e a URL completa não são enviados.'), note);
const r = await rows();
expect('três serviços na ordem', r.map((x) => x[0]).join('|') === 'VirusTotal|MalwareBazaar|ThreatFox');
expect('resultado e resumo', r[0][1] === 'Malicioso' && r[0][2] === '40/70 motores detectaram · trojan.emotet' && r[2][1] === 'Não encontrado', r.map((x) => x.join(' / ')).join(' || '));
expect('malicioso em vermelho', (await section.locator('tbody tr').first().locator('.hpsm-status--red').count()) === 1);
const linkEl = section.locator('a:has-text("Abrir no VirusTotal")');
expect('link externo seguro', (await linkEl.getAttribute('href')) === 'https://www.virustotal.com/gui/file/aa11' && (await linkEl.getAttribute('target')) === '_blank' && (await linkEl.getAttribute('rel')) === 'noopener noreferrer');
expect('sem link: travessão', r[2][4] === '—');
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/reputacao.png`, fullPage: true });

// 2. Consultar de novo (analista).
await section.locator('button:has-text("Consultar de novo")').click();
await settle();
expect('POST de nova consulta', state.calls.includes('POST /api/entries/e3/reputation'));

// 3. Link: dominio, falha e sem alertas.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('topo: sem alertas, com a falha', (await summaryText()).includes('Reputação: sem alertas (2 serviços · 1 com falha)'), await summaryText());
const r2 = await rows();
expect('falha com o motivo', r2[1][1] === 'Falha' && r2[1][2] === 'chave recusada pelo serviço', r2[1].join(' / '));
expect('domínio na nota', (await section.locator('.dl-reputation__note').innerText()).includes('Domínio banco-seguro-login.example'));

// 4. Usuario comum: sem "Consultar de novo".
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('usuário vê o resultado sem o botão', (await section.count()) === 1 && (await section.locator('button:has-text("Consultar de novo")').count()) === 0);
state.role = undefined;

// 5. Sem servico configurado: nada aparece.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('sem serviços: sem seção nem resumo', (await section.count()) === 0 && !(await summaryText()).includes('Reputação'));

// 6. Enriquecimento de links: rotulos e o resumo do topo.
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
const r4 = await rows();
expect('linhas do enriquecimento na ordem', r4.map((x) => x[0]).join('|') === 'VirusTotal|Registro (RDAP)|Certificados (crt.sh)|DNS passivo (VirusTotal)', r4.map((x) => x[0]).join('|'));
expect('domínio novo: suspeito', r4[1][1] === 'Suspeito', r4[1].join(' / '));
expect('certificados e DNS passivo: informativo', r4[2][1] === 'Informativo' && r4[3][1] === 'Informativo', `${r4[2][1]} / ${r4[3][1]}`);
expect('topo: suspeito em 1 de 4', (await summaryText()).includes('Reputação: suspeito em 1 de 4 serviços'), await summaryText());

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nreputação externa: tudo ok');
process.exit(failures ? 1 : 0);
