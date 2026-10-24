// Captura da pagina de um link (80): secao so em links, Capturar pagina (em
// andamento -> concluida por consulta periodica), print, endereco final como
// texto (nunca link), redirecionamentos, certificado, bloqueados, HTML so como
// texto para baixar, falha com o motivo, anteriores, desligada, usuario comum so
// ve e historico.
import { chromium } from 'playwright';

import { createState, events, EVIDENCE_PNG, ORIGIN, OUT, setupMock, watchErrors } from './mock-api.mjs';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const state = createState({ loggedIn: true });
await setupMock(context, state);

const store = { enabled: true, captures: [], polls: 0, next: 'done' };
const posts = [];
const done = (id, extra = {}) => ({
  id,
  status: 'DONE',
  url: 'https://banco-seguro-login.example/acesso',
  finalUrl: 'https://login.banco-falso.example/entrar?sessao=1',
  title: 'Banco Seguro - Acesso',
  httpStatus: 200,
  redirects: [
    { url: 'https://banco-seguro-login.example/acesso', status: 302 },
    { url: 'https://encurta.example/x', status: 301 },
    { url: 'https://login.banco-falso.example/entrar?sessao=1', status: 200 },
  ],
  certificate: { subject: 'login.banco-falso.example', issuer: "Let's Encrypt R11", protocol: 'TLS 1.3', validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-12-30T00:00:00.000Z' },
  blocked: [
    { host: '169.254.169.254', reason: '169.254.169.254 aponta para endereço interno (169.254.169.254)' },
    { host: '10.0.0.5', reason: '10.0.0.5 aponta para endereço interno (10.0.0.5)' },
  ],
  htmlTruncated: false,
  error: null,
  createdAt: '2026-10-24T12:00:00.000Z',
  finishedAt: '2026-10-24T12:00:05.000Z',
  requestedBy: { id: 'u1', displayName: 'Ana Souza' },
  ...extra,
});
await context.route((url) => url.pathname.startsWith('/api/captures/') || /^\/api\/entries\/\w+\/captures?$/.test(url.pathname), async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (path.endsWith('/screenshot')) return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from(EVIDENCE_PNG, 'base64') });
  if (path.endsWith('/html')) return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="captura.html.txt"' }, body: '<html>...</html>' });
  if (req.method() === 'POST') {
    posts.push(path);
    const id = `cap${store.captures.length + 1}`;
    store.captures.unshift({ ...done(id), status: 'PENDING', finalUrl: null, title: null, httpStatus: null, redirects: null, certificate: null, blocked: null, finishedAt: null });
    store.polls = 0;
    return json(202, { capture: store.captures[0] });
  }
  if (!path.startsWith('/api/entries/e2/')) return json(200, { captures: [], enabled: store.enabled });
  // A pendente conclui na segunda consulta.
  const pending = store.captures.find((c) => c.status === 'PENDING');
  if (pending && ++store.polls >= 2) {
    Object.assign(
      pending,
      store.next === 'done'
        ? done(pending.id)
        : { status: 'FAILED', error: 'a página não respondeu em 20 s', finishedAt: '2026-10-24T12:01:00.000Z', blocked: [] },
    );
  }
  return json(200, { captures: store.captures, enabled: store.enabled });
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};
const settle = (ms = 400) => page.waitForTimeout(ms);
const section = page.locator('.hpsm-section', { hasText: 'Captura da página' });
const button = section.locator('.hpsm-toolbar__action').first();
const field = (label) => section.locator('.hpsm-field', { has: page.locator(`.hpsm-field__label:text-is("${label}:")`) });

// 1. So em links; vazia com o botao.
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('seção no link', (await section.count()) === 1);
expect('vazia explica e oferece capturar', (await section.innerText()).includes('Nenhuma captura') && (await button.innerText()).trim() === 'Capturar página');

