// Eficacia das regras (plano pos-revisao, item 2.3): nas listas de regras YARA e de triagem, em
// quantas amostras cada regra disparou em 90 dias e quantas terminaram limpas, com ordenacao, o
// destaque da regra ruidosa e o filtro das que nao dispararam.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const now = '2026-11-01T10:00:00.000Z';
const yara = (id, name, fired, clean) => ({
  id,
  name,
  description: null,
  source: `rule ${name} { condition: true }`,
  enabled: true,
  pack: null,
  createdAt: now,
  updatedAt: now,
  createdBy: null,
  updatedBy: null,
  effectiveness: { fired, clean },
});
state.yaraRules = [
  yara('y1', 'Emotet', 12, 0),
  yara('y2', 'Ruidosa', 10, 8),
  yara('y3', 'Nunca', 0, 0),
  yara('y4', 'Pouca', 2, 2),
];
await setupMock(context, state);
const triage = [
  { id: 't1', name: 'Macro', condition: 'MACRO', value: null, tags: ['macro'], priority: null, enabled: true, label: 'Documento com macro', createdBy: null, effectiveness: { fired: 4, clean: 1 } },
  { id: 't2', name: 'Parada', condition: 'MACRO', value: null, tags: ['x'], priority: null, enabled: true, label: 'Documento com macro', createdBy: null, effectiveness: { fired: 0, clean: 0 } },
];
await context.route(
  (url) => url.pathname === '/api/triage-rules',
  (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { rules: triage, effectivenessDays: 90 } })
      : route.fallback(),
);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const table = (label) => page.locator(`table[aria-label="${label}"]`);
const column = async (label, index) =>
  (await table(label).locator(`tbody tr td:nth-child(${index})`).allInnerTexts()).map((t) => t.trim());
const headers = async (label) =>
  (await table(label).locator('thead th').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, '').trim());

// 1. Regras YARA da equipe.
await page.goto(ORIGIN + '/yara', { waitUntil: 'networkidle' });
const yaraTable = 'Regras YARA';
const head = await headers(yaraTable);
expect('colunas de eficácia', head.includes('Disparos (90 dias)') && head.includes('% em limpas'), head.join(' | '));
const names = () => column(yaraTable, 1);
const at = head.indexOf('Disparos (90 dias)') + 1;
expect('disparos e porcentagem', (await column(yaraTable, at)).join() === '12,0,2,10', (await column(yaraTable, at)).join());
const shares = await column(yaraTable, at + 1);
expect('porcentagem em limpas, e "—" sem disparo', shares.join('|') === '0%|—|100%|80%', shares.join('|'));
const noisy = table(yaraTable).locator('tbody tr', { hasText: 'Ruidosa' }).locator('[title*="talvez precise de ajuste"]');
expect('regra ruidosa em destaque (80% em 10 disparos)', (await noisy.count()) === 1);
const few = table(yaraTable).locator('tbody tr', { hasText: 'Pouca' }).locator('[title*="talvez precise de ajuste"]');
expect('com só 2 disparos, sem destaque', (await few.count()) === 0);
await table(yaraTable).locator('th button:has-text("Disparos")').click();
expect('ordena pelos disparos, do maior', (await names()).join() === 'Emotet,Ruidosa,Pouca,Nunca', (await names()).join());
await table(yaraTable).locator('th button:has-text("Disparos")').click();
expect('de novo: do menor', (await names()).join() === 'Nunca,Pouca,Ruidosa,Emotet', (await names()).join());
await table(yaraTable).locator('th button:has-text("% em limpas")').click();
expect('ordena pela porcentagem em limpas', (await names()).join() === 'Pouca,Ruidosa,Emotet,Nunca', (await names()).join());
await page.check('#yara-never-fired', { force: true });
expect('só as que não dispararam', (await names()).join() === 'Nunca', (await names()).join());
const filterLabel = await page.locator('label[for="yara-never-fired"]').innerText();
expect('o filtro diz quantas são', filterLabel.includes('(1)'), filterLabel);

// 2. Regras de triagem.
await page.goto(ORIGIN + '/regras-triagem', { waitUntil: 'networkidle' });
const triageTable = 'Regras de triagem';
const triageHead = await headers(triageTable);
const tAt = triageHead.indexOf('Disparos (90 dias)') + 1;
expect('triagem: colunas de eficácia', tAt > 0 && triageHead.includes('% em limpas'), triageHead.join(' | '));
expect('triagem: disparos', (await column(triageTable, tAt)).join() === '4,0', (await column(triageTable, tAt)).join());
expect('triagem: porcentagem', (await column(triageTable, tAt + 1)).join('|') === '25%|—', (await column(triageTable, tAt + 1)).join('|'));
await page.check('#triage-never-fired', { force: true });
expect('triagem: só a que não disparou', (await column(triageTable, 1)).join() === 'Parada', (await column(triageTable, 1)).join());

// 3. Em ingles.
state.preferences = { ...state.preferences, language: 'en' };
await page.goto(ORIGIN + '/yara', { waitUntil: 'networkidle' });
const enHead = await headers('YARA rules');
expect('em inglês', enHead.includes('Fired (90 days)') && enHead.includes('% on clean'), enHead.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\neficácia das regras: tudo ok');
process.exit(failures ? 1 : 0);
