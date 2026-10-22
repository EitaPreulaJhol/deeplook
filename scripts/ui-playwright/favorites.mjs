// Favoritos: Salvar visao (nome sugerido, sem a pagina, visao repetida, limite),
// Fixar/Desafixar na ficha, pasta no navegador (abre, destaca), menu de contexto
// (clique direito / Shift+F10: mover, renomear, remover), F2, Delete e o "x".
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
const favFolder = page.locator('#hpsm-tree-favoritos');
const favLabels = () => favFolder.locator('.hpsm-tree__fav .hpsm-tree__label').allTextContents();
const promptBox = page.locator('[role=dialog]:has(.hpsm-modal__input)');
const promptInput = page.locator('.hpsm-modal__input');
const ctxMenu = page.locator('.hpsm-ctxmenu');
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
const url = () => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

// 1. Pasta vazia com a dica.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
const empty = await favFolder.locator('.hpsm-tree__empty').textContent();
expect('pasta Favoritos vazia mostra a dica', (empty ?? '').includes('Salvar visão'), empty);

// 2. Salvar visao: nome sugerido pelos filtros; a pagina (offset) nao entra.
await page.goto(ORIGIN + '/history?status=PENDING&verdict=SUSPICIOUS&offset=50', { waitUntil: 'networkidle' });
await page.click('.hpsm-filterbar button:has-text("Salvar visão")');
expect('abre a caixa "Salvar visão"', await promptBox.isVisible());
const suggested = await promptInput.inputValue();
expect('nome sugerido pelos filtros', suggested === 'Pendente · Suspeito', suggested);
expect('campo com foco e texto selecionado', await page.evaluate(() => {
  const el = document.activeElement;
  return el?.classList.contains('hpsm-modal__input') && el.selectionStart === 0 && el.selectionEnd === el.value.length;
}));
await page.screenshot({ path: `${OUT}/favoritos-salvar.png` });
await page.fill('.hpsm-modal__input', '   ');
expect('nome vazio desabilita Salvar', await page.locator('.hpsm-modal button:has-text("Salvar")').isDisabled());
await page.keyboard.press('Escape');
expect('Esc cancela sem gravar', !(await promptBox.isVisible()) && state.favorites.length === 0);

await page.click('.hpsm-filterbar button:has-text("Salvar visão")');
await page.fill('.hpsm-modal__input', 'Suspeitas pendentes');
await page.keyboard.press('Enter');
await settle();
expect('visão salva (mensagem)', (await messages()).includes('Visão "Suspeitas pendentes" salva nos Favoritos.'));
expect('URL salva sem a página', state.favorites[0]?.url === '/history?status=PENDING&verdict=SUSPICIOUS', state.favorites[0]?.url);
expect('aparece na pasta Favoritos', (await favLabels()).join('|') === 'Suspeitas pendentes');
const viewLeafActive = await favFolder.locator('.hpsm-tree__leaf.is-active .hpsm-tree__label').allTextContents();
expect('visão atual destacada no navegador', viewLeafActive.includes('Suspeitas pendentes'));

// Mesma visao de novo: erro com o nome existente.
await page.click('.hpsm-filterbar button:has-text("Salvar visão")');
await page.fill('.hpsm-modal__input', 'Outra');
await page.keyboard.press('Enter');
await settle();
expect('visão repetida recusada', (await messages()).some((t) => t.includes('já está nos Favoritos como "Suspeitas pendentes"')));

// 3. Fixar a amostra na ficha.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
const pinBtn = page.locator('.hpsm-toolbar__action:has-text("Fixar")');
await pinBtn.click();
await settle();
expect('Fixar: mensagem', (await messages()).includes('Amostra fixada nos Favoritos do navegador.'));
const unpin = page.locator('.hpsm-toolbar__action:has-text("Desafixar")');
expect('botão vira "Desafixar" (afundado)', (await unpin.getAttribute('aria-pressed')) === 'true');
expect('amostra na pasta', (await favLabels()).join('|') === 'Suspeitas pendentes|Página de login falsa do banco');

// 4. Abrir a visao pelo navegador.
await page.goto(ORIGIN + '/inicio', { waitUntil: 'networkidle' });
await favFolder.locator('a:has-text("Suspeitas pendentes")').click();
await settle();
expect('favorito abre a visão salva', url() === '/history?status=PENDING&verdict=SUSPICIOUS', url());
expect('filtros aplicados', (await page.inputValue('#status')) === 'PENDING' && (await page.inputValue('#verdict')) === 'SUSPICIOUS');

