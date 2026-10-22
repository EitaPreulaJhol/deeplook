// API simulada + servidor estatico do build (apps/web/dist) para os testes visuais.
// Nenhum banco/back-end e necessario: o Playwright intercepta todas as requisicoes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// HTTPS: contexto seguro, como em producao (Cloudflare Tunnel). Sem ele o
// navegador nao expoe crypto.subtle e a checagem de duplicata e pulada.
export const ORIGIN = 'https://deeplook.test';
const DIST = '/dist';
export const OUT = '/work/out';
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

const now = '2026-10-20T13:00:00.000Z';

/** Conteudo cujo SHA-256 coincide com o da amostra e1 (teste de duplicata). */
export const DUPLICATE_SAMPLE = Buffer.from('deeplook: amostra repetida para o teste de duplicata');
const DUPLICATE_SHA = createHash('sha256').update(DUPLICATE_SAMPLE).digest('hex');
export const DEFAULT_PREFERENCES = { startPage: 'welcome', pageSize: 50, restoreTabs: true, detailPane: false };

const owner = { id: 'u2', displayName: 'Bruno Lima', email: 'bruno@deeplook.test' };
const users = [
  { id: 'u1', email: 'ana@deeplook.test', displayName: 'Ana Souza', role: 'ADMIN', status: 'ACTIVE', createdAt: '2026-01-15T10:00:00.000Z', _count: { entries: 2 } },
  { id: 'u2', email: 'bruno@deeplook.test', displayName: 'Bruno Lima', role: 'ANALYST', status: 'ACTIVE', createdAt: now, _count: { entries: 5 } },
  { id: 'u3', email: 'carla@deeplook.test', displayName: 'Carla Dias', role: 'USER', status: 'SUSPENDED', createdAt: now, _count: { entries: 0 } },
];
export const entries = [
  { id: 'e1', ownerId: 'u2', owner, type: 'FILE', title: 'instalador_suspeito.exe', description: 'Recebido por e-mail de um remetente desconhecido.\nPede permissão de administrador.', status: 'IN_REVIEW', verdict: 'SUSPICIOUS', originalFilename: 'setup_v2.exe', fileSize: 2483712, mimeType: 'application/x-msdownload', sha256: DUPLICATE_SHA, storageKey: 'k1', createdAt: now, updatedAt: now, tags: [{ id: 't1', name: 'malware' }, { id: 't2', name: 'email' }], _count: { reports: 1 } },
  { id: 'e2', ownerId: 'u2', owner, type: 'URL', title: 'Página de login falsa do banco', status: 'COMPLETED', verdict: 'MALICIOUS', url: 'https://banco-seguro-login.example/acesso', createdAt: '2026-10-19T09:30:00.000Z', updatedAt: now, tags: [{ id: 't3', name: 'phishing' }], _count: { reports: 2 } },
  { id: 'e3', ownerId: 'u1', owner: { id: 'u1', displayName: 'Ana Souza', email: 'ana@deeplook.test' }, type: 'FILE', title: 'relatorio_trimestral.docm', status: 'PENDING', verdict: 'UNKNOWN', originalFilename: 'relatorio_trimestral.docm', fileSize: 88211, mimeType: 'application/vnd.ms-word', sha256: 'aa11', storageKey: 'k3', createdAt: '2026-10-18T16:10:00.000Z', updatedAt: now, tags: [], _count: { reports: 0 } },
  { id: 'e4', ownerId: 'u2', owner, type: 'FILE', title: 'driver_update.msi', status: 'COMPLETED', verdict: 'CLEAN', originalFilename: 'driver_update.msi', fileSize: 1048576, mimeType: 'application/x-msi', sha256: 'bb22', storageKey: 'k4', createdAt: '2026-10-17T08:00:00.000Z', updatedAt: now, tags: [], _count: { reports: 1 } },
];
// Linha do tempo por amostra (GET /api/entries/:id/events); PATCH acrescenta eventos.
const events = Object.fromEntries(
  entries.map((e) => [
    e.id,
    [{ id: `${e.id}-ev0`, entryId: e.id, type: 'CREATED', createdAt: e.createdAt, actor: { id: e.owner.id, displayName: e.owner.displayName } }],
  ]),
);
const actorOf = (u) => ({ id: u.id, displayName: u.displayName });
// Falha de provisionamento do sandbox (autor: sistema) no historico da e4.
events.e4.push({ id: 'e4-fail', entryId: 'e4', type: 'SANDBOX_FAILED', detail: 'Template 9000 nao encontrado no Proxmox', createdAt: now, actor: null });
function pushEvent(entryId, type, fromValue, toValue) {
  const list = events[entryId];
  list.push({ id: `${entryId}-ev${list.length}`, entryId, type, fromValue, toValue, createdAt: new Date().toISOString(), actor: actorOf(users[0]) });
}

