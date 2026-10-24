// Atribuicao automatica (72): pasta Gestao, regras em ordem (subir/descer,
// ligar/desligar, incluir com validacao, excluir), grupos (membros com ausente,
// editar membros, criar, excluir com aviso das regras), disponibilidade (admin
// marca qualquer um; analista so a si), historico "automatica: grupo..." e
// usuario comum sem acesso.
import { chromium } from 'playwright';

import { createState, events, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);

const ana = { id: 'u1', displayName: 'Ana Souza' };
const bruno = { id: 'u2', displayName: 'Bruno Lima' };
const model = {
  away: { u1: false, u2: true },
  groups: [
    { id: 'g1', name: 'Phishing', members: ['u1', 'u2'] },
    { id: 'g2', name: 'Malware', members: [] },
  ],
  rules: [
    { id: 'r1', groupId: 'g1', entryType: 'URL', tag: 'phishing', priority: null, enabled: true },
    { id: 'r2', groupId: 'g2', entryType: 'FILE', tag: null, priority: null, enabled: false },
  ],
};
const calls = [];
const TYPE = { FILE: 'arquivo', URL: 'link' };
const label = (r) => [r.entryType && `tipo ${TYPE[r.entryType]}`, r.tag && `tag ${r.tag}`, r.priority].filter(Boolean).join(', ') || 'qualquer amostra';
const person = (id) => [ana, bruno].find((p) => p.id === id);
await context.route((url) => url.pathname.startsWith('/api/assignment'), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (req.method() === 'GET') {
    return json(200, {
      groups: [...model.groups].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({
        id: g.id,
        name: g.name,
        rules: model.rules.filter((r) => r.groupId === g.id).length,
        members: g.members.map((id) => ({ ...person(id), away: model.away[id], available: !model.away[id], lastAssignedAt: null })),
      })),
      rules: model.rules.map((r, i) => ({ ...r, position: i + 1, label: label(r), group: { id: r.groupId, name: model.groups.find((g) => g.id === r.groupId).name } })),
      analysts: [ana, bruno].map((p) => ({ ...p, away: model.away[p.id] })),
    });
  }
  calls.push({ method: req.method(), path, body });
  let m;
  if (path === '/api/assignment/groups') {
    model.groups.push({ id: `g${model.groups.length + 1}`, name: body.name.trim(), members: [] });
    return json(201, { group: {} });
  }
  if ((m = path.match(/^\/api\/assignment\/groups\/(\w+)$/))) {
    if (req.method() === 'DELETE') {
      model.groups = model.groups.filter((g) => g.id !== m[1]);
      model.rules = model.rules.filter((r) => r.groupId !== m[1]);
    } else {
      const g = model.groups.find((x) => x.id === m[1]);
      if (body.memberIds) g.members = body.memberIds;
      if (body.name) g.name = body.name;
    }
    return json(200, { ok: true });
  }
  if (path === '/api/assignment/rules') {
    model.rules.push({ id: `r${model.rules.length + 1}`, ...body, enabled: true });
    return json(201, { rule: {} });
  }
  if ((m = path.match(/^\/api\/assignment\/rules\/(\w+)\/move$/))) {
    const i = model.rules.findIndex((r) => r.id === m[1]);
    const j = body.direction === 'up' ? i - 1 : i + 1;
    [model.rules[i], model.rules[j]] = [model.rules[j], model.rules[i]];
    return json(200, { ok: true });
  }
  if ((m = path.match(/^\/api\/assignment\/rules\/(\w+)$/))) {
    if (req.method() === 'DELETE') model.rules = model.rules.filter((r) => r.id !== m[1]);
    else model.rules.find((r) => r.id === m[1]).enabled = body.enabled;
    return json(200, { ok: true });
  }
  if ((m = path.match(/^\/api\/assignment\/away\/(\w+)$/))) {
    model.away[m[1]] = body.away;
    return json(200, { away: body.away });
  }
  return json(404, { error: 'rota' });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label_, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label_}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const rules = page.locator('table[aria-label="Regras de atribuição"] tbody tr');