// 5. Menu de contexto (clique direito): Mover para baixo.
await favFolder.locator('a:has-text("Suspeitas pendentes")').click({ button: 'right' });
expect('clique direito abre o menu', await ctxMenu.isVisible());
expect('foco no primeiro item (Abrir)', (await focused()) === 'Abrir');
expect('"Mover para cima" desabilitado no primeiro', await ctxMenu.locator('button:has-text("Mover para cima")').isDisabled());
await page.screenshot({ path: `${OUT}/favoritos-menu.png` });
await page.keyboard.press('ArrowDown'); // Renomear
await page.keyboard.press('ArrowDown'); // Mover para baixo (pula o desabilitado)
expect('setas pulam item desabilitado', (await focused()) === 'Mover para baixo', await focused());
await page.keyboard.press('Enter');
await settle();
expect('mover para baixo reordena', (await favLabels()).join('|') === 'Página de login falsa do banco|Suspeitas pendentes');
expect('ordem gravada na API', state.favorites.map((f) => f.label).join('|') === 'Página de login falsa do banco|Suspeitas pendentes');

// 6. Teclado: Shift+F10 abre, Esc devolve o foco; F2 renomeia.
const viewLeaf = favFolder.locator('a:has-text("Suspeitas pendentes")');
await viewLeaf.focus();
await page.keyboard.press('Shift+F10');
expect('Shift+F10 abre o menu', await ctxMenu.isVisible());
await page.keyboard.press('Escape');
expect('Esc fecha e devolve o foco', !(await ctxMenu.isVisible()) && (await focused()) === 'Suspeitas pendentes');
await page.keyboard.press('F2');
expect('F2 abre "Renomear favorito"', (await promptInput.inputValue()) === 'Suspeitas pendentes');
await page.fill('.hpsm-modal__input', 'Fila suspeitas');
await page.keyboard.press('Enter');
await settle();
expect('renomeia', (await favLabels()).includes('Fila suspeitas') && state.favorites[1].label === 'Fila suspeitas');

// 7. Remover: Delete pergunta (Nao mantem); "x" remove.
await favFolder.locator('a:has-text("Fila suspeitas")').focus();
await page.keyboard.press('Delete');
const confirmBox = page.locator('[role=alertdialog]:has-text("Remover favorito")');
expect('Delete pede confirmação', (await confirmBox.textContent())?.includes('Remover "Fila suspeitas" dos Favoritos?'));
await page.click('[role=alertdialog] button:has-text("Não")');
expect('"Não" mantém', (await favLabels()).length === 2);
await favFolder.locator('.hpsm-tree__fav:has-text("Fila suspeitas")').hover();
await favFolder.locator('button[aria-label="Remover \\"Fila suspeitas\\" dos Favoritos"]').click();
await page.click('[role=alertdialog] button:has-text("Sim")');
await settle();
expect('"×" remove', (await favLabels()).join('|') === 'Página de login falsa do banco' && state.favorites.length === 1);

// 8. Desafixar na ficha (aberta pelo favorito, que fica destacado).
await favFolder.locator('a:has-text("Página de login falsa do banco")').click();
await settle();
expect('favorito abre a ficha', url() === '/entries/e2');
expect('amostra destacada no navegador', (await favFolder.locator('.hpsm-tree__leaf.is-active').count()) === 1);
await unpin.click();
await settle();
expect('Desafixar remove', state.favorites.length === 0 && (await messages()).includes('Amostra removida dos Favoritos.'));
expect('botão volta a "Fixar"', await page.locator('.hpsm-toolbar__action:has-text("Fixar")').isVisible());

// 9. Limite de 30.
state.favorites = Array.from({ length: 30 }, (_, i) => ({
  id: `f${i}`, kind: 'VIEW', label: `v${i}`, url: `/history?q=${i}`, entryId: null, entry: null, position: i, createdAt: '2026-10-20T13:00:00.000Z',
}));
await page.goto(ORIGIN + '/me', { waitUntil: 'networkidle' });
await page.click('.hpsm-filterbar button:has-text("Salvar visão")');
expect('nome sugerido em Meus Uploads', (await promptInput.inputValue()) === 'Meus Uploads');
await page.keyboard.press('Enter');
await settle();
expect('limite de 30 vira mensagem', (await messages()).some((t) => t.includes('Limite de 30 favoritos')));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nfavoritos: tudo ok');
process.exit(failures ? 1 : 0);