const reports = [
  { id: 'r1', entryId: 'e1', analystId: 'u2', analyst: { id: 'u2', displayName: 'Bruno Lima', role: 'ANALYST' }, summary: 'Executável empacotado com UPX; tenta persistir via chave Run.', findings: 'Cria HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater.\nContata domínio recém-registrado.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'SUSPICIOUS', published: true, createdAt: now, updatedAt: now },
];
const keys = [
  { id: 'k1', code: 'DL-AB12-CD34-EF56', role: 'ANALYST', maxUses: 3, usesUsed: 1, expiresAt: '2026-11-19T00:00:00.000Z', revoked: false, createdAt: now },
  { id: 'k2', code: 'DL-ZZ99-YY88-XX77', role: 'USER', maxUses: 1, usesUsed: 1, expiresAt: null, revoked: false, createdAt: now },
  { id: 'k3', code: 'DL-QQ11-WW22-EE33', role: 'USER', maxUses: 5, usesUsed: 0, expiresAt: null, revoked: true, createdAt: now },
];

/** Sessao de sandbox em execucao que expira em `minutes` minutos. */
export function runningSandbox(entryId, minutes) {
  return {
    id: `sb-${entryId}`,
    entryId,
    analystId: 'u1',
    node: 'pve',
    vmid: 9101,
    name: `deeplook-${entryId}`,
    status: 'RUNNING',
    phase: null,
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Estado mutavel da API simulada (os roteiros leem/alteram para conferir efeitos). */
export function createState({ loggedIn = false } = {}) {
  return {
    loggedIn,
    password: 'senha-atual',
    preferences: { ...DEFAULT_PREFERENCES },
    lastLimit: null,
    /** Chamadas de escrita recebidas (metodo + rota), para conferir efeitos. */
    calls: [],
    /** Ambiente isolado por amostra (id da amostra -> sessao), ex.: { e2: {...} }. */
    sandboxes: {},
    /** Resposta de GET /api/me/updates (novidades desde a ultima visita). */
    updates: { since: null, completed: [] },
    /** Query string da ultima exportacao CSV recebida. */
    lastExport: null,
    /** Sessao por inatividade: minutos sem atividade e validade atual (ms). */
    idleMinutes: 30,
    sessionExpiresAt: null,
    /** Relogio da sessao (o roteiro troca pelo relogio falso do navegador). */
    now: async () => Date.now(),
    /** Pasta Favoritos do navegador (visoes salvas e amostras fixadas), em ordem. */
    favorites: [],
    /** Resposta de GET /api/entries/:id/related por amostra (padrao: nenhuma). */
    related: {},
    /** Erro forcado em POST /api/entries/:id/comments (ex.: { status: 429, error }). */
    commentError: null,
  };
}

const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Instala o servidor do dist + API simulada no contexto do navegador. */
export async function setupMock(context, state) {
  const currentUser = () => ({
    ...users[0],
    role: state.role ?? users[0].role,
    preferences: state.preferences,
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    const p = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (p.startsWith('/api/') && req.method() !== 'GET') state.calls.push(`${req.method()} ${p}`);

    if (p.startsWith('/api/')) {
      // Sessao vencida por inatividade: daqui em diante tudo responde 401.
      if (state.loggedIn && state.sessionExpiresAt && state.sessionExpiresAt <= (await state.now())) {
        state.loggedIn = false;
        state.sessionExpiresAt = null;
      }
      const renewSession = async () => {
        state.sessionExpiresAt = (await state.now()) + state.idleMinutes * 60_000;
        return { expiresAt: new Date(state.sessionExpiresAt).toISOString() };
      };
      if (p === '/api/auth/touch') {
        return state.loggedIn ? json(route, 200, await renewSession()) : json(route, 401, { error: 'Sessao expirada.' });
      }
      if (p === '/api/auth/session') {
        if (!state.loggedIn) return json(route, 401, { error: 'Sessao expirada.' });
        if (!state.sessionExpiresAt) return json(route, 200, await renewSession());
        return json(route, 200, { expiresAt: new Date(state.sessionExpiresAt).toISOString() });
      }
      if (p === '/api/auth/me') {
        return state.loggedIn ? json(route, 200, { user: currentUser() }) : json(route, 401, { error: 'Nao autenticado.' });
      }
      if (p === '/api/auth/login') {
        if (body.password !== state.password) return json(route, 401, { error: 'Credenciais invalidas.' });
        state.loggedIn = true;
        await renewSession();
        return json(route, 200, { user: currentUser() });
      }
      if (p === '/api/auth/logout') {
        state.loggedIn = false;
        state.sessionExpiresAt = null;
        return json(route, 200, { ok: true });
      }
      if (!state.loggedIn) return json(route, 401, { error: 'Nao autenticado.' });

      // Favoritos (mesmas regras da API: limite de 30, sem repetir visao/amostra).
      if (p === '/api/me/favorites' && req.method() === 'GET') {
        return json(route, 200, { favorites: state.favorites });
      }
      if (p === '/api/me/favorites' && req.method() === 'POST') {
        if (state.favorites.length >= 30) {
          return json(route, 409, { error: 'Limite de 30 favoritos atingido. Remova algum para adicionar outro.' });
        }
        const label = String(body.label ?? '').trim();
        let favorite;
        if (body.kind === 'VIEW') {
          if (!label || !/^\/(?![/\\])[^\s\\]*$/.test(body.url ?? '')) return json(route, 400, { error: 'Favorito invalido.' });
          const same = state.favorites.find((f) => f.url === body.url);
          if (same) return json(route, 409, { error: `Esta visão já está nos Favoritos como "${same.label}".` });
          favorite = { kind: 'VIEW', label, url: body.url, entryId: null, entry: null };
        } else {
          const entry = entries.find((e) => e.id === body.entryId);
          if (!entry) return json(route, 404, { error: 'Amostra nao encontrada.' });
          if (state.favorites.some((f) => f.entryId === entry.id)) return json(route, 409, { error: 'Esta amostra já está nos Favoritos.' });
          favorite = {
            kind: 'ENTRY',
            label: label || entry.title,
            url: null,
            entryId: entry.id,
            entry: { id: entry.id, title: entry.title, status: entry.status, verdict: entry.verdict },
          };
        }
        favorite = { id: `fav-${Date.now()}-${state.favorites.length}`, position: state.favorites.length, createdAt: new Date().toISOString(), ...favorite };
        state.favorites.push(favorite);
        return json(route, 201, { favorite });
      }
      if (p === '/api/me/favorites/order' && req.method() === 'PUT') {
        const ids = body.ids ?? [];
        if (ids.length !== state.favorites.length || !state.favorites.every((f) => ids.includes(f.id))) {
          return json(route, 400, { error: 'Ordem invalida.' });
        }
        state.favorites = ids.map((id, position) => ({ ...state.favorites.find((f) => f.id === id), position }));
        return json(route, 200, { ok: true });
      }
      const fav = p.match(/^\/api\/me\/favorites\/([\w-]+)$/);
      if (fav) {
        const favorite = state.favorites.find((f) => f.id === fav[1]);
        if (!favorite) return json(route, 404, { error: 'Favorito nao encontrado.' });
        if (req.method() === 'DELETE') {
          state.favorites = state.favorites.filter((f) => f !== favorite);
          return json(route, 200, { ok: true });
        }
        favorite.label = String(body.label ?? '').trim();
        return json(route, 200, { favorite });
      }

      if (p === '/api/me/preferences' && req.method() === 'PATCH') {
        state.preferences = { ...state.preferences, ...body };
        return json(route, 200, { preferences: state.preferences });
      }
      if (p === '/api/me/password') {
        if (body.currentPassword !== state.password) return json(route, 400, { error: 'Senha atual incorreta.' });
        state.password = body.newPassword;
        state.loggedIn = false;
        return json(route, 200, { ok: true });
      }
      if (p === '/api/entries') {
        const sp = url.searchParams;
        state.lastLimit = sp.get('limit');
        let items = sp.get('scope') === 'mine' ? [] : entries;
        const q = (sp.get('q') || '').toLowerCase();
        if (q) items = items.filter((e) => e.title.toLowerCase().includes(q));
        if (sp.get('sha256')) items = entries.filter((e) => e.sha256 === sp.get('sha256'));
        if (sp.get('assignee') === 'me') items = items.filter((e) => e.assignee?.id === 'u1');
        if (sp.get('assignee') === 'none') items = items.filter((e) => !e.assignee);
        for (const k of ['type', 'status', 'verdict']) {
          if (sp.get(k)) items = items.filter((e) => e[k] === sp.get(k));
        }
        return json(route, 200, { total: items.length, limit: Number(sp.get('limit') || 50), offset: 0, items });
      }
      if (p === '/api/me/updates') return json(route, 200, state.updates);
      if (p === '/api/entries/export.csv') {
        state.lastExport = url.search;
        const csv = 'ID;Amostra\r\n' + entries.map((e) => `${e.id};${e.title}`).join('\r\n');
        return route.fulfill({
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="deeplook-amostras-20261021.csv"',
          },
          body: csv,
        });
      }
      if (p === '/api/entries/bulk' && req.method() === 'POST') {
        const targets = entries.filter((e) => body.ids.includes(e.id));
        for (const e of targets) {
          const { assigneeId, ...rest } = body.patch;
          for (const [key, type] of [['status', 'STATUS_CHANGED'], ['verdict', 'VERDICT_CHANGED']]) {
            if (rest[key] && rest[key] !== e[key]) pushEvent(e.id, type, e[key], rest[key]);
          }
          Object.assign(e, rest);
          if (assigneeId !== undefined) {
            const next = assigneeId ? actorOf(users.find((u) => u.id === assigneeId)) : null;
            pushEvent(e.id, 'ASSIGNED', e.assignee?.displayName ?? null, next?.displayName ?? null);
            e.assignee = next;
          }
        }
        return json(route, 200, { updated: targets.length, notFound: [] });
      }
      if (p === '/api/entries/counts') {
        const counts = { PENDING: 0, IN_REVIEW: 0, COMPLETED: 0 };
        for (const e of entries) counts[e.status] += 1;
        const mine = entries.filter((e) => e.assignee?.id === 'u1' && e.status !== 'COMPLETED').length;
        return json(route, 200, { counts, mine });
      }
      let m = p.match(/^\/api\/entries\/(\w+)\/sandbox$/);
      if (m) {
        return json(route, 200, {
          enabled: true,
          consoleEnabled: true,
          session: state.sandboxes[m[1]] ?? null,
        });
      }
      m = p.match(/^\/api\/sandbox\/([\w-]+)\/extend$/);
      if (m) {
        const session = Object.values(state.sandboxes).find((x) => x.id === m[1]);
        session.expiresAt = new Date(new Date(session.expiresAt).getTime() + 30 * 60_000).toISOString();
        return json(route, 200, { session });
      }
      m = p.match(/^\/api\/entries\/(\w+)$/);
      if (m && req.method() === 'PATCH') {
        const e = entries.find((x) => x.id === m[1]);
        const { assigneeId, ...rest } = body;
        for (const [key, type] of [['status', 'STATUS_CHANGED'], ['verdict', 'VERDICT_CHANGED']]) {
          if (rest[key] && rest[key] !== e[key]) pushEvent(e.id, type, e[key], rest[key]);
        }
        Object.assign(e, rest);
        if (assigneeId !== undefined) {
          const next = assigneeId ? actorOf(users.find((u) => u.id === assigneeId)) : null;
          pushEvent(e.id, 'ASSIGNED', e.assignee?.displayName ?? null, next?.displayName ?? null);
          e.assignee = next;
        }
        return json(route, 200, { entry: e });
      }
      const rel = p.match(/^\/api\/entries\/([\w-]+)\/related$/);
      if (rel) return json(route, 200, state.related[rel[1]] ?? { items: [], total: 0, limit: 50 });
      // Novo relatorio (aba Relatorios): so confirma o salvamento.
      if (/^\/api\/entries\/[\w-]+\/reports$/.test(p) && req.method() === 'POST') {
        return json(route, 201, { report: { id: `r-${Date.now()}`, ...body } });
      }
      const cm = p.match(/^\/api\/entries\/([\w-]+)\/comments$/);
      if (cm && req.method() === 'POST') {
        if (state.commentError) return json(route, state.commentError.status, { error: state.commentError.error });
        const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
        if (!text || text.length > 4000) return json(route, 400, { error: 'Escreva a atualização (até 4000 caracteres).' });
        const list = events[cm[1]];
        if (!list) return json(route, 404, { error: 'Amostra nao encontrada.' });
        const event = { id: `${cm[1]}-ev${list.length}`, entryId: cm[1], type: 'COMMENT', detail: text, createdAt: new Date().toISOString(), actor: actorOf(users[0]) };
        list.push(event);
        return json(route, 201, { event });
      }
      const ev = p.match(/^\/api\/entries\/(\w+)\/events$/);
      if (ev) return json(route, 200, { events: events[ev[1]] ?? [] });
      if (m) {
        const e = entries.find((x) => x.id === m[1]);
        return e
          ? json(route, 200, { entry: { ...e, reports: e.id === 'e1' ? reports : [] } })
          : json(route, 404, { error: 'Nao encontrado.' });
      }
      if (p === '/api/analysts') {
        return json(route, 200, {
          analysts: users.filter((u) => u.role !== 'USER' && u.status === 'ACTIVE').map(actorOf),
        });
      }
      if (p === '/api/admin/users') return json(route, 200, { users });
      m = p.match(/^\/api\/admin\/users\/(\w+)\/reset-password$/);
      if (m) return json(route, 200, { temporaryPassword: 'k7Tm-Q2xa-9PwR' });
      m = p.match(/^\/api\/admin\/users\/(\w+)$/);
      if (m && req.method() === 'PATCH') {
        const u = users.find((x) => x.id === m[1]);
        Object.assign(u, body);
        return json(route, 200, { user: u });
      }
      m = p.match(/^\/api\/admin\/activation-keys\/(\w+)$/);
      if (m && req.method() === 'DELETE') {
        keys.find((x) => x.id === m[1]).revoked = true;
        return json(route, 200, { ok: true });
      }
      if (p === '/api/admin/activation-keys') return json(route, 200, { keys });
      return json(route, 404, { error: 'Mock sem rota: ' + p });
    }

    let file = join(DIST, decodeURIComponent(p));
    if (p === '/' || !existsSync(file) || !extname(file)) file = join(DIST, 'index.html');
    return route.fulfill({
      status: 200,
      contentType: MIME[extname(file)] || 'application/octet-stream',
      body: readFileSync(file),
    });
  });
}

/** Registra erros da pagina no console do roteiro (tela branca = erro de render). */
export function watchErrors(page) {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  page.on('console', (msg) => msg.type() === 'error' && console.log('CONSOLE:', msg.text().slice(0, 300)));
}
