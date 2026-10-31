// Atualizacoes na amostra (aba Historico): validacao, Ctrl+S, texto puro com
// quebras de linha, destaque de "nota", filtro "Somente atualizacoes", aviso de
// alteracoes nao salvas, erro da API; e o destaque do Relatorio limpo apos salvar.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const messages = () => page.locator('.hpsm-msg__text').allTextContents();
const invalid = () => page.locator('.hpsm-field--invalid').count();
const commentRows = page.locator('tr.dl-history-comment');

// 1. Formulario na aba Historico.
await page.goto(ORIGIN + '/entries/e1?tab=historico', { waitUntil: 'networkidle' });
expect('seção "Nova atualização"', await page.locator('.hpsm-section__head:has-text("Nova atualização")').isVisible());
const help = () => page.locator('.hpsm-field:has(#comment-text) .hpsm-field__help').textContent();
expect('contador começa em 0/4000', (await help())?.includes('(0/4000)'), await help());

// 2. Vazio: destaque + mensagem + foco.
await page.click('.hpsm-toolbar__action:has-text("Adicionar atualização")');
await settle();
expect('vazio destaca o campo', (await invalid()) === 1);
expect('mensagem de validação', (await messages()).includes('Preencha ou corrija os campos destacados: Atualização.'));
expect('foco no campo', await page.evaluate(() => document.activeElement?.id === 'comment-text'));

// 3. Texto com quebra de linha e "HTML": Ctrl+S salva.
await page.fill('#comment-text', 'Pedi mais informações ao remetente.\nAguardando <b>retorno</b>.');
expect('contador acompanha', (await help())?.includes('(62/4000)'), await help());
await page.keyboard.press('Control+KeyS');
await settle(500);
expect('Ctrl+S registra', (await messages()).includes('Atualização registrada no histórico.'));
expect('campo limpo e sem destaque', (await page.inputValue('#comment-text')) === '' && (await invalid()) === 0);
expect('linha de atualização na linha do tempo', (await commentRows.count()) === 1);
const row = commentRows.first();
expect('rótulo "Atualização:" e autor', (await row.locator('strong').textContent()) === 'Atualização:' && (await row.locator('td').nth(1).textContent()) === 'Ana Souza');
const shownText = await row.locator('.dl-history-comment__text').evaluate((el) => el.innerText);
expect('quebra de linha preservada', shownText === 'Pedi mais informações ao remetente.\nAguardando <b>retorno</b>.', JSON.stringify(shownText));
expect('HTML exibido como texto', (await row.locator('.dl-history-comment__text b').count()) === 0);
const bg = await row.locator('td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
expect('fundo de nota', bg === 'rgb(255, 251, 230)', bg);
await page.screenshot({ path: `${OUT}/historico-atualizacao.png` });

// 4. Filtro "Somente atualizacoes".
const allRows = await page.locator('.hpsm-tabpanel tbody tr').count();
await page.locator('label[for="history-only-comments"]').click();
await settle();
const label = await page.locator('label[for="history-only-comments"]').textContent();
expect('rótulo com o total', label?.includes('Somente atualizações (1)'), label);
expect('filtro mostra só atualizações', (await page.locator('.hpsm-tabpanel tbody tr').count()) === 1 && allRows > 1, `${allRows} -> 1`);
await page.locator('label[for="history-only-comments"]').click();

// 5. Erro da API vai para a barra.
state.commentError = { status: 429, error: 'Muitas tentativas. Tente novamente em 1 minuto.' };
await page.fill('#comment-text', 'mais uma');
await page.click('.hpsm-toolbar__action:has-text("Adicionar atualização")');
await settle();
expect('erro da API na barra', (await messages()).includes('Muitas tentativas. Tente novamente em 1 minuto.'));
expect('texto mantido após erro', (await page.inputValue('#comment-text')) === 'mais uma');
state.commentError = null;

// 6. Texto nao salvo: trocar de aba pergunta.
await page.click('.hpsm-tab:has-text("Detalhes")');
const confirmBox = page.locator('[role=alertdialog]:has-text("Alterações não salvas")');
await confirmBox.waitFor({ timeout: 3000 }).catch(() => undefined);
expect('trocar de aba com texto pergunta', await confirmBox.isVisible());
await page.click('[role=alertdialog] button:has-text("Continuar editando")');
expect('continua na aba Histórico', new URL(page.url()).searchParams.get('tab') === 'historico');
await page.fill('#comment-text', '');

// 7. Relatorio: destaque some depois de salvar com sucesso.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
await page.click('.hpsm-toolbar__action:has-text("Salvar relatório")');
await settle();
expect('relatório vazio destaca o Resumo', (await invalid()) === 1);
await page.fill('#report-summary', 'Resumo válido do relatório');
await page.click('.hpsm-toolbar__action:has-text("Salvar relatório")');
await settle(500);
expect('após salvar, Resumo vazio sem destaque', (await page.inputValue('#report-summary')) === '' && (await invalid()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\natualizações: tudo ok');
process.exit(failures ? 1 : 0);
