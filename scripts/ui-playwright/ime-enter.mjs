// Enter de envio com IME: no campo de dominio da empresa e no "adicionar amostra" do caso, o Enter
// comum envia e o Enter que confirma uma composicao (isComposing, ou keyCode 229 no Safari) nao.
import { chromium } from 'playwright';

import { createState, ORIGIN, setupMock, watchErrors } from './mock-api.mjs';
import { installScreenRoutes, seedRecords } from './screen-data.mjs';

const NOW = Date.parse('2026-10-20T13:00:00.000Z');
let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
seedRecords(state, { now: NOW });
await setupMock(context, state);
await installScreenRoutes(context, { now: NOW });
const domainPosts = [];
await context.route(
  (url) => url.pathname === '/api/company-domains',
  (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    domainPosts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ item: { id: 'cd9', domain: 'nova.com.br', createdAt: new Date(NOW).toISOString(), createdBy: null } }),
    });
  },
);
const page = await context.newPage();
watchErrors(page);

/** keydown de Enter como o navegador manda durante a composicao. */
const imeEnter = (selector, { composing, keyCode }) =>
  page.locator(selector).evaluate(
    (el, opts) => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: opts.composing });
      Object.defineProperty(ev, 'keyCode', { get: () => opts.keyCode });
      el.dispatchEvent(ev);
    },
    { composing, keyCode },
  );

// Dominios da empresa.
await page.goto(`${ORIGIN}/dominios-empresa`, { waitUntil: 'networkidle' });
const domainInput = 'input[placeholder="empresa.com.br"]';
await page.fill(domainInput, 'nova.com.br');
await imeEnter(domainInput, { composing: true, keyCode: 229 });
await page.waitForTimeout(300);
expect('dominio: Enter compondo (Chrome) nao envia', domainPosts.length === 0, `posts=${domainPosts.length}`);
await imeEnter(domainInput, { composing: false, keyCode: 229 });
await page.waitForTimeout(300);
expect('dominio: Enter 229 do Safari nao envia', domainPosts.length === 0, `posts=${domainPosts.length}`);
await page.press(domainInput, 'Enter');
await page.waitForTimeout(500);
expect('dominio: Enter comum envia', domainPosts.length === 1 && domainPosts[0]?.domain === 'nova.com.br', JSON.stringify(domainPosts));

// Caso: adicionar amostra.
await page.goto(`${ORIGIN}/casos/cs1`, { waitUntil: 'networkidle' });
const caseInput = '#case-add-entry';
const before = state.caseCalls.length;
await page.fill(caseInput, 'e3');
await imeEnter(caseInput, { composing: true, keyCode: 229 });
await imeEnter(caseInput, { composing: false, keyCode: 229 });
await page.waitForTimeout(300);
expect('caso: Enter de composicao nao envia', state.caseCalls.length === before, `calls=${state.caseCalls.length - before}`);
await page.press(caseInput, 'Enter');
await page.waitForTimeout(500);
const last = state.caseCalls.at(-1);
expect(
  'caso: Enter comum adiciona',
  state.caseCalls.length === before + 1 && last?.path === '/api/cases/cs1/entries' && last.body.entryIds?.[0] === 'e3',
  JSON.stringify(last),
);

await browser.close();
console.log(failures ? `${failures} FALHA(S)` : 'tudo ok');
process.exit(failures ? 1 : 0);
