// Abas de trabalho e idioma (plano pos-revisao, item 1.5): as abas de rota mostram o titulo no
// idioma atual (antes ficavam no idioma em que foram abertas); a da amostra guarda o nome dela; o
// titulo da janela acompanha. E uma lista gravada antes da mudanca, com o titulo padrao em
// portugues, aparece no idioma atual.
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';

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
const tabs = async () =>
  (await page.locator('.hpsm-doctab__link').allInnerTexts()).map((t) => t.trim());
const setLanguage = async (language) => {
  await page.goto(ORIGIN + '/user?tab=preferencias', { waitUntil: 'networkidle' });
  await page.selectOption('#pref-language', language);
  await page
    .locator('.hpsm-toolbar__action', { hasText: /Salvar preferências|Save preferences/ })
    .click();
  // A preferencia e gravada na conta e so entao vale: espera o idioma da pagina mudar.
  await page.waitForFunction((l) => document.documentElement.lang === l, language);
  await page.waitForTimeout(100);
};
const sample = entries[0].title;

// 1. Tres abas em portugues.
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
await page.goto(ORIGIN + '/casos', { waitUntil: 'networkidle' });
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
const pt = await tabs();
expect(
  'português: Histórico Global, Casos e o nome da amostra',
  pt.includes('Histórico Global') && pt.includes('Casos') && pt.includes(sample),
  pt.join(' | '),
);

// 2. Troca para ingles: as abas de rota mudam, a da amostra fica.
await setLanguage('en');
const en = await tabs();
expect(
  'inglês: as mesmas abas, com o título da rota no idioma novo',
  en.includes('Global history') && en.includes('Cases') && en.includes(sample) && en.includes('My account'),
  en.join(' | '),
);
expect('inglês: nada sobra em português', !en.includes('Histórico Global') && !en.includes('Casos'), en.join(' | '));
await page.click(`.hpsm-doctab__link:text-is("Global history")`);
await page.waitForURL('**/history');
await page.waitForFunction(() => document.title.startsWith('Global history'), null, { timeout: 3000 }).catch(() => {});
expect('título da janela em inglês', (await page.title()) === 'Global history · DeepLook', await page.title());
const closeLabel = await page
  .locator('.hpsm-doctab:has(.hpsm-doctab__link:text-is("Global history")) .hpsm-doctab__close')
  .getAttribute('aria-label');
expect('botão de fechar com o título no idioma novo', (closeLabel ?? '').includes('Global history'), closeLabel);

// 3. De volta ao portugues.
await setLanguage('pt-BR');
const back = await tabs();
expect(
  'de volta ao português',
  back.includes('Histórico Global') && back.includes('Minha Conta') && back.includes(sample),
  back.join(' | '),
);

// 4. Lista gravada antes da mudanca (titulo padrao guardado em portugues), aberta em ingles.
await page.evaluate(() =>
  window.sessionStorage.setItem(
    'dl-workspace-tabs',
    JSON.stringify([
      { path: '/history', url: '/history', title: 'Histórico Global' },
      { path: '/casos', url: '/casos', title: 'Casos' },
      { path: '/entries/e1', url: '/entries/e1', title: 'nome escolhido pela tela' },
    ]),
  ),
);
state.preferences = { ...state.preferences, language: 'en' };
await page.goto(ORIGIN + '/history', { waitUntil: 'networkidle' });
const old = await tabs();
expect(
  'lista antiga: título padrão no idioma atual, título da tela preservado',
  old.includes('Global history') && old.includes('Cases') && old.includes('nome escolhido pela tela'),
  old.join(' | '),
);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nabas e idioma: tudo ok');
process.exit(failures ? 1 : 0);
