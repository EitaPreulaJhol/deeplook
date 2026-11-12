// Pontuacao de risco (item 7.5): secao da ficha, so para analistas, com a nota, a sugestao de
// veredito, os motivos com o peso de cada um, o aviso de analise em andamento (e a atualizacao
// sozinha quando termina) e o texto de "nenhum sinal" que nao promete seguranca.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const reasons = [
  { source: 'Antivírus', text: 'o ClamAV detectou Win.Trojan.Agent-1', weight: 60 },
  { source: 'YARA', text: '1 conjunto(s) de regras casaram: Emotet', weight: 35 },
  { source: 'Assinatura', text: 'assinatura digital válida', weight: -15 },
];
// e3: a analise de funcoes ainda roda no primeiro GET e termina no segundo, subindo a nota.
state.risk = {
  e3: [
    { score: 45, level: 'medium', suggestedVerdict: 'SUSPICIOUS', reasons: [reasons[0], reasons[2]], pending: ['análise de funções'] },
    { score: 80, level: 'high', suggestedVerdict: 'MALICIOUS', reasons, pending: [] },
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
const section = page.locator('.hpsm-section:has(.hpsm-section__head:has-text("Pontuação de risco"))');
const text = async () => (await section.innerText()).replace(/\s+/g, ' ');
const rows = async () =>
  Promise.all((await section.locator('tbody tr').all()).map(async (r) => (await r.locator('td').allInnerTexts()).map((t) => t.trim())));

// 1. Em andamento: nota parcial, aviso, e a tela busca de novo sozinha.
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('nota e nível', (await text()).includes('45 de 100 · Médio'), await text());
expect('sugestão deixa claro que o veredito é do analista', (await text()).includes('Suspeito (sugestão; o veredito é seu)'), await text());
expect('aviso de análise em andamento', (await text()).includes('Ainda em andamento: análise de funções. A nota pode subir quando terminar.'));
await page.waitForFunction(() => document.body.textContent?.includes('80 de 100'), null, { timeout: 12000 });
expect('atualiza sozinha: nota final e nível alto', (await text()).includes('80 de 100 · Alto') && (await text()).includes('Malicioso (sugestão'), await text());
expect('aviso some quando termina', !(await text()).includes('Ainda em andamento'));
expect('nível alto em vermelho', (await section.locator('.hpsm-status--red').count()) === 1);

// 2. Motivos, do mais pesado ao atenuante, com o sinal.
const r = await rows();
expect('três motivos na ordem da API', r.map((x) => x[1]).join('|') === 'Antivírus|YARA|Assinatura', r.map((x) => x.join(' / ')).join(' || '));
expect('pesos com sinal', r[0][0] === '+60' && r[1][0] === '+35' && r[2][0] === '−15', r.map((x) => x[0]).join(' '));
expect('motivo traz o que foi encontrado', r[0][2] === 'o ClamAV detectou Win.Trojan.Agent-1');
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/risco.png`, fullPage: true });

// 3. Sem sinal nenhum: nao promete que e segura.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('sem sinais: nota 0 e sem sugestão', (await text()).includes('0 de 100 · Baixo') && (await text()).includes('Sem sugestão'), await text());
expect('sem sinais: avisa que não quer dizer segura', (await text()).includes('Isso não quer dizer que a amostra é segura'));
expect('sem sinais: sem tabela', (await section.locator('table').count()) === 0);

// 4. Usuario comum: a secao nem aparece (e a API nem e consultada).
state.role = 'USER';
const before = state.riskGets;
await page.goto(ORIGIN + '/entries/e3', { waitUntil: 'networkidle' });
expect('usuário comum não vê a pontuação', (await section.count()) === 0);
expect('usuário comum não consulta a rota', before > 0 && state.riskGets === before, `${before} -> ${state.riskGets}`);
state.role = undefined;

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\npontuação de risco: tudo ok');
process.exit(failures ? 1 : 0);
