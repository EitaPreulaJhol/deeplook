import { defineConfig } from '@playwright/test';

/**
 * Suite visual (item 6.14 do plano): compara capturas das telas de layout critico com as
 * baselines versionadas. Nao substitui os 91 cenarios de comportamento
 * (`scripts/ui-playwright`); pega o que eles nao veem — o que a tela *parece*.
 *
 * Por que as capturas sao estaveis:
 * - o navegador e sempre o mesmo (a imagem mcr.microsoft.com/playwright, no CI e aqui);
 * - o relogio do navegador e o dos dados do mock partem do mesmo instante (DL_NOW);
 * - animacoes e transicoes desligadas, cursor escondido, barras de rolagem fora;
 * - a API e a simulada, entao os dados nao mudam entre rodadas.
 *
 * Para atualizar uma baseline de proposito: `npm run update` e commite os PNGs no mesmo PR.
 */
const NOW = process.env.DL_NOW ?? '2026-10-20T13:00:00.000Z';

export default defineConfig({
  testDir: '.',
  testMatch: /screens\.spec\.mjs$/,
  outputDir: 'test-results',
  // Caminho das baselines (uma pasta por projeto, com o mesmo PNG nos dois tamanhos de tela).
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: false,
  // Um por vez: o mock guarda estado global (violacoes de CSP) e a captura sai sempre igual.
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Comparacao pixel a pixel (padrao do Playwright): tolera um pixel de antialiasing, nao
      // uma borda de 1 px fora do lugar.
      threshold: 0.2,
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: 'https://deeplook.test',
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    // A fonte e a do proprio bundle (IBM Plex), mas o Chromium o mesmo em todo lugar.
    launchOptions: { args: ['--font-render-hinting=none', '--hide-scrollbars'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    // Telas de lista e de ficha tambem no tamanho em que o layout aperta. As demais ficam
    // so no desktop: cada baseline a mais e mais manutencao.
    { name: 'compacto', use: { viewport: { width: 1024, height: 700 } }, grep: /@compacto/ },
  ],
  metadata: { frozenTime: NOW },
});
