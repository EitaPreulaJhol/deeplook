// Varredura visual da interface: todas as telas (rotas e abas internas) em varias resolucoes, com
// a API simulada. Para cada tela: o print de pagina inteira e checagens automaticas no navegador:
// rolagem horizontal, texto cortado (com e sem reticencias), botao/aba com o texto quebrado em mais
// de uma linha, controles sobrepostos, elemento vazando do conteiner, imagem quebrada ou distorcida
// e erros do console. Nao reprova: gera out/sweep/<largura>x<altura>/<tela>.png e o relatorio
// out/sweep/report.json (o resumo vai para a saida).
//
//   sh run-all.sh sweep                      (no container do Playwright, como os cenarios)
//   SWEEP_SIZES=1366x768 SWEEP_ONLY=admin    so uma resolucao / so as telas com "admin" no nome
//   SWEEP_LANG=en                            a interface em ingles (prints em out/sweep/<LxA>-en)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { createState, entries, ORIGIN, OUT, runningSandbox, setupMock, users } from './mock-api.mjs';

const SIZES = (process.env.SWEEP_SIZES || '1440x900,1366x768,1280x720,1024x768')
  .split(',')
  .map((s) => s.split('x').map(Number));
const ONLY = process.env.SWEEP_ONLY || '';
/** SWEEP_LANG=en: a interface em ingles (textos mais longos). */
const LANG = process.env.SWEEP_LANG || '';

// ------------------------------------------------------------------ dados de exemplo

