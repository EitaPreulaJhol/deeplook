import { test as base, expect } from '@playwright/test';

import { createState, entries, ORIGIN, setupMock } from '../ui-playwright/mock-api.mjs';

// A amostra e1 nasce sem TLSH e sem conferencia de integridade, e a ficha mostraria
// "Calculando..." e "Ainda nao conferido" para sempre. A captura fixa o estado completo: um
// valor de TLSH e a data da conferencia, que e o que a pessoa ve depois que o servidor responde.
const e1 = entries.find((e) => e.id === 'e1');
if (e1) {
  e1.tlsh = `T1${'a1b2c3d4'.repeat(8)}a1b2c3`;
  e1.integrityCheckedAt = '2026-10-15T09:30:00.000Z';
}

/** O instante congelado: o mock (idades das amostras) e o navegador usam o mesmo. */
export const NOW = process.env.DL_NOW ?? '2026-10-20T13:00:00.000Z';

// Sem animacao, sem transicao e sem cursor piscando: nada disso e "a tela", e tudo isso faria
// a captura mudar entre rodadas. O `animations: 'disabled'` do toHaveScreenshot cobre o
// Playwright; esta folha cobre animacao de CSS propria da aplicacao.
const STILL = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

/**
 * Pagina com o mock instalado e o relogio parado. O estado nasce logado como admin
 * (`users[0]`), que e quem enxerga todas as telas; um teste que precise de outro estado
 * mexe no `state` antes de navegar.
 */
export const test = base.extend({
  state: async ({}, use) => {
    await use(createState({ loggedIn: true }));
  },
  page: async ({ context, page, state }, use) => {
    await setupMock(context, state);
    await page.clock.setFixedTime(new Date(NOW));
    await use(page);
  },
});

export { expect };

/** Abre uma rota e espera a tela assentar (rede, fontes e a folha que desliga animacao). */
export async function open(page, path) {
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: STILL });
  await page.evaluate(() => document.fonts.ready);
  // Um respiro para o React terminar o que depende de promessa (o networkidle nao cobre
  // atualizacao de estado depois da ultima resposta).
  await page.waitForTimeout(200);
}
