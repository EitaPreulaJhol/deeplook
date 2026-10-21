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
export const DEFAULT_PREFERENCES = { startPage: 'welcome', pageSize: 50, restoreTabs: true };

const owner = { id: 'u2', displayName: 'Bruno Lima', email: 'bruno@deeplook.test' };
const users = [
  { id: 'u1', email: 'ana@deeplook.test', displayName: 'Ana Souza', role: 'ADMIN', status: 'ACTIVE', createdAt: '2026-01-15T10:00:00.000Z', _count: { entries: 2 } },
  { id: 'u2', email: 'bruno@deeplook.test', displayName: 'Bruno Lima', role: 'ANALYST', status: 'ACTIVE', createdAt: now, _count: { entries: 5 } },
  { id: 'u3', email: 'carla@deeplook.test', displayName: 'Carla Dias', role: 'USER', status: 'SUSPENDED', createdAt: now, _count: { entries: 0 } },
];
const entries = [
  { id: 'e1', ownerId: 'u2', owner, type: 'FILE', title: 'instalador_suspeito.exe', description: 'Recebido por e-mail de um remetente desconhecido.\nPede permissão de administrador.', status: 'IN_REVIEW', verdict: 'SUSPICIOUS', originalFilename: 'setup_v2.exe', fileSize: 2483712, mimeType: 'application/x-msdownload', sha256: DUPLICATE_SHA, storageKey: 'k1', createdAt: now, updatedAt: now, tags: [{ id: 't1', name: 'malware' }, { id: 't2', name: 'email' }], _count: { reports: 1 } },
  { id: 'e2', ownerId: 'u2', owner, type: 'URL', title: 'Página de login falsa do banco', status: 'COMPLETED', verdict: 'MALICIOUS', url: 'https://banco-seguro-login.example/acesso', createdAt: '2026-10-19T09:30:00.000Z', updatedAt: now, tags: [{ id: 't3', name: 'phishing' }], _count: { reports: 2 } },
  { id: 'e3', ownerId: 'u1', owner: { id: 'u1', displayName: 'Ana Souza', email: 'ana@deeplook.test' }, type: 'FILE', title: 'relatorio_trimestral.docm', status: 'PENDING', verdict: 'UNKNOWN', originalFilename: 'relatorio_trimestral.docm', fileSize: 88211, mimeType: 'application/vnd.ms-word', sha256: 'aa11', storageKey: 'k3', createdAt: '2026-10-18T16:10:00.000Z', updatedAt: now, tags: [], _count: { reports: 0 } },
  { id: 'e4', ownerId: 'u2', owner, type: 'FILE', title: 'driver_update.msi', status: 'COMPLETED', verdict: 'CLEAN', originalFilename: 'driver_update.msi', fileSize: 1048576, mimeType: 'application/x-msi', sha256: 'bb22', storageKey: 'k4', createdAt: '2026-10-17T08:00:00.000Z', updatedAt: now, tags: [], _count: { reports: 1 } },
];
const reports = [
  { id: 'r1', entryId: 'e1', analystId: 'u2', analyst: { id: 'u2', displayName: 'Bruno Lima', role: 'ANALYST' }, summary: 'Executável empacotado com UPX; tenta persistir via chave Run.', findings: 'Cria HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater.\nContata domínio recém-registrado.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'SUSPICIOUS', published: true, createdAt: now, updatedAt: now },
];
const keys = [
  { id: 'k1', code: 'DL-AB12-CD34-EF56', role: 'ANALYST', maxUses: 3, usesUsed: 1, expiresAt: '2026-11-19T00:00:00.000Z', revoked: false, createdAt: now },
  { id: 'k2', code: 'DL-ZZ99-YY88-XX77', role: 'USER', maxUses: 1, usesUsed: 1, expiresAt: null, revoked: false, createdAt: now },
  { id: 'k3', code: 'DL-QQ11-WW22-EE33', role: 'USER', maxUses: 5, usesUsed: 0, expiresAt: null, revoked: true, createdAt: now },
];

/** Estado mutavel da API simulada (os roteiros leem/alteram para conferir efeitos). */
export function createState({ loggedIn = false } = {}) {
  return {
    loggedIn,
    password: 'senha-atual',
    preferences: { ...DEFAULT_PREFERENCES },
    lastLimit: null,
    /** Chamadas de escrita recebidas (metodo + rota), para conferir efeitos. */
    calls: [],
  };
}

const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Instala o servidor do dist + API simulada no contexto do navegador. */
export async function setupMock(context, state) {
  const currentUser = () => ({ ...users[0], preferences: state.preferences });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    const p = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (p.startsWith('/api/') && req.method() !== 'GET') state.calls.push(`${req.method()} ${p}`);

    if (p.startsWith('/api/')) {
      if (p === '/api/auth/me') {
        return state.loggedIn ? json(route, 200, { user: currentUser() }) : json(route, 401, { error: 'Nao autenticado.' });
      }
      if (p === '/api/auth/login') {
        if (body.password !== state.password) return json(route, 401, { error: 'Credenciais invalidas.' });
        state.loggedIn = true;
        return json(route, 200, { user: currentUser() });
      }
      if (p === '/api/auth/logout') {
        state.loggedIn = false;
        return json(route, 200, { ok: true });
      }
      if (!state.loggedIn) return json(route, 401, { error: 'Nao autenticado.' });

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
        for (const k of ['type', 'status', 'verdict']) {
          if (sp.get(k)) items = items.filter((e) => e[k] === sp.get(k));
        }
        return json(route, 200, { total: items.length, limit: Number(sp.get('limit') || 50), offset: 0, items });
      }
      let m = p.match(/^\/api\/entries\/(\w+)\/sandbox$/);
      if (m) return json(route, 200, { enabled: true, consoleEnabled: true, session: null });
      m = p.match(/^\/api\/entries\/(\w+)$/);
      if (m && req.method() === 'PATCH') {
        const e = entries.find((x) => x.id === m[1]);
        Object.assign(e, body);
        return json(route, 200, { entry: e });
      }
      if (m) {
        const e = entries.find((x) => x.id === m[1]);
        return e
          ? json(route, 200, { entry: { ...e, reports: e.id === 'e1' ? reports : [] } })
          : json(route, 404, { error: 'Nao encontrado.' });
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
