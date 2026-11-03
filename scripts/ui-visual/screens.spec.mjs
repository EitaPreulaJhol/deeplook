import { expect, open, test } from './fixtures.mjs';

/**
 * As telas de layout critico (item 6.14). Cada captura cobre o que a pessoa ve, inclusive o
 * que esta abaixo da dobra (fullPage); o objetivo nao e pegar bug de dado, e sim de layout:
 * espaco, alinhamento, tipografia, tabela, densidade e o que o tema faz com tudo isso.
 *
 * As marcadas com @compacto tambem rodam em 1024x700, onde a tabela e as abas apertam.
 */

test.describe('telas', () => {
  test('login', async ({ page, state }) => {
    state.loggedIn = false;
    await open(page, '/login');
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('página inicial @compacto', async ({ page }) => {
    await open(page, '/inicio');
    await expect(page).toHaveScreenshot('inicio.png', { fullPage: true });
  });

  test('histórico global @compacto', async ({ page }) => {
    await open(page, '/history');
    await expect(page).toHaveScreenshot('historico.png', { fullPage: true });
  });

  test('meus uploads', async ({ page }) => {
    await open(page, '/me');
    await expect(page).toHaveScreenshot('meus-uploads.png', { fullPage: true });
  });

  test('ficha da amostra @compacto', async ({ page }) => {
    await open(page, '/entries/e1');
    await expect(page).toHaveScreenshot('ficha-amostra.png', { fullPage: true });
  });

  test('ficha para impressão', async ({ page }) => {
    await open(page, '/entries/e1/imprimir');
    await expect(page).toHaveScreenshot('ficha-impressao.png', { fullPage: true });
  });

  test('casos @compacto', async ({ page }) => {
    await open(page, '/casos');
    await expect(page).toHaveScreenshot('casos.png', { fullPage: true });
  });

  test('painel', async ({ page }) => {
    await open(page, '/painel');
    await expect(page).toHaveScreenshot('painel.png', { fullPage: true });
  });

  test('caixa de entrada', async ({ page }) => {
    await open(page, '/inbox');
    await expect(page).toHaveScreenshot('caixa-de-entrada.png', { fullPage: true });
  });

  test('administração: configurações', async ({ page }) => {
    await open(page, '/admin?tab=settings');
    await expect(page).toHaveScreenshot('admin-configuracoes.png', { fullPage: true });
  });
});
