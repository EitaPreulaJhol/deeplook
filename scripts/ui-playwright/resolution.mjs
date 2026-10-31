// Resolucao para quem enviou (87): campo na triagem com modelos que se somam,
// contador, alteracao nao salva, salvar, destaque no topo da ficha (cor pelo
// veredito, texto puro), historico, Meus Uploads, caixa de entrada (aviso de
// concluida e de resolucao, no sininho e na pagina) e quem enviou sem o campo.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
const bruno = { id: 'u2', displayName: 'Bruno Lima' };
const T1 = 'É golpe: não clique nos links, não abra os anexos e apague a mensagem.';
const T2 = 'Clicou no link ou digitou a senha? Troque a senha agora e avise o suporte.';
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const notice = page.locator('.dl-resolution');
const text = page.locator('#resolution-text');
const saveBtn = page.locator('button:has-text("Salvar resolução")');

// 1. Sem resolucao: sem destaque; campo vazio e "Salvar" desligado.
await page.goto(ORIGIN + '/entries/e2?tab=analise', { waitUntil: 'networkidle' });
expect('sem resolução, sem destaque', (await notice.count()) === 0);
expect('campo na triagem, salvar desligado', (await text.inputValue()) === '' && (await saveBtn.isDisabled()));

// 2. Modelos se somam ao texto; contador.
await page.selectOption('#resolution-template', T1);
await page.selectOption('#resolution-template', T2);
expect('modelos se somam', (await text.inputValue()) === `${T1} ${T2}`, await text.inputValue());
expect('seletor volta ao início', (await page.locator('#resolution-template').inputValue()) === '');
expect('contador', (await page.locator('.dl-resolution__count').innerText()) === `${T1.length + T2.length + 1}/500`);

// 3. Alteracao nao salva pede confirmacao ao trocar de aba.
await page.click('.hpsm-tab:has-text("Histórico")');
await settle(300);
const confirmBox = page.locator('[role=alertdialog]');
expect('alteração não salva pede confirmação', (await confirmBox.count()) === 1);
await confirmBox.locator('button:has-text("Continuar editando")').click();
await settle(300);

// 4. Salvar: PATCH, destaque vermelho (malicioso) no topo e historico.
await text.fill(`  ${T1}  `);
await saveBtn.click();
await settle();
expect('salva aparada', state.lastPatch?.resolution === T1, JSON.stringify(state.lastPatch));
expect('"Registro atualizado."', (await page.locator('.hpsm-msg__text').allInnerTexts()).some((t) => t.includes('Registro atualizado')));
expect('destaque vermelho no topo', (await notice.count()) === 1 && (await notice.getAttribute('class')).includes('dl-resolution--danger'));
expect('título e texto', (await notice.innerText()).includes('O que fazer (orientação da equipe de segurança)') && (await notice.innerText()).includes(T1));
expect('salvar desliga de novo', await saveBtn.isDisabled());
await page.screenshot({ path: `${OUT}/resolucao-ficha.png` });
await page.click('.hpsm-tab:has-text("Histórico")');
await settle();
const hist = await page.locator('.hpsm-tabpanel:not([hidden])').innerText();
expect('no histórico', hist.includes(`Resolução para quem enviou: "${T1}"`), hist.slice(-700));

// 5. Texto puro (nada de HTML) e cor pelo veredito.
entries[3].resolution = '<b>Seguro</b>: pode abrir.';
await page.goto(ORIGIN + '/entries/e4', { waitUntil: 'networkidle' });
expect('verde quando limpo', (await notice.getAttribute('class')).includes('dl-resolution--ok'));
expect('texto puro', (await notice.locator('b').count()) === 0 && (await notice.innerText()).includes('<b>Seguro</b>'));

// 6. Remover: vazio grava null e o destaque some.
await page.goto(ORIGIN + '/entries/e2?tab=analise', { waitUntil: 'networkidle' });
await text.fill('');
await saveBtn.click();
await settle();
expect('vazio remove', state.lastPatch?.resolution === null && (await notice.count()) === 0);
entries[1].resolution = T1;