function seed(state) {
  const at = '2026-10-24T09:00:00.000Z';
  const ana = { id: 'u1', displayName: 'Ana Souza' };
  const e1 = entries.find((e) => e.id === 'e1');
  const e2 = entries.find((e) => e.id === 'e2');
  const ce = (e, reports = []) => ({
    addedAt: at,
    addedBy: ana,
    entry: { id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: 'P3', createdAt: e.createdAt, sha256: e.sha256 ?? null, url: e.url ?? null, reports },
  });
  const event = (id, type, extra = {}) => ({ id, type, detail: null, fromValue: null, toValue: null, createdAt: at, actor: ana, entry: null, ...extra });
  state.cases = [
    {
      id: 'cs1', number: 1, code: 'CASO-0001', title: 'Campanha do boleto', description: 'Phishing com instalador.', status: 'IN_PROGRESS',
      createdAt: at, updatedAt: at, closedAt: null, assignee: ana, createdBy: ana,
      entries: [
        ce(e1, [{ id: 'r1', summary: 'Baixa o segundo estágio.', findings: 'Persiste via chave Run.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'MALICIOUS', updatedAt: at, analyst: { id: 'u2', displayName: 'Bruno Lima' }, attackTechniques: ['T1059.001'], evidence: [] }]),
        ce(e2),
      ],
      events: [event('ev1', 'CREATED', { detail: 'Campanha do boleto' }), event('ev3', 'COMMENT', { detail: 'Mesmo remetente nas duas.' })],
    },
  ];
  state.caseIocs.cs1 = [
    { kind: 'SHA256', value: e1.sha256, source: 'SAMPLE', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }] },
    { kind: 'IPV4', value: '185.0.2.10', source: 'REPORT', entries: [{ id: 'e1', title: e1.title, verdict: e1.verdict }] },
  ];
  state.kbArticles.push({
    id: 'kb2', title: 'Golpe do falso boleto', summary: 'Boleto adulterado.', category: 'SCAM', tags: ['boleto'], body: 'Confira o beneficiário.',
    createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z', createdBy: { id: 'u2', displayName: 'Bruno Lima' }, updatedBy: { id: 'u2', displayName: 'Bruno Lima' },
    canDelete: false, revisions: [], reports: [], citations: 1,
  });
  state.sandboxes.e1 = runningSandbox('e1', 40);
}

// ------------------------------------------------------------------ telas

const entryTabs = ['detalhes', 'analise', 'relatorios', 'relacionadas', 'mapa', 'historico'];
const userTabs = ['dados', 'senha', 'preferencias', 'notificacoes', '2fa', 'sessoes', 'indicadores', 'tokens'];
const adminTabs = ['users', 'keys', 'tokens', 'templates', 'status', 'audit', 'trash', 'backup', 'settings'];

const SCREENS = [
  { name: 'login', path: '/login', loggedOut: true },
  { name: 'cadastro', path: '/register', loggedOut: true },
  { name: 'troca-de-senha', path: '/inicio', mustChange: true },
  { name: 'inicio', path: '/inicio' },
  { name: 'enviar-amostra', path: '/submit' },
  { name: 'historico-global', path: '/history' },
  { name: 'meus-uploads', path: '/me' },
  { name: 'caixa-de-entrada', path: '/inbox' },
  { name: 'busca', path: '/busca?q=boleto' },
  { name: 'painel', path: '/painel' },
  { name: 'revisoes', path: '/revisoes' },
  { name: 'comparar', path: '/comparar?a=e1&b=e4' },
  { name: 'indicadores-permitidos', path: '/permitidos' },
  { name: 'atribuicao', path: '/atribuicao' },
  { name: 'gerencial', path: '/gerencial' },
  { name: 'gerencial-impressao', path: '/gerencial/imprimir' },
  { name: 'avisos', path: '/avisos' },
  { name: 'dominios-empresa', path: '/dominios-empresa' },
  { name: 'regras-triagem', path: '/regras-triagem' },
  { name: 'yara', path: '/yara' },
  { name: 'casos', path: '/casos' },
  { name: 'caso', path: '/casos/cs1' },
  { name: 'caso-impressao', path: '/casos/cs1/imprimir' },
  { name: 'kb', path: '/kb' },
  { name: 'kb-artigo', path: '/kb/kb2' },
  { name: 'kb-edicao', path: '/kb/kb2/editar' },
  { name: 'kb-novo', path: '/kb/novo' },
  { name: 'ioc', path: '/iocs/domain/updater-cdn.example' },
  { name: 'api-docs', path: '/user/api' },
  ...entryTabs.map((tab) => ({ name: `amostra-arquivo-${tab}`, path: `/entries/e1?tab=${tab}` })),
  ...entryTabs.slice(0, 3).map((tab) => ({ name: `amostra-link-${tab}`, path: `/entries/e2?tab=${tab}` })),
  { name: 'amostra-impressao', path: '/entries/e1/imprimir' },
  { name: 'console-sandbox', path: '/sandbox/entry/e1/console' },
  ...userTabs.map((tab) => ({ name: `conta-${tab}`, path: `/user?tab=${tab}` })),
  ...adminTabs.map((tab) => ({ name: `admin-${tab}`, path: `/admin?tab=${tab}` })),
].filter((s) => !ONLY || s.name.includes(ONLY));

// ------------------------------------------------------------------ checagens no navegador

function inspect() {
  const out = [];
  const add = (type, el, detail) => out.push({ type, el, detail });
  const root = document.documentElement;
  const vw = root.clientWidth;
  if (root.scrollWidth > vw + 1) add('rolagem-horizontal', 'html', `${root.scrollWidth}px > ${vw}px`);

  const shown = (el) => {
    // Rotulos so para leitor de tela: escondidos de proposito.
    if (el.closest('.cds--visually-hidden, .dl-sr-only, .sr-only')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} "${text}"`;
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  /** Linhas de texto do elemento (pelos retangulos dos nos de texto). */
  const lines = (el) => {
    const tops = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 2) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < 4)) tops.push(r.top);
      }
    }
    return tops.length;
  };

  // 1. Texto cortado: o conteudo passa da caixa (com reticencias, sem, ou vazando).
  for (const el of document.querySelectorAll('body *')) {
    if (!ownText(el) || !shown(el)) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.display !== 'inline') {
      const kind = cs.textOverflow === 'ellipsis' ? 'reticencias' : cs.overflowX === 'visible' ? 'texto-vazando' : 'texto-cortado';
      add(kind, label(el), `${el.scrollWidth}px em ${el.clientWidth}px`);
    }
    if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && ['hidden', 'clip'].includes(cs.overflowY) && cs.display !== 'inline') {
      add('texto-cortado-vertical', label(el), `${el.scrollHeight}px em ${el.clientHeight}px`);
    }
  }

  // 2. Botao, aba, item de barra e etiqueta com o texto em mais de uma linha.
  const singleLine = 'button, .cds--btn, [role=tab], .hpsm-tab, .hpsm-toolbar__action, .cds--tag, .hpsm-tree__leaf, label.cds--label, .dl-summary span';
  for (const el of document.querySelectorAll(singleLine)) {
    if (!shown(el)) continue;
    const n = lines(el);
    if (n > 1) add('quebra-de-linha', label(el), `${n} linhas`);
  }
  for (const el of document.querySelectorAll('th')) {
    if (shown(el) && lines(el) > 1) add('cabecalho-quebrado', label(el), `${lines(el)} linhas`);
  }

  // 3. Controles sobrepostos (entre irmaos).
  const controls = [...document.querySelectorAll('button, a, input, select, textarea, [role=button], .cds--tag')].filter(shown);
  const byParent = new Map();
  for (const el of controls) {
    const p = el.parentElement;
    byParent.set(p, [...(byParent.get(p) ?? []), el]);
  }
  for (const list of byParent.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].getBoundingClientRect();
        const b = list[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) add('sobreposicao', `${label(list[i])} × ${label(list[j])}`, `${Math.round(w)}x${Math.round(h)}px`);
      }
    }
  }

  // 4. Elemento que passa da borda direita do conteiner que o recorta (ou da tela).
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
      let clip = el.parentElement;
      let clipped = false;
      while (clip && clip !== document.body) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(clip).overflowX)) {
          clipped = true;
          break;
        }
        clip = clip.parentElement;
      }
      if (!clipped) add('fora-da-tela', label(el), `direita em ${Math.round(r.right)}px, tela ${vw}px`);
    }
  }

  // 5. Imagens quebradas ou distorcidas.
  for (const img of document.querySelectorAll('img')) {
    if (!shown(img)) continue;
    if (img.complete && img.naturalWidth === 0) add('imagem-quebrada', label(img), img.src.slice(0, 80));
    else if (img.naturalWidth && img.naturalHeight) {
      const fit = getComputedStyle(img).objectFit;
      const r = img.getBoundingClientRect();
      const natural = img.naturalWidth / img.naturalHeight;
      const shownRatio = r.width / r.height;
      if (!['cover', 'contain', 'scale-down'].includes(fit) && Math.abs(natural - shownRatio) / natural > 0.04) {
        add('imagem-distorcida', label(img), `proporção ${natural.toFixed(2)} exibida em ${shownRatio.toFixed(2)}`);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ principal

const report = [];
const browser = await chromium.launch();
for (const [width, height] of SIZES) {
  const dir = `${OUT}/sweep/${width}x${height}${LANG ? `-${LANG}` : ''}`;
  mkdirSync(dir, { recursive: true });
  for (const screen of SCREENS) {
    const state = createState({ loggedIn: !screen.loggedOut });
    seed(state);
    const original = users[0].mustChangePassword;
    if (screen.mustChange) users[0].mustChangePassword = true;
    const context = await browser.newContext({ viewport: { width, height } });
    if (LANG) {
      state.preferences.language = LANG;
      await context.addInitScript((lang) => window.localStorage.setItem('dl-locale', lang), LANG);
    }
    await setupMock(context, state);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message.slice(0, 160)}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text().slice(0, 160)}`));
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 400 && res.status() !== 401) {
        errors.push(`api ${res.status()}: ${new URL(res.url()).pathname}`);
      }
    });
    try {
      await page.goto(ORIGIN + screen.path, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const issues = await page.evaluate(inspect);
      await page.screenshot({ path: `${dir}/${screen.name}.png`, fullPage: true });
      report.push({ size: `${width}x${height}`, screen: screen.name, path: screen.path, issues, errors });
    } catch (err) {
      report.push({ size: `${width}x${height}`, screen: screen.name, path: screen.path, issues: [], errors: [`falhou: ${err.message.slice(0, 200)}`] });
    }
    users[0].mustChangePassword = original;
    await context.close();
  }
}
await browser.close();

writeFileSync(`${OUT}/sweep/report.json`, JSON.stringify(report, null, 2));
// Resumo: por tipo, agrupando o mesmo problema nas varias resolucoes.
const grouped = new Map();
for (const r of report) {
  for (const i of r.issues) {
    const key = `${i.type} | ${r.screen} | ${i.el}`;
    const g = grouped.get(key) ?? { ...i, screen: r.screen, sizes: [] };
    g.sizes.push(r.size);
    grouped.set(key, g);
  }
  for (const e of r.errors) {
    const key = `erro | ${r.screen} | ${e}`;
    const g = grouped.get(key) ?? { type: 'erro', el: e, screen: r.screen, sizes: [] };
    g.sizes.push(r.size);
    grouped.set(key, g);
  }
}
const rows = [...grouped.values()].sort((a, b) => a.type.localeCompare(b.type) || a.screen.localeCompare(b.screen));
for (const g of rows) console.log(`${g.type} | ${g.screen} | ${g.el} | ${g.detail ?? ''} | ${g.sizes.join(' ')}`);
console.log(`\n${SCREENS.length} telas × ${SIZES.length} resoluções · ${rows.length} achado(s) distintos`);
