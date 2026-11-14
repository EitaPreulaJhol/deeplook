import { installScreenRoutes, seedRecords } from '../ui-playwright/screen-data.mjs';

import { expect, NOW, open, test } from './fixtures.mjs';

/**
 * As telas de layout critico (item 6.14). Cada captura cobre o que a pessoa ve, inclusive o
 * que esta abaixo da dobra (fullPage); o objetivo nao e pegar bug de dado, e sim de layout:
 * espaco, alinhamento, tipografia, tabela, densidade e o que o tema faz com tudo isso.
 *
 * As marcadas com @compacto tambem rodam em 1024x700, onde a tabela e as abas apertam; as marcadas
 * com @notebook, em 1366x768, a resolucao em que a varredura visual achou mais quebras de linha.
 */

/** Caso, artigo e ambiente isolado (screen-data.mjs), com o prazo contado do relogio congelado. */
const records = (state) => seedRecords(state, { now: Date.parse(NOW) });
/** Telas com dados proprios: backup, atribuicao, avisos gerais e dominios. */
const screenRoutes = (page) => installScreenRoutes(page.context(), { now: Date.parse(NOW) });

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

  test('histórico global @compacto @notebook', async ({ page }) => {
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

/**
 * As telas corrigidas na varredura visual de novembro de 2026: a volta de qualquer
 * correcao quebra uma destas capturas. O numero entre parenteses e o item da varredura.
 */
test.describe('varredura visual', () => {
  test('caso (10, 15, 16) @notebook', async ({ page, state }) => {
    records(state);
    await open(page, '/casos/cs1');
    await expect(page).toHaveScreenshot('caso.png', { fullPage: true });
  });

  test('ficha: análise com ambiente isolado (9)', async ({ page, state }) => {
    records(state);
    await open(page, '/entries/e1?tab=analise');
    await expect(page).toHaveScreenshot('ficha-analise.png', { fullPage: true });
  });

  test('ficha: relatórios (14, 19) @notebook', async ({ page }) => {
    await open(page, '/entries/e1?tab=relatorios');
    await expect(page).toHaveScreenshot('ficha-relatorios.png', { fullPage: true });
  });

  test('artigo da base de conhecimento (10, 16, 19)', async ({ page, state }) => {
    records(state);
    await open(page, '/kb/kb2');
    await expect(page).toHaveScreenshot('kb-artigo.png', { fullPage: true });
  });

  test('editor da base de conhecimento (12)', async ({ page, state }) => {
    records(state);
    await open(page, '/kb/kb2/editar');
    await expect(page).toHaveScreenshot('kb-editor.png', { fullPage: true });
  });

  test('administração: usuários (17) @notebook', async ({ page }) => {
    await open(page, '/admin?tab=users');
    await expect(page).toHaveScreenshot('admin-usuarios.png', { fullPage: true });
  });

  test('administração: backup (18)', async ({ page }) => {
    await screenRoutes(page);
    await open(page, '/admin?tab=backup');
    await expect(page).toHaveScreenshot('admin-backup.png', { fullPage: true });
  });

  test('avisos gerais (22) @notebook', async ({ page }) => {
    await screenRoutes(page);
    await open(page, '/avisos');
    await expect(page).toHaveScreenshot('avisos.png', { fullPage: true });
  });

  test('atribuição automática (21)', async ({ page }) => {
    await screenRoutes(page);
    await open(page, '/atribuicao');
    await expect(page).toHaveScreenshot('atribuicao.png', { fullPage: true });
  });

  test('domínios da empresa (23) @notebook', async ({ page }) => {
    await screenRoutes(page);
    await open(page, '/dominios-empresa');
    await expect(page).toHaveScreenshot('dominios-empresa.png', { fullPage: true });
  });

  test('comparar amostras (24)', async ({ page, state }) => {
    records(state);
    await open(page, '/comparar?a=e1&b=e3');
    await expect(page).toHaveScreenshot('comparar.png', { fullPage: true });
  });

  test('busca (24)', async ({ page }) => {
    await open(page, '/busca?q=boleto');
    await expect(page).toHaveScreenshot('busca.png', { fullPage: true });
  });

  test('regras YARA com um pacote aberto (25)', async ({ page }) => {
    await open(page, '/yara');
    // bartblaze: o pacote do mock com conjuntos (a tabela de regras sai com linhas).
    await page.getByRole('row', { name: /bartblaze/ }).getByRole('button', { name: 'Ver regras' }).click();
    await page.locator('#yara-pack-search').waitFor();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('yara.png', { fullPage: true });
  });
});