// 7. Meus Uploads: a resolucao abaixo do titulo.
state.mine = ['e2', 'e4'];
await page.goto(ORIGIN + '/me', { waitUntil: 'networkidle' });
const rows = page.locator('table tbody tr');
const lines = await page.locator('table tbody .dl-resolution-line').allInnerTexts();
expect('Meus Uploads mostra a resolução', lines.length === 2 && lines.includes(`O que fazer: ${T1}`), lines.join(' | '));
expect('linha continua com o título', (await rows.first().innerText()).includes('Página de login falsa do banco'));

// 8. Caixa de entrada: aviso de concluida com a resolucao atual e aviso de resolucao.
state.notifications = [
  { id: 'n1', type: 'RESOLUTION', detail: T2, readAt: null, createdAt: '2026-10-29T10:00:00.000Z', entry: { id: 'e2', title: 'Página de login falsa do banco', resolution: T2 }, actor: bruno },
  { id: 'n2', type: 'COMPLETED', detail: 'MALICIOUS', readAt: null, createdAt: '2026-10-29T09:00:00.000Z', entry: { id: 'e2', title: 'Página de login falsa do banco', resolution: T2 }, actor: bruno },
  { id: 'n3', type: 'COMPLETED', detail: 'CLEAN', readAt: null, createdAt: '2026-10-28T09:00:00.000Z', entry: { id: 'e4', title: 'driver_update.msi', resolution: null }, actor: bruno },
];
await page.goto(ORIGIN + '/inbox', { waitUntil: 'networkidle' });
const inboxRows = (await page.locator('table tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
expect('aviso de resolução', inboxRows[0].includes('Bruno Lima escreveu o que fazer com a sua amostra') && inboxRows[0].includes(`O que fazer: ${T2}`), inboxRows[0]);
expect('aviso de concluída com a resolução', inboxRows[1].includes('concluiu a sua amostra') && inboxRows[1].includes(`O que fazer: ${T2}`), inboxRows[1]);
expect('concluída sem resolução fica como antes', !inboxRows[2].includes('O que fazer'), inboxRows[2]);
await page.click('.hpsm-inbox__bell');
await settle();
expect('no sininho também', (await page.locator('.hpsm-inbox__panel .dl-resolution-line').count()) === 2);
await page.screenshot({ path: `${OUT}/resolucao-inbox.png` });
await page.keyboard.press('Escape');

// 8b. Rascunho nao passa para a proxima amostra (item 102): e1 e e2 sem resolucao.
entries[0].resolution = null;
const savedResolution = entries[1].resolution;
entries[1].resolution = null;
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.click('table tbody tr:has-text("instalador_suspeito.exe")');
await settle();
await page.click('.hpsm-tab:has-text("Análise")');
await settle(200);
const firstPath = new URL(page.url()).pathname;
await text.fill('RASCUNHO DA PRIMEIRA');
await page.click('.hpsm-toolbar__action:has-text("Próxima")');
const leave = page.locator('[role=alertdialog]');
await leave.waitFor({ timeout: 3000 });
await leave.locator('button:has-text("Descartar")').click();
await settle(500);
const secondPath = new URL(page.url()).pathname;
expect('trocou de amostra', firstPath !== secondPath, `${firstPath} -> ${secondPath}`);
expect('rascunho não passa para a próxima amostra', (await text.inputValue()) === '', await text.inputValue());
expect('salvar continua desligado', await saveBtn.isDisabled());
// Voltar para a ja visitada: vem do cache, sem a tela de "carregando".
await text.fill('RASCUNHO DA SEGUNDA');
await page.click('.hpsm-toolbar__action:has-text("Anterior")');
await leave.waitFor({ timeout: 3000 });
await leave.locator('button:has-text("Descartar")').click();
await settle(500);
expect('voltou para a já visitada', new URL(page.url()).pathname === firstPath, page.url());
expect('rascunho não passa para a amostra do cache', (await text.inputValue()) === '', await text.inputValue());
expect('salvar desligado na amostra do cache', await saveBtn.isDisabled());
entries[1].resolution = savedResolution;

// 9. Quem enviou: ve o destaque, sem o campo.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('quem enviou vê o destaque', (await notice.innerText()).includes(T1));
expect('quem enviou não tem o campo', (await page.locator('#resolution-text').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nresolução para quem enviou: tudo ok');
process.exit(failures ? 1 : 0);
