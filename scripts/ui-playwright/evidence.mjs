// Evidencias no relatorio (76): miniaturas, visualizacao ampliada (setas, Esc,
// foco de volta), envio com legenda, recusa de nao imagem, legenda e exclusao,
// imagens na ficha impressa, usuario comum so ve e revisao obrigatoria trava.
import { chromium } from 'playwright';

import { createState, EVIDENCE_PNG, ORIGIN, OUT, reports, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  window.print = () => {};
});
const state = createState({ loggedIn: true });
const ev = (id, caption) => ({ id, caption, mimeType: 'image/png', width: 40, height: 30, size: 184, createdAt: '2026-10-23T10:00:00.000Z', uploadedBy: { id: 'u2', displayName: 'Bruno Lima' } });
reports.find((r) => r.id === 'r1').evidence = [ev('ev-a', 'Página falsa do banco'), ev('ev-b', null)];
await setupMock(context, state);
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const field = page.locator('.hpsm-tabpanel:not([hidden]) .hpsm-field', { hasText: 'Evidências (' });
const thumbs = field.locator('.dl-evidence__thumb');
const captions = async () => (await field.locator('.dl-evidence__caption').allInnerTexts()).map((t) => t.trim());
const messages = async () => (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
const dialog = page.locator('[role=dialog]');

// 1. Miniaturas.
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('campo Evidências (2)', (await field.locator('.hpsm-field__label').innerText()).startsWith('Evidências (2)'));
expect('legendas (sem legenda = "Evidência N")', (await captions()).join('|') === 'Página falsa do banco|Evidência 2', (await captions()).join('|'));
const loaded = await thumbs.first().locator('img').evaluate((img) => img.complete && img.naturalWidth);
expect('miniatura carregada da API', loaded === 40, String(loaded));
expect('miniatura com rótulo acessível', (await thumbs.first().getAttribute('aria-label')) === 'Ampliar: Página falsa do banco');
await page.screenshot({ path: `${OUT}/evidencias.png`, fullPage: true });

// 2. Visualizacao ampliada.
await thumbs.first().click();
await settle();
expect('abre ampliada com a legenda', (await dialog.locator('.hpsm-modal__head').innerText()) === 'Página falsa do banco');
expect('dados da imagem', (await dialog.locator('.dl-evidence-viewer__meta').innerText()).startsWith('Imagem 1 de 2 · 40×30 ·'));
await page.screenshot({ path: `${OUT}/evidencia-ampliada.png` });
await page.keyboard.press('ArrowRight');
await settle(200);
expect('seta para a direita: próxima', (await dialog.locator('.hpsm-modal__head').innerText()) === 'Evidência 2');
expect('"Próxima" desligada na última', await dialog.locator('button:has-text("Próxima")').isDisabled());
await page.keyboard.press('Escape');
await settle(200);
expect('Esc fecha', (await dialog.count()) === 0);
expect('foco volta para a miniatura', await thumbs.first().evaluate((el) => el === document.activeElement));

// 3. Envio com legenda.
await page.fill('#evidence-caption-r1', 'Tela do e-mail');
await page.setInputFiles('#evidence-file-r1', { name: 'prova.png', mimeType: 'image/png', buffer: Buffer.from(EVIDENCE_PNG, 'base64') });
await settle(600);
const sent = state.evidenceCalls.at(-1);
expect('envia arquivo e legenda', sent?.method === 'POST' && sent.caption === 'Tela do e-mail' && sent.filename === 'prova.png', JSON.stringify(sent));
expect('aviso fala dos metadados', (await messages()).includes('Metadados (EXIF, GPS, aparelho) removidos'), await messages());
expect('3 evidências e legenda limpa', (await thumbs.count()) === 3 && (await page.inputValue('#evidence-caption-r1')) === '');

// 4. Nao imagem recusada.
await page.setInputFiles('#evidence-file-r1', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
await settle(600);
expect('SVG recusado com o motivo', (await messages()).includes('logo.svg: Envie uma imagem PNG, JPEG ou WebP'), await messages());
expect('continua com 3', (await thumbs.count()) === 3);

// 5. Legenda e exclusao.
await field.locator('.dl-evidence__item').nth(1).locator('button:has-text("Legenda…")').click();
await settle(300);
await dialog.locator('input').fill('Painel do golpista');
await dialog.locator('button:has-text("Salvar")').click();
await settle(500);
expect('legenda enviada', state.evidenceCalls.at(-1)?.method === 'PATCH' && state.evidenceCalls.at(-1)?.body?.caption === 'Painel do golpista', JSON.stringify(state.evidenceCalls.at(-1)));
expect('legenda na tela', (await captions())[1] === 'Painel do golpista', (await captions()).join('|'));
await field.locator('.dl-evidence__item').nth(2).locator('button:has-text("Excluir")').click();
await settle(300);
const confirmBox = page.locator('[role=alertdialog]');
expect('confirmação cita a legenda', (await confirmBox.innerText()).includes('"Tela do e-mail"'));
await confirmBox.locator('button:has-text("Excluir")').click();
await settle(500);
expect('excluída', state.evidenceCalls.at(-1)?.method === 'DELETE' && (await thumbs.count()) === 2);

// 6. Ficha impressa.
await page.goto(ORIGIN + '/entries/e1/imprimir', { waitUntil: 'networkidle' });
await settle(400);
const figures = page.locator('.dl-print__evidence figure');
expect('impressão com as imagens', (await figures.count()) === 2 && (await figures.first().locator('figcaption').innerText()) === 'Página falsa do banco');
expect('imagem carregada na impressão', (await figures.first().locator('img').evaluate((img) => img.naturalWidth)) === 40);

// 7. Revisao obrigatoria: publicado nao recebe imagem (ve as que tem).
state.reviewRequired = true;
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('revisão obrigatória: sem adicionar, legenda ou excluir', (await field.locator('.dl-evidence__add').count()) === 0 && (await field.locator('.dl-evidence__actions').count()) === 0 && (await thumbs.count()) === 2);
state.reviewRequired = false;

// 8. Usuario comum: so ve.
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e1?tab=relatorios', { waitUntil: 'networkidle' });
expect('usuário comum vê as miniaturas', (await thumbs.count()) === 2);
expect('usuário comum não envia nem edita', (await field.locator('.dl-evidence__add').count()) === 0 && (await field.locator('.dl-evidence__actions').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nevidências: tudo ok');
process.exit(failures ? 1 : 0);