const ruleTexts = async () => (await rules.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const groups = page.locator('table[aria-label="Grupos de analistas"] tbody tr');
const messages = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const confirmBox = page.locator('[role=alertdialog]');

// 1. Navegador e regras.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await page.click('#hpsm-tree-gestao .hpsm-tree__leaf:has-text("Atribuição automática")');
await settle();
expect('abre pela pasta Gestão', new URL(page.url()).pathname === '/atribuicao');
let rt = await ruleTexts();
expect('regras com ordem, condição, grupo e situação', rt[0].startsWith('1 tipo link, tag phishing Phishing Ligada') && rt[1].startsWith('2 tipo arquivo Malware Desligada'), rt.join(' | '));
expect('regra desligada apagada', (await rules.nth(1).getAttribute('class'))?.includes('is-off'));
expect('primeira não sobe', await rules.nth(0).locator('button:has-text("Subir")').isDisabled());
await page.screenshot({ path: `${OUT}/atribuicao.png`, fullPage: true });

// 2. Ordem e ligar/desligar.
await rules.nth(0).locator('button:has-text("Descer")').click();
await settle();
rt = await ruleTexts();
expect('descer troca a ordem', calls.at(-1)?.path === '/api/assignment/rules/r1/move' && calls.at(-1)?.body.direction === 'down' && rt[0].includes('Malware'), rt.join(' | '));
await rules.nth(0).locator('button:has-text("Ligar")').click();
await settle();
expect('ligar a regra', JSON.stringify(calls.at(-1)?.body) === '{"enabled":true}' && (await ruleTexts())[0].includes('Ligada'));

// 3. Incluir regra.
const before = calls.length;
await page.click('button:has-text("Incluir regra")');
await settle();
expect('sem grupo não inclui', calls.length === before && (await messages()).includes('Escolha o grupo'), await messages());
await page.selectOption('#rule-group', 'g2');
await page.selectOption('#rule-type', 'FILE');
await page.selectOption('#rule-priority', 'P1');
await page.click('button:has-text("Incluir regra")');
await settle();
expect('inclui com os campos', JSON.stringify(calls.at(-1)?.body) === '{"groupId":"g2","entryType":"FILE","tag":null,"priority":"P1"}' && (await rules.count()) === 3, JSON.stringify(calls.at(-1)?.body));
expect('formulário limpo', (await page.inputValue('#rule-group')) === '');
await rules.nth(2).locator('button:has-text("Excluir")').click();
await settle(300);
await confirmBox.locator('button:has-text("Excluir")').click();
await settle();
expect('exclui a regra', calls.at(-1)?.method === 'DELETE' && (await rules.count()) === 2);

// 4. Grupos e membros.
const g1 = (await groups.nth(1).innerText()).replace(/\s+/g, ' ');
expect('membros com ausente marcado', g1.includes('Ana Souza, Bruno Lima (ausente)'), g1);
const g2 = (await groups.nth(0).innerText()).replace(/\s+/g, ' ');
expect('grupo vazio avisa', g2.includes('ninguém (as regras dele não atribuem)'), g2);
await groups.nth(1).locator('button:has-text("Membros…")').click();
await settle(200);
await page.locator('label[for="member-g1-u2"]').click();
await page.click('button:has-text("Salvar membros")');
await settle();
expect('salva os membros', JSON.stringify(calls.at(-1)?.body) === '{"memberIds":["u1"]}', JSON.stringify(calls.at(-1)?.body));
await page.fill('#group-name', 'Fraude bancária');
await page.click('button:has-text("Criar grupo")');
await settle();
expect('cria grupo', calls.at(-1)?.path === '/api/assignment/groups' && calls.at(-1)?.body.name === 'Fraude bancária' && (await groups.count()) === 3);
await groups.filter({ hasText: 'Malware' }).locator('button:has-text("Excluir")').click();
await settle(300);
expect('exclusão avisa das regras do grupo', (await confirmBox.innerText()).includes('As 1 regra(s) dele também saem'), await confirmBox.innerText());
await confirmBox.locator('button:has-text("Excluir")').click();
await settle();
expect('grupo e regras saem', (await groups.count()) === 2 && (await rules.count()) === 1);

// 5. Disponibilidade: admin marca qualquer um.
const awayBruno = page.locator('#away-u2');
expect('Bruno aparece ausente', await awayBruno.isChecked());
await page.locator('label[for="away-u2"]').click();
await settle();
expect('admin tira o Bruno da ausência', calls.at(-1)?.path === '/api/assignment/away/u2' && calls.at(-1)?.body.away === false && (await messages()).includes('Bruno Lima voltou ao rodízio'), await messages());

// 6. Analista: so a si mesmo.
state.role = 'ANALYST';
await page.reload({ waitUntil: 'networkidle' });
expect('analista não marca outros', await page.locator('#away-u2').isDisabled() && !(await page.locator('#away-u1').isDisabled()));
await page.locator('label[for="away-u1"]').click();
await settle();
expect('analista se marca ausente', calls.at(-1)?.path === '/api/assignment/away/u1' && (await messages()).includes('Você está ausente'), await messages());

// 7. Historico da amostra.
events.e3.push({ id: 'e3-auto', entryId: 'e3', type: 'ASSIGNED', fromValue: null, toValue: 'Ana Souza', detail: 'automática: grupo Phishing (tipo link, tag phishing)', createdAt: '2026-10-24T10:00:00.000Z', actor: null });
await page.goto(ORIGIN + '/entries/e3?tab=historico', { waitUntil: 'networkidle' });
const auto = (await page.locator('.hpsm-tabpanel:not([hidden]) tbody tr', { hasText: 'automática' }).first().locator('td').allInnerTexts()).map((t) => t.trim());
expect('histórico mostra a atribuição automática', auto[1] === 'Sistema' && auto[2] === 'Responsável: — → Ana Souza (automática: grupo Phishing (tipo link, tag phishing))', auto.join(' | '));

// 8. Usuario comum.
state.role = 'USER';
await page.goto(ORIGIN + '/atribuicao', { waitUntil: 'networkidle' });
expect('usuário comum é redirecionado', new URL(page.url()).pathname !== '/atribuicao');

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\natribuição automática: tudo ok');
process.exit(failures ? 1 : 0);
