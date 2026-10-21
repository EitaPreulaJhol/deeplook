// Screenshots de todas as telas (out/*.png) + medidas do cabecalho da lista.
import { chromium } from 'playwright';

import { createState, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();

async function shoot(page, path, name) {
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('ok', name);
}

// --- paginas publicas ---------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await setupMock(context, createState({ loggedIn: false }));
  const page = await context.newPage();
  watchErrors(page);
  await shoot(page, '/home', '01-home');
  await shoot(page, '/login', '02-login');
  await shoot(page, '/register', '03-register');
  await context.close();
}

// --- app logado (admin) -----------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setupMock(context, createState({ loggedIn: true }));
  const page = await context.newPage();
  watchErrors(page);

  await shoot(page, '/inicio', '04-inicio');
  await shoot(page, '/history', '05-history');
  console.log(
    await page.evaluate(() => {
      const el = document.querySelector('table thead th');
      const cs = getComputedStyle(el);
      return `cabecalho da lista: padding=${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft} altura=${el.getBoundingClientRect().height}px`;
    }),
  );
  await shoot(page, '/me', '06-meus-uploads-vazio');
  await shoot(page, '/entries/e1', '07-amostra-detalhes');
  await shoot(page, '/entries/e1?tab=analise', '08-amostra-analise');
  await shoot(page, '/entries/e1?tab=relatorios', '09-amostra-relatorios');
  await shoot(page, '/submit', '10-enviar');
  await shoot(page, '/admin', '11-admin-usuarios');
  await shoot(page, '/admin?tab=keys', '12-admin-chaves');
  await shoot(page, '/user', '13-minha-conta');
  await shoot(page, '/user?tab=senha', '14-minha-conta-senha');
  await shoot(page, '/user?tab=preferencias', '15-minha-conta-preferencias');
  await context.close();
}

await browser.close();
