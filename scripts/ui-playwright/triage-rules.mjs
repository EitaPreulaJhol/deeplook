// Regras de triagem (86): pasta Deteccao, lista (descricao da condicao, tags,
// prioridade, desligada apagada), nova regra (valor so quando a condicao pede,
// validacao de nome/valor/tags), ligar/desligar, excluir com confirmacao,
// historico "Regra de triagem" e usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, events, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const LABEL = { MACRO: 'documento com macro', DOMAIN: 'domínio do link', YARA: 'regra YARA casou', DETECTED_TYPE: 'tipo real é', LOOKALIKE: 'parecido com domínio da empresa', ATTACK_TECHNIQUE: 'técnica ATT&CK' };
const rules = [
  { id: 't1', name: 'Documento com macro', condition: 'MACRO', value: null, tags: ['macro'], priority: 'P2', enabled: true, createdBy: null },
  { id: 't2', name: 'TLD suspeito', condition: 'DOMAIN', value: '.top', tags: ['tld-suspeito'], priority: null, enabled: false, createdBy: null },
];
const calls = [];
await context.route((url) => url.pathname.startsWith('/api/triage-rules'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (state.role === 'USER') return json(403, { error: 'Somente analistas mantêm as regras de triagem.' });
  const label = (r) => (r.value ? `${LABEL[r.condition]} ${r.value}` : LABEL[r.condition]);
  if (req.method() === 'GET') return json(200, { rules: rules.map((r) => ({ ...r, label: label(r) })) });
  calls.push({ method: req.method(), path, body });
  if (req.method() === 'POST') {
    rules.push({ id: `t${rules.length + 1}`, ...body, enabled: true, createdBy: null });
    return json(201, { rule: {} });
  }
  const r = rules.find((x) => path.endsWith(`/${x.id}`));
  if (req.method() === 'PATCH') r.enabled = body.enabled;
  else rules.splice(rules.indexOf(r), 1);
  return json(200, { ok: true });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const rows = page.locator('table[aria-label="Regras de triagem"] tbody tr');
const rowTexts = async () => (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const messages = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');

// 1. Navegador e lista.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('#hpsm-tree-deteccao .hpsm-tree__leaf:has-text("Regras de triagem")');
await settle();
expect('abre pela pasta Detecção', new URL(page.url()).pathname === '/regras-triagem');
let rt = await rowTexts();
expect('lista com condição, tags e prioridade', rt[0].startsWith('Documento com macro documento com macro macro P2 Alta Ligada') && rt[1].startsWith('TLD suspeito domínio do link .top tld-suspeito mantém Desligada'), rt.join(' | '));
expect('desligada apagada', (await rows.nth(1).getAttribute('class'))?.includes('is-off'));

// 2. Nova regra: valor so quando pede; validacao.
expect('macro não pede valor', (await page.locator('#rule-value').count()) === 0);
await page.selectOption('#rule-condition', 'DOMAIN');
expect('domínio pede valor', (await page.locator('#rule-value').count()) === 1);
await page.click('button:has-text("Incluir regra")');
await settle();
expect('validação de nome, valor e tags', calls.length === 0 && (await page.locator('.hpsm-field--invalid').count()) === 3, String(await page.locator('.hpsm-field--invalid').count()));
await page.fill('#rule-name', 'Domínio .xyz');
await page.fill('#rule-value', '.xyz');
await page.fill('#rule-tags', 'phishing, tld-suspeito');
await page.selectOption('#rule-priority', 'P2');
await page.click('button:has-text("Incluir regra")');
await settle();
expect('inclui com os campos', JSON.stringify(calls.at(-1)?.body) === JSON.stringify({ name: 'Domínio .xyz', condition: 'DOMAIN', value: '.xyz', tags: ['phishing', 'tld-suspeito'], priority: 'P2' }), JSON.stringify(calls.at(-1)?.body));
expect('formulário limpo e aviso', (await page.inputValue('#rule-name')) === '' && (await messages()).includes('Regra "Domínio .xyz" incluída'), await messages());
await page.screenshot({ path: `${OUT}/regras-triagem.png`, fullPage: true });

// 2b. Dominio parecido: valor opcional, sem validacao de obrigatorio.
await page.selectOption('#rule-condition', 'LOOKALIKE');
expect('parecido pede valor opcional', (await page.locator('#rule-value').count()) === 1);
await page.fill('#rule-name', 'Parecido com a empresa');
await page.fill('#rule-tags', 'dominio-parecido');
await page.selectOption('#rule-priority', 'P1');
await page.click('button:has-text("Incluir regra")');
await settle();
expect('parecido vazio vale qualquer domínio', calls.at(-1)?.body.condition === 'LOOKALIKE' && calls.at(-1)?.body.value === null, JSON.stringify(calls.at(-1)?.body));
expect('parecido na lista', (await rowTexts()).at(-1).startsWith('Parecido com a empresa parecido com domínio da empresa dominio-parecido P1 Crítica Ligada'), (await rowTexts()).at(-1));
await rows.last().locator('button:has-text("Excluir")').click();
await settle(300);
await page.locator('[role=alertdialog] button:has-text("Excluir")').click();
await settle();

// 2c. Item 7.4: tecnica ATT&CK do capa (valor obrigatorio, com a dica) e assinatura (sem valor).
await page.selectOption('#rule-condition', 'ATTACK_TECHNIQUE');
const techniqueField = page.locator('.hpsm-field:has(#rule-value)');
expect('técnica pede valor, com a dica do código', (await page.locator('#rule-value').count()) === 1 && (await techniqueField.innerText()).includes('ex.: T1055 (vale também para T1055.003)'), await techniqueField.innerText());
await page.fill('#rule-name', 'Injeção de processo');
await page.fill('#rule-value', 'T1055');
await page.fill('#rule-tags', 'injecao');
await page.selectOption('#rule-priority', 'P1');
await page.click('button:has-text("Incluir regra")');
await settle();
expect('técnica incluída com o código', JSON.stringify(calls.at(-1)?.body) === JSON.stringify({ name: 'Injeção de processo', condition: 'ATTACK_TECHNIQUE', value: 'T1055', tags: ['injecao'], priority: 'P1' }), JSON.stringify(calls.at(-1)?.body));
await page.selectOption('#rule-condition', 'SIGNATURE_INVALID');
expect('assinatura não pede valor', (await page.locator('#rule-value').count()) === 0);
const options = await page.locator('#rule-condition option').allInnerTexts();
expect(
  'as seis condições da análise do executável no seletor',
  ['O capa encontrou a capacidade', 'Técnica ATT&CK (pelo capa)', 'Assinatura digital não confere', 'Executável empacotado', 'Alerta do executável', 'Indicador em string escondida (FLOSS)'].every((o) => options.includes(o)),
  options.join('|'),
);
await rows.last().locator('button:has-text("Excluir")').click();
await settle(300);
await page.locator('[role=alertdialog] button:has-text("Excluir")').click();
await settle();

// 3. Ligar e excluir.
await rows.nth(1).locator('button:has-text("Ligar")').click();
await settle();
expect('ligar', calls.at(-1)?.method === 'PATCH' && calls.at(-1)?.body.enabled === true && (await rowTexts())[1].includes('Ligada'));
await rows.nth(0).locator('button:has-text("Excluir")').click();
await settle(300);
const confirmBox = page.locator('[role=alertdialog]');
expect('confirmação avisa que as tags ficam', (await confirmBox.innerText()).includes('As tags já aplicadas continuam nas amostras'));
await confirmBox.locator('button:has-text("Excluir")').click();
await settle();
expect('excluída', calls.at(-1)?.method === 'DELETE' && (await rows.count()) === 2);

// 4. Historico.
events.e3.push(
  { id: 'e3-tr', entryId: 'e3', type: 'TRIAGE_RULE', fromValue: null, toValue: 'Documento com macro', detail: 'tags macro; prioridade P2', createdAt: '2026-10-29T10:00:00.000Z', actor: null },
  { id: 'e3-tp', entryId: 'e3', type: 'PRIORITY_CHANGED', fromValue: 'P3', toValue: 'P2', detail: 'regra de triagem', createdAt: '2026-10-29T10:00:01.000Z', actor: null },
);
await page.goto(ORIGIN + '/entries/e3?tab=historico', { waitUntil: 'networkidle' });
const hist = await page.locator('.hpsm-tabpanel:not([hidden]) tbody').innerText();
expect('histórico da regra', hist.includes('Regra de triagem "Documento com macro": tags macro; prioridade P2') && hist.includes('Prioridade: P3 Média → P2 Alta (regra de triagem)'), hist);

// 5. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/regras-triagem', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/regras-triagem');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nregras de triagem: tudo ok');
process.exit(failures ? 1 : 0);