// 2. Capturar: em andamento e concluida.
await button.click();
await settle(300);
expect('pede a captura', posts.at(-1) === '/api/entries/e2/capture');
expect('em andamento', (await button.innerText()).trim() === 'Capturando...' && (await button.isDisabled()));
await page.waitForSelector('.dl-capture__shot img', { timeout: 10_000 });
await settle(300);
expect('concluída sem recarregar', (await button.innerText()).trim() === 'Capturar de novo');
expect('print carregado', (await page.locator('.dl-capture__shot img').evaluate((img) => img.naturalWidth)) === 40);
expect('título e HTTP', (await field('Título').innerText()).includes('Banco Seguro - Acesso') && (await field('Resposta').innerText()).includes('HTTP 200'));
const finalText = await field('Endereço final').innerText();
expect('endereço final como texto', finalText.includes('https://login.banco-falso.example/entrar?sessao=1') && (await field('Endereço final').locator('a').count()) === 0, finalText);
const chain = await section.locator('.dl-capture__chain li').allInnerTexts();
expect('cadeia de redirecionamentos', chain.length === 3 && chain[0].includes('(302)') && chain[2].includes('(200)'), chain.join(' | '));
expect('nenhum endereço da página vira link', (await section.locator('a[href^="https://"]').count()) === 0);
const cert = await section.locator('.hpsm-field', { hasText: 'Certificado' }).innerText();
expect('certificado', cert.includes("login.banco-falso.example · emitido por Let's Encrypt R11 · TLS 1.3 · válido de 01/10/2026 a 30/12/2026"), cert);
expect('bloqueados', (await section.locator('.dl-capture__blocked li').count()) === 2 && (await section.innerText()).includes('Bloqueados (2)'));
const html = section.locator('a:has-text("Baixar HTML (texto)")');
expect('HTML só para baixar', (await html.getAttribute('href')) === '/api/captures/cap1/html' && (await html.getAttribute('target')) === null);
await page.screenshot({ path: `${OUT}/captura.png`, fullPage: true });

// 3. Nova captura que falha; a anterior fica na lista.
store.next = 'fail';
await button.click();
await page.waitForFunction(() => document.body.innerText.includes('falhou'), null, { timeout: 10_000 });
const msgs = (await page.locator('.hpsm-msg__text').allInnerTexts()).join(' | ');
expect('falha com o motivo', msgs.includes('falhou: a página não respondeu em 20 s'), msgs);
expect('capturas anteriores', (await section.locator('.dl-capture__older summary').innerText()).includes('Capturas anteriores (1)'));

// 4. Historico.
events.e2.push({ id: 'e2-cap', entryId: 'e2', type: 'PAGE_CAPTURED', fromValue: null, toValue: '200', detail: '2 redirecionamento(s)', createdAt: '2026-10-24T12:00:05.000Z', actor: { id: 'u1', displayName: 'Ana Souza' } });
await page.goto(ORIGIN + '/entries/e2?tab=historico', { waitUntil: 'networkidle' });
const ev = await page.locator('.hpsm-tabpanel:not([hidden]) tbody tr', { hasText: 'Página capturada' }).innerText();
expect('histórico da captura', ev.includes('Página capturada no navegador isolado (HTTP 200, 2 redirecionamento(s))'), ev);

// 5. Arquivo nao tem a secao; desligada e sem capturas some.
await page.goto(ORIGIN + '/entries/e1', { waitUntil: 'networkidle' });
expect('arquivo sem a seção', (await section.count()) === 0);
store.enabled = false;
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('desligada: some o botão, ficam as capturas', (await section.count()) === 1 && (await section.locator('.hpsm-toolbar__action').count()) === 0);

// 6. Usuario comum ve, mas nao captura.
store.enabled = true;
state.role = 'USER';
await page.goto(ORIGIN + '/entries/e2', { waitUntil: 'networkidle' });
expect('usuário comum vê sem o botão', (await section.count()) === 1 && (await section.locator('.hpsm-toolbar__action').count()) === 0);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncaptura da página: tudo ok');
process.exit(failures ? 1 : 0);
