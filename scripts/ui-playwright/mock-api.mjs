// API simulada + servidor estatico do build (apps/web/dist) para os testes visuais.
// Nenhum banco/back-end e necessario: o Playwright intercepta todas as requisicoes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// HTTPS: contexto seguro, como em producao (Cloudflare Tunnel). Sem ele o
// navegador nao expoe crypto.subtle e a checagem de duplicata e pulada.
export const ORIGIN = 'https://deeplook.test';
// Os caminhos absolutos sao os do container dos testes de tela; a suite visual roda de dentro
// do repositorio e aponta os mesmos lugares por variavel de ambiente.
const DIST = process.env.DIST_DIR || '/dist';
/** A CSP de producao (nginx.conf) vale nos testes: tela que a viole falha o cenario. */
const CSP = /add_header Content-Security-Policy "([^"]+)"/.exec(
  readFileSync(process.env.NGINX_CONF || '/nginx.conf', 'utf8'),
)[1];
let cspViolations = 0;
process.on('exit', () => {
  if (cspViolations) process.exitCode = 1;
});
export const OUT = process.env.OUT_DIR || '/work/out';
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
export const DEFAULT_PREFERENCES = { startPage: 'welcome', pageSize: 50, restoreTabs: true, detailPane: false, closedFolders: [], mutedNotifications: [] };

/** Tipos de aviso por papel e os que nao se silenciam (apps/api/src/lib/notification-types.ts). */
const NOTIFICATION_TYPES = [
  ['ASSIGNED', 'analyst', true], ['COMPLETED', 'all', false], ['MENTION', 'all', false], ['COMMENT', 'all', false],
  ['REPORT_APPROVED', 'analyst', false], ['REPORT_RETURNED', 'analyst', true], ['IOC_SEEN', 'all', false],
  ['SLA_WARN', 'analyst', false], ['SLA_LATE', 'analyst', true], ['RESOLUTION', 'all', true],
  ['CASE_MENTION', 'analyst', false], ['CASE_COMMENT', 'analyst', false], ['CASE_ENTRY_ADDED', 'analyst', false],
  ['CASE_ENTRY_REMOVED', 'analyst', false], ['CASE_ASSIGNED', 'analyst', true], ['YARA_PACK_UPDATE', 'admin', true],
];

const owner = { id: 'u2', displayName: 'Bruno Lima', email: 'bruno@deeplook.test' };
export const users = [
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
// Prazo (SLA): limites da API e a idade de cada amostra no status atual.
export const SLA = {
  warnHours: 24,
  lateHours: 72,
  byPriority: {
    P1: { warnHours: 2, lateHours: 4 },
    P2: { warnHours: 8, lateHours: 24 },
    P3: { warnHours: 24, lateHours: 72 },
    P4: { warnHours: 72, lateHours: 120 },
  },
};
/** Limites da amostra pela prioridade dela (padrao P3). */
const limitsOf = (e) => SLA.byPriority[e.priority ?? 'P3'];
/**
 * Instante base das idades ("ha 30 h"). O padrao e agora; a suite visual congela o relogio do
 * navegador (DL_NOW) e precisa que os dados usem o mesmo instante, senao o texto das horas
 * muda a cada hora e a captura nunca casa.
 */
const NOW = process.env.DL_NOW ? Date.parse(process.env.DL_NOW) : Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const STATUS_AGE_HOURS = { e1: 30, e2: 200, e3: 100, e4: 300 };
for (const e of entries) e.statusChangedAt = hoursAgo(STATUS_AGE_HOURS[e.id] ?? 1);
/** Nao concluida ha mais de N horas no status atual. */
const olderThan = (e, hours) => e.status !== 'COMPLETED' && Date.parse(e.statusChangedAt) < NOW - hours * 3600 * 1000;

// Linha do tempo por amostra (GET /api/entries/:id/events); PATCH acrescenta eventos.
export const events = Object.fromEntries(
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

export const reports = [
  { id: 'r1', entryId: 'e1', analystId: 'u2', analyst: { id: 'u2', displayName: 'Bruno Lima', role: 'ANALYST' }, summary: 'Executável empacotado com UPX; tenta persistir via chave Run.', findings: 'Cria HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\updater.\nContata domínio recém-registrado.', iocs: 'updater-cdn.example\n185.0.2.10', verdict: 'SUSPICIOUS', status: 'PUBLISHED', createdAt: now, updatedAt: now },
];
const keys = [
  { id: 'k1', code: 'DL-AB12-CD34-EF56', role: 'ANALYST', maxUses: 3, usesUsed: 1, expiresAt: '2026-11-19T00:00:00.000Z', revoked: false, createdAt: now },
  { id: 'k2', code: 'DL-ZZ99-YY88-XX77', role: 'USER', maxUses: 1, usesUsed: 1, expiresAt: null, revoked: false, createdAt: now },
  { id: 'k3', code: 'DL-QQ11-WW22-EE33', role: 'USER', maxUses: 5, usesUsed: 0, expiresAt: null, revoked: true, createdAt: now },
];

/** Sessao de sandbox em execucao que expira em `minutes` minutos. */
/** Imagem servida em GET /api/evidence/:id (PNG 40x30 de verdade). */
export const EVIDENCE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAAAXNSR0IArs4c6QAAAHJJREFUWEftlbENwCAMBGEmdgozkZnYKTRJkYLI4qSI4qh5bJ3fT+6lXGnjk20QTkeCEGAKE6xHo7Ve+nbW0Hs2OMMkwZCBPi5JUII3AWPGmHkI+NVNvOCS/LYkNJhX9eERrxagOhuUICVA9XpQgpQA1Q8uTm7dHz6PWAAAAABJRU5ErkJggg==';

/** Recorte do MITRE ATT&CK embutido (GET /api/attack). */
export const ATTACK = {
  version: '20.0',
  tactics: [
    { id: 'initial-access', name: 'Initial Access' },
    { id: 'execution', name: 'Execution' },
    { id: 'impact', name: 'Impact' },
  ],
  techniques: [
    { id: 'T1059', name: 'Command and Scripting Interpreter', tactics: ['execution'] },
    { id: 'T1059.001', name: 'PowerShell', tactics: ['execution'] },
    { id: 'T1204', name: 'User Execution', tactics: ['execution'] },
    { id: 'T1204.002', name: 'Malicious File', tactics: ['execution'] },
    { id: 'T1486', name: 'Data Encrypted for Impact', tactics: ['impact'] },
    { id: 'T1566', name: 'Phishing', tactics: ['initial-access'] },
    { id: 'T1566.001', name: 'Spearphishing Attachment', tactics: ['initial-access'] },
    { id: 'T1566.002', name: 'Spearphishing Link', tactics: ['initial-access'] },
  ],
};

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
    /** 400 com `details` por campo para uma rota de escrita (ex.: { '/api/entries/url': { title: [...] } }). */
    validationErrors: {},
    /** Ficha do indicador por "KIND:valor" (padrao: indicador sem amostras). */
    iocDetails: {},
    /** IOCs da amostra por id (padrao: o proprio arquivo/URL). */
    entryIocs: {},
    /** Formato da ultima exportacao de IOCs recebida. */
    lastIocExport: null,
    /** Caixa de entrada (mais recentes primeiro). */
    notifications: [],
    knownUrls: new Set(),
    /** Corpo do ultimo POST de atualizacao (texto + mencoes). */
    lastCommentBody: null,
    /** Modelos de relatorio (aba Modelos da Administracao / Novo relatorio). */
    templates: [],
    /** Revisao obrigatoria (GET da ficha) e corpo do ultimo relatorio criado. */
    reviewRequired: false,
    lastReportBody: null,
    /** Resultado de POST /api/entries/:id/static-analysis (reanalise). */
    staticResult: null,
    /** Resposta de GET /api/dashboard e a ultima query recebida. */
    dashboard: null,
    lastDashboardQuery: null,
    /** Resposta de GET /api/admin/status (o roteiro troca) e quantas vezes foi pedida. */
    systemStatus: null,
    statusCalls: 0,
    /** Registros da aba Auditoria (o roteiro preenche) e as ultimas consultas. */
    audit: [],
    auditQueries: [],
    lastAuditExport: null,
    /** Envio de arquivos (lote) e do .zip: nomes recebidos e campos do ultimo .zip. */
    uploads: [],
    lastZipFields: null,
    /** Retencao (GET da ficha) e a Lixeira da Administracao. */
    retentionDays: 0,
    trash: [],
    /** Tokens de API: os do usuario (Minha Conta) e os da aba da Administracao. */
    apiTokens: [],
    adminTokens: [],
    /** Reputacao externa por amostra (GET) e quantas consultas a ficha fez. */
    reputation: {},
    reputationGets: 0,
    /** Antivirus por amostra (GET; lista = sequencia) e quantas consultas a ficha fez. */
    antivirus: {},
    /** Analise de funcoes por amostra (GET; lista = sequencia) e os pedidos feitos (POST). */
    capa: {},
    capaPosts: [],
    /** Analise com o Ghidra por amostra (GET; lista = sequencia) e os pedidos feitos (POST). */
    ghidra: {},
    ghidraPosts: [],
    /** Desempacotamento por amostra (GET; lista = sequencia) e os pedidos feitos (POST). */
    unpack: {},
    unpackPosts: [],
    antivirusGets: 0,
    /** 2FA: codigos de recuperacao restantes e corpos das ultimas chamadas. */
    recoveryRemaining: 10,
    twoFactorCalls: [],
    /** "Pegar a proxima": ids que a fila entrega, na ordem (vazia = nenhuma pendente). */
    nextQueue: [],
    /** Conteudo dos arquivos para o visualizador hexadecimal (Buffer por amostra). */
    fileBytes: {},
    /** Sessoes abertas da conta (aba Sessoes da Minha Conta). */
    sessions: [],
    /** Indicadores seguidos (alertas de IOC): "KIND:valor" -> data. */
    watches: {},
    /** Regras YARA (/yara), resultado por amostra (GET; lista = sequencia) e chamadas. */
    yaraRules: [],
    yara: {},
    yaraCalls: [],
    /** Pacotes de regras (item 143). */
    yaraPackCalls: [],
    /** Atualizacao dos pacotes (item 150). */
    yaraUpdateCalls: [],
    yaraCheckResult: () => ({ outcome: 'current' }),
    yaraUpdates: {
      autoUpdate: true,
      packs: [
        { id: 'reversinglabs', name: 'ReversingLabs', commit: 'e0a0be54', commitDate: '2025-11-03', lastCheck: null, lastError: null },
        { id: 'signature-base', name: 'signature-base', commit: '36ab7042', commitDate: '2026-10-29', lastCheck: '2026-11-01T10:00:00.000Z', lastError: 'GitHub respondeu 503 ao listar os commits' },
      ],
      releases: [],
    },
    yaraPacks: [
      { id: 'reversinglabs', name: 'ReversingLabs', author: 'ReversingLabs', license: 'MIT', url: 'https://github.com/reversinglabs/reversinglabs-yara-rules', description: 'Malware e ransomware.', commit: 'e0a0be54', commitDate: '2025-11-03', enabled: true, installed: true, fileCount: 310, excludedCount: 0, rulesTotal: 310, rulesActive: 310 },
      { id: 'bartblaze', name: 'bartblaze', author: 'bartblaze', license: 'MIT', url: 'https://github.com/bartblaze/Yara-rules', description: 'APT, crime e ransomware.', commit: '5cc871d8', commitDate: '2026-01-28', enabled: true, installed: true, fileCount: 89, excludedCount: 0, rulesTotal: 89, rulesActive: 89 },
      { id: 'signature-base', name: 'signature-base', author: 'Florian Roth (Neo23x0)', license: 'DRL 1.1', url: 'https://github.com/Neo23x0/signature-base', description: 'Base ampla.', commit: '36ab7042', commitDate: '2026-10-29', enabled: false, installed: false, fileCount: 752, excludedCount: 0, rulesTotal: 0, rulesActive: 0 },
    ],
    yaraPackRules: [
      { id: 'pr1', name: 'bartblaze/APT/Autumn_Backdoor_Loader', enabled: true, pack: 'bartblaze', source: 'rule Autumn { meta: author = "@bartblaze" description = "<b>x</b>" condition: false }' },
      { id: 'pr2', name: 'bartblaze/ransomware/Avaddon', enabled: true, pack: 'bartblaze', source: 'rule Avaddon { condition: false }' },
    ],
    /** YARA retroativo: varreduras (mais recente primeiro) e acertos por varredura. */
    retroscans: [],
    retroHits: {},
    /** Lista de permissoes (indicadores legitimos) e chamadas de escrita. */
    allowlist: [],
    allowlistCalls: [],
    /** Visoes da equipe (pasta do navegador) e as chamadas de escrita. */
    teamViews: [],
    teamViewCalls: [],
    /** Base de conhecimento: artigos completos, chamadas de escrita e ultimas buscas. */
    kbArticles: [],
    kbCalls: [],
    kbQueries: [],
    /** Casos (detalhe completo, como GET /api/cases/:id) e chamadas de escrita. */
    cases: [],
    caseCalls: [],
    /** IOCs por caso (GET /api/cases/:id/iocs) e formatos exportados. */
    caseIocs: {},
    caseExports: [],
    /** Pacote STIX no caso: chamadas recebidas e a previa devolvida. */
    caseStix: [],
    caseStixPreview: null,
    /** Versoes anteriores por relatorio (item 75) e o ultimo PATCH de conteudo. */
    reportRevisions: {},
    lastReportPatch: null,
    /** Evidencias (item 76): chamadas de escrita. */
    evidenceCalls: [],
  };
}

const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Instala o servidor do dist + API simulada no contexto do navegador. */
export async function setupMock(context, state) {
  context.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) {
      cspViolations += 1;
      console.log(`FALHA CSP: ${msg.text().slice(0, 300)}`);
    }
  });
  /** URL conhecida pela chave: dos links das amostras ou colada no "Ir para:". */
  const urlOfKey = (key) =>
    [...state.knownUrls, ...entries.map((e) => e.url).filter(Boolean)].find(
      (u) => createHash('sha256').update(u).digest('hex') === key,
    ) ?? null;
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
    const multipartBody = (req.headers()['content-type'] ?? '').startsWith('multipart/');
    const body = req.postData() && !multipartBody ? JSON.parse(req.postData()) : {};
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
        // 2FA ativo: a senha certa so leva a etapa do codigo.
        if (users[0].twoFactorEnabled) return json(route, 200, { twoFactorRequired: true, challenge: 'desafio-1' });
        state.loggedIn = true;
        await renewSession();
        return json(route, 200, { user: currentUser() });
      }
      // 2FA: codigo do aplicativo 123456; codigo de recuperacao abcd-efgh.
      if (p === '/api/auth/login/2fa') {
        state.twoFactorCalls.push(body);
        if (body.challenge !== 'desafio-1') return json(route, 401, { error: 'A verificação expirou. Entre novamente.' });
        if (body.code !== '123456' && body.code !== 'abcd-efgh') return json(route, 401, { error: 'Código inválido.' });
        state.loggedIn = true;
        await renewSession();
        const recovery = body.code === 'abcd-efgh';
        if (recovery) state.recoveryRemaining -= 1;
        return json(route, 200, { user: currentUser(), recoveryRemaining: recovery ? state.recoveryRemaining : null });
      }
      if (p === '/api/me/2fa' && req.method() === 'GET') {
        const on = Boolean(users[0].twoFactorEnabled);
        return json(route, 200, { enabled: on, enabledAt: on ? '2026-10-22T12:00:00.000Z' : null, recoveryRemaining: on ? state.recoveryRemaining : 0 });
      }
      if (p.startsWith('/api/me/2fa/') && req.method() === 'POST') {
        state.twoFactorCalls.push({ path: p, ...body });
        const recoveryCodes = Array.from({ length: 10 }, (_, i) => `k7tm-q2x${i}`);
        if (p === '/api/me/2fa/setup') {
          return json(route, 200, {
            secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/DeepLook:ana%40deeplook.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=DeepLook',
            qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><rect x="2" y="2" width="7" height="7"/><rect x="12" y="2" width="7" height="7"/><rect x="2" y="12" width="7" height="7"/></svg>',
          });
        }
        if (p === '/api/me/2fa/enable') {
          if (body.code !== '123456') return json(route, 400, { error: 'Dados invalidos.', details: { code: ['código inválido'] } });
          users[0].twoFactorEnabled = true;
          state.recoveryRemaining = 10;
          return json(route, 200, { recoveryCodes });
        }
        if (body.password !== state.password) return json(route, 400, { error: 'Dados invalidos.', details: { password: ['senha incorreta'] } });
        if (body.code !== '123456') return json(route, 400, { error: 'Dados invalidos.', details: { code: ['código inválido'] } });
        if (p === '/api/me/2fa/recovery-codes') {
          state.recoveryRemaining = 10;
          return json(route, 200, { recoveryCodes: recoveryCodes.map((c) => c.replace('k7tm', 'zz99')) });
        }
        users[0].twoFactorEnabled = false;
        return json(route, 200, { ok: true });
      }
      const d2 = p.match(/^\/api\/admin\/users\/(\w+)\/disable-2fa$/);
      if (d2) {
        users.find((u) => u.id === d2[1]).twoFactorEnabledAt = null;
        return json(route, 200, { ok: true });
      }
      if (p === '/api/auth/logout') {
        state.loggedIn = false;
        state.sessionExpiresAt = null;
        return json(route, 200, { ok: true });
      }
      // Erros de validacao por campo (iguais aos da API: error + details).
      if (req.method() !== 'GET' && state.validationErrors[p]) {
        return json(route, 400, { error: 'Dados invalidos.', details: state.validationErrors[p] });
      }
      if (p === '/api/auth/register') return json(route, 400, { error: 'Chave de ativacao invalida.' });
      // Login pelo AD (item 94): desligado, a menos que o roteiro ligue.
      if (p === '/api/auth/options') return json(route, 200, { ldap: Boolean(state.ldap) });
      if (!state.loggedIn) return json(route, 401, { error: 'Nao autenticado.' });

      // Casos: so analistas; o caso nunca fica vazio (409 ao retirar a ultima).
      if (p.startsWith('/api/cases') || /^\/api\/entries\/\w+\/cases$/.test(p)) {
        if (state.role === 'USER') return json(route, 403, { error: 'Somente analistas trabalham com casos.' });
        const at = '2026-10-24T09:00:00.000Z';
        const me = { id: 'u1', displayName: 'Ana Souza' };
        const summary = (c) => ({ id: c.id, number: c.number, code: c.code, title: c.title, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt, closedAt: c.closedAt, assignee: c.assignee, createdBy: c.createdBy, entries: c.entries.length });
        const caseEntry = (id) => {
          const e = entries.find((x) => x.id === id);
          return e && { addedAt: at, addedBy: me, entry: { id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: e.priority ?? 'P3', createdAt: e.createdAt, sha256: e.sha256 ?? null, url: e.url ?? null, reports: [] } };
        };
        const byEntry = p.match(/^\/api\/entries\/(\w+)\/cases$/);
        if (byEntry) {
          return json(route, 200, { cases: state.cases.filter((c) => c.entries.some((x) => x.entry.id === byEntry[1])).map((c) => ({ id: c.id, number: c.number, code: c.code, title: c.title, status: c.status })) });
        }
        // Pacote STIX no caso (revisao 3.5): o roteiro define a previa; a importacao so anota.
        const stix = p.match(/^\/api\/cases\/(\w+)\/stix\/(preview|import)$/);
        if (stix && req.method() === 'POST') {
          const body = JSON.parse(req.postData() || '{}');
          state.caseStix.push({ caseId: stix[1], step: stix[2], text: body.text });
          if (!body.text?.trim().startsWith('{')) return json(route, 400, { error: 'JSON inválido: envie um pacote STIX 2.1.' });
          if (stix[2] === 'preview') return json(route, 200, state.caseStixPreview);
          return json(route, 200, { created: 1, linked: 1, added: 2, unknown: 1, skipped: 0, others: 1 });
        }
        if (p === '/api/cases/counts') {
          const active = state.cases.filter((c) => c.status !== 'CLOSED');
          return json(route, 200, { active: active.length, mine: active.filter((c) => c.assignee?.id === 'u1').length });
        }
        if (p === '/api/cases' && req.method() === 'GET') {
          const st = url.searchParams.get('status');
          const q = (url.searchParams.get('q') || '').toLowerCase();
          const items = state.cases
            .filter((c) => !st || (st === 'active' ? c.status !== 'CLOSED' : c.status === st))
            .filter((c) => url.searchParams.get('assignee') !== 'me' || c.assignee?.id === 'u1')
            .filter((c) => !q || c.title.toLowerCase().includes(q) || c.code.toLowerCase() === q)
            .map(summary);
          return json(route, 200, { total: items.length, items });
        }
        if (req.method() !== 'GET') state.caseCalls.push({ method: req.method(), path: p, body });
        // Mapa de relacoes (item 91): o roteiro define `state.graphs[path]`; sem
        // isso, so o centro.
        const gm = p.match(/^\/api\/cases\/(\w+)\/graph$/);
        if (gm) {
          if (state.graphs?.[p]) return json(route, 200, state.graphs[p]);
          const gc = state.cases.find((x) => x.id === gm[1]);
          const center = `case:${gm[1]}`;
          return json(route, 200, { center, nodes: [{ id: center, kind: 'CASE', label: `${gc?.code} · ${gc?.title}`, caseId: gm[1], code: gc?.code }], edges: [], hidden: { entries: 0, iocs: 0, cases: 0 } });
        }
        if (p === '/api/cases' && req.method() === 'POST') {
          const n = state.cases.length + 1;
          const c = { id: `cs${n}`, number: n, code: `CASO-${String(n).padStart(4, '0')}`, title: body.title, description: null, status: 'OPEN', createdAt: at, updatedAt: at, closedAt: null, assignee: me, createdBy: me, entries: body.entryIds.map(caseEntry).filter(Boolean), events: [{ id: `ev${Date.now()}`, type: 'CREATED', detail: body.title, fromValue: null, toValue: null, createdAt: at, actor: me, entry: null }] };
          state.cases.push(c);
          return json(route, 201, { case: summary(c) });
        }
        const m = p.match(/^\/api\/cases\/(\w+)(?:\/(entries|comments|iocs)(?:\/(\w+))?)?$/);
        const c = m && state.cases.find((x) => x.id === m[1]);
        if (!c) return json(route, 404, { error: 'Caso não encontrado.' });
        const event = (type, extra = {}) => c.events.push({ id: `ev${Date.now()}${c.events.length}`, type, detail: null, fromValue: null, toValue: null, createdAt: at, actor: me, entry: null, ...extra });
        if (!m[2] && req.method() === 'GET') return json(route, 200, { case: c });
        if (m[2] === 'iocs' && !m[3]) return json(route, 200, { iocs: state.caseIocs[c.id] ?? [] });
        if (m[2] === 'iocs' && m[3] === 'export') {
          const format = url.searchParams.get('format');
          state.caseExports.push(format);
          return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="deeplook-${c.code.toLowerCase()}-iocs.${format}"` }, body: `iocs ${format}` });
        }
        if (!m[2] && req.method() === 'PATCH') {
          if (body.status && body.status !== c.status) event('STATUS_CHANGED', { fromValue: c.status, toValue: body.status });
          if (body.title && body.title !== c.title) event('UPDATED', { detail: body.title });
          Object.assign(c, { title: body.title ?? c.title, description: body.description || null, status: body.status ?? c.status, assignee: body.assigneeId ? users.find((u) => u.id === body.assigneeId) && { id: body.assigneeId, displayName: users.find((u) => u.id === body.assigneeId).displayName } : null, updatedAt: '2026-10-24T09:30:00.000Z' });
          return json(route, 200, { case: summary(c) });
        }
        if (m[2] === 'entries' && req.method() === 'POST') {
          const fresh = body.entryIds.filter((id) => !c.entries.some((x) => x.entry.id === id)).map(caseEntry).filter(Boolean);
          if (body.entryIds.some((id) => !entries.some((e) => e.id === id))) {
            return json(route, 400, { error: 'Amostra não encontrada.', details: { entryIds: ['amostra não encontrada'] } });
          }
          for (const f of fresh) { c.entries.push(f); event('ENTRY_ADDED', { entry: { id: f.entry.id, title: f.entry.title } }); }
          return json(route, 200, { added: fresh.length });
        }
        if (m[2] === 'entries' && req.method() === 'DELETE') {
          if (c.entries.length <= 1) return json(route, 409, { error: 'O caso precisa de ao menos uma amostra. Para desfazê-lo, encerre o caso.' });
          const gone = c.entries.find((x) => x.entry.id === m[3]);
          c.entries = c.entries.filter((x) => x !== gone);
          event('ENTRY_REMOVED', { entry: { id: gone.entry.id, title: gone.entry.title } });
          return json(route, 200, { ok: true });
        }
        if (m[2] === 'comments') {
          // Mencoes (item 89) gravadas como na API: [{ id, name }].
          const cited = (body.mentions ?? []).map((id) => ({ id, name: users.find((u) => u.id === id)?.displayName }));
          event('COMMENT', { detail: body.text, toValue: cited.length ? JSON.stringify(cited) : null });
          return json(route, 201, { ok: true });
        }
      }
      // Base de conhecimento: todos leem; escrita registrada em kbCalls.
      if (p === '/api/kb' && req.method() === 'GET') {
        state.kbQueries.push(url.search);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const category = url.searchParams.get('category');
        const items = state.kbArticles
          .filter((a) => !category || a.category === category)
          .filter((a) => !q || [a.title, a.summary, a.body, ...a.tags].some((t) => t.toLowerCase().includes(q)))
          .map(({ body: _body, revisions: _r, reports: _rep, createdBy: _c, canDelete: _d, ...a }) => a);
        return json(route, 200, { total: items.length, items });
      }
      if ((p === '/api/kb' && req.method() === 'POST') || /^\/api\/kb\/\w+$/.test(p)) {
        const article = state.kbArticles.find((a) => a.id === p.split('/').pop());
        if (req.method() === 'GET') {
          return article ? json(route, 200, { article }) : json(route, 404, { error: 'Artigo não encontrado.' });
        }
        state.kbCalls.push({ method: req.method(), id: article?.id ?? null, body });
        if (req.method() === 'DELETE') {
          state.kbArticles = state.kbArticles.filter((a) => a !== article);
          return json(route, 200, { ok: true });
        }
        if (state.kbArticles.some((a) => a.title === body.title && a !== article)) {
          return json(route, 409, { error: 'Já existe um artigo com este título.', details: { title: ['título em uso'] } });
        }
        const at = '2026-10-23T18:00:00.000Z';
        const me = { id: 'u1', displayName: 'Ana Souza' };
        if (article) {
          Object.assign(article, body, { updatedAt: at, updatedBy: me });
          article.revisions = [{ id: `rv${Date.now()}`, createdAt: at, editor: me }, ...article.revisions];
          return json(route, 200, { article });
        }
        const created = { id: `kb${state.kbArticles.length + 1}`, ...body, createdAt: at, updatedAt: at, createdBy: me, updatedBy: me, canDelete: true, revisions: [], reports: [], citations: 0 };
        state.kbArticles.push(created);
        return json(route, 201, { article: created });
      }
      // Visoes da equipe: so analistas; mesma URL = 409.
      if (p === '/api/team-views' || /^\/api\/team-views\/\w+$/.test(p)) {
        if (state.role === 'USER') {
          state.teamViewGetsAsUser = true;
          return json(route, 403, { error: 'Somente analistas usam as visões da equipe.' });
        }
        if (req.method() === 'GET') {
          return json(route, 200, { views: [...state.teamViews].sort((a, b) => a.label.localeCompare(b.label)) });
        }
        state.teamViewCalls.push({ method: req.method(), ...(req.method() === 'DELETE' ? { id: p.split('/').pop() } : { body }) });
        if (req.method() === 'POST') {
          const same = state.teamViews.find((v) => v.url === body.url);
          if (same) return json(route, 409, { error: `Esta visão já está nas Visões da equipe como "${same.label}".` });
          const view = { id: `tv${Date.now()}`, label: body.label, url: body.url, createdAt: '2026-10-23T15:00:00.000Z', createdBy: { id: 'u1', displayName: 'Ana Souza' }, count: 1, canEdit: true };
          state.teamViews.push(view);
          return json(route, 201, { view });
        }
        const view = state.teamViews.find((v) => v.id === p.split('/').pop());
        if (!view) return json(route, 404, { error: 'Visão não encontrada.' });
        if (req.method() === 'PATCH') {
          view.label = body.label;
          return json(route, 200, { view });
        }
        state.teamViews = state.teamViews.filter((v) => v !== view);
        return json(route, 200, { ok: true });
      }
      // Comparar amostras: o roteiro define as listas; os lados vem de `entries`.
      if (p === '/api/entries/compare') {
        state.lastCompare = url.search;
        const ea = entries.find((e) => e.id === url.searchParams.get('a'));
        const eb = entries.find((e) => e.id === url.searchParams.get('b'));
        if (!ea || !eb) return json(route, 404, { error: 'Amostra nao encontrada.' });
        const side = (e) => ({
          id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, priority: e.priority ?? 'P3',
          createdAt: e.createdAt, owner: { id: e.owner.id, displayName: e.owner.displayName },
          originalFilename: e.originalFilename ?? null, fileSize: e.fileSize ?? null, mimeType: e.mimeType ?? null,
          sha256: e.sha256 ?? null, url: e.url ?? null, urlDomain: e.urlDomain ?? null,
          detectedType: e.staticInfo?.detectedType?.label ?? null, entropy: e.staticInfo?.entropy ?? null,
          entropyLevel: e.staticInfo?.entropyLevel ?? null, stringsTotal: e.staticInfo?.strings?.total ?? null, pe: null,
        });
        const empty = { common: [], onlyA: [], onlyB: [] };
        const keys = ['iocs', 'yara', 'attack', 'urls', 'ips', 'emails', 'paths', 'registry', 'suspicious', 'imports', 'suspiciousImports', 'sections'];
        const lists = Object.fromEntries(keys.map((k) => [k, state.compareLists?.[k] ?? empty]));
        return json(route, 200, { a: side(ea), b: side(eb), sameContent: Boolean(ea.sha256 && ea.sha256 === eb.sha256), lists });
      }
      if (p === '/api/attack') {
        state.attackGets = (state.attackGets ?? 0) + 1;
        return json(route, 200, ATTACK);
      }
      if (p === '/api/dashboard') {
        state.lastDashboardQuery = url.search;
        const days = Number(url.searchParams.get('days') || 7);
        const base = state.dashboard ?? {
          scope: 'all', since: '2026-10-16T03:00:00.000Z', sla: SLA,
          byStatus: { PENDING: 0, IN_REVIEW: 0, COMPLETED: 0 }, byVerdict: { UNKNOWN: 0, CLEAN: 0, SUSPICIOUS: 0, MALICIOUS: 0 },
          open: { warn: 0, late: 0 }, period: { submitted: 0, completed: 0 }, daily: [], workload: [],
        };
        const scope = state.role === 'USER' ? 'mine' : base.scope;
        return json(route, 200, { ...base, scope, days, tz: url.searchParams.get('tz'), workload: scope === 'mine' ? [] : base.workload });
      }
      if (p === '/api/admin/audit/verify') {
        return json(route, 200, state.auditChain ?? {
          ok: true, events: state.audit.length, unchained: 0,
          head: state.audit.length ? { seq: state.audit.length, hash: 'ab12cd34ef56ab78'.repeat(4) } : null,
          problem: null, checkedAt: new Date().toISOString(),
        });
      }
      if (p === '/api/admin/audit' || p === '/api/admin/audit/export.csv') {
        const sp = url.searchParams;
        const text = (sp.get('q') ?? '').toLowerCase();
        const rows = state.audit.filter(
          (e) =>
            (!sp.get('action') || e.action === sp.get('action')) &&
            (!text || [e.targetLabel, e.detail, e.ip, e.actor?.displayName, e.actor?.email].some((v) => v?.toLowerCase().includes(text))),
        );
        if (p.endsWith('.csv')) {
          state.lastAuditExport = url.search;
          return route.fulfill({
            status: 200,
            headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="deeplook-auditoria-20261022.csv"' },
            body: 'Data;Quem;Ação\r\n' + rows.map((e) => `${e.createdAt};${e.actor?.displayName ?? ''};${e.action}`).join('\r\n'),
          });
        }
        state.auditQueries.push(url.search);
        const offset = Number(sp.get('offset') ?? 0);
        return json(route, 200, { total: rows.length, items: rows.slice(offset, offset + Number(sp.get('limit') ?? 50)) });
      }
      if (p === '/api/admin/status') {
        state.statusCalls += 1;
        return json(route, 200, state.systemStatus ?? {
          checkedAt: new Date().toISOString(),
          overall: 'ok',
          checks: [{ id: 'api', name: 'API', level: 'ok', summary: 'versão 1.0.0 · no ar há 5 min', details: [] }],
        });
      }

      // Modelos de relatorio (nome unico, como na API).
      if (p === '/api/report-templates' && req.method() === 'GET') {
        return json(route, 200, { templates: [...state.templates].sort((a, b) => a.name.localeCompare(b.name)) });
      }
      const tpl = p.match(/^\/api\/report-templates(?:\/([\w-]+))?$/);
      if (tpl && req.method() !== 'GET') {
        if (req.method() === 'DELETE') {
          state.templates = state.templates.filter((t) => t.id !== tpl[1]);
          return json(route, 200, { ok: true });
        }
        const name = String(body.name ?? '').trim();
        if (state.templates.some((t) => t.name === name && t.id !== tpl[1])) {
          return json(route, 409, { error: 'Ja existe um modelo com este nome.', details: { name: ['nome em uso'] } });
        }
        const data = { name, summary: body.summary, findings: body.findings || null, iocs: body.iocs || null, verdict: body.verdict, updatedAt: new Date().toISOString() };
        if (req.method() === 'POST') {
          const template = { id: `tpl${state.templates.length + 1}`, ...data };
          state.templates.push(template);
          return json(route, 201, { template });
        }
        const template = state.templates.find((t) => t.id === tpl[1]);
        Object.assign(template, data);
        return json(route, 200, { template });
      }

      // Avisos gerais (item 88): faixa vazia por padrao; broadcasts.mjs simula os seus.
      if (p === '/api/broadcasts/active') return json(route, 200, { items: [] });

      // Caixa de entrada.
      const unreadCount = () => state.notifications.filter((n) => !n.readAt).length;
      if (p === '/api/me/notifications/count') return json(route, 200, { unread: unreadCount() });
      if (p === '/api/me/notifications' && req.method() === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 20);
        const onlyUnread = url.searchParams.get('unread') === '1';
        const items = state.notifications.filter((n) => !onlyUnread || !n.readAt).slice(0, limit);
        return json(route, 200, { items, unread: unreadCount() });
      }
      if (p === '/api/me/notifications/read' && req.method() === 'POST') {
        for (const n of state.notifications) {
          if (!n.readAt && (!body.ids || body.ids.includes(n.id))) n.readAt = new Date().toISOString();
        }
        return json(route, 200, { unread: unreadCount() });
      }
      if (p === '/api/users/mentionable') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const list = users
          .filter((u) => u.status === 'ACTIVE' && u.id !== 'u1' && u.displayName.toLowerCase().includes(q))
          // Casos (item 89): so analistas.
          .filter((u) => url.searchParams.get('analysts') !== '1' || u.role !== 'USER')
          .map((u) => ({ id: u.id, displayName: u.displayName }));
        return json(route, 200, { users: list });
      }

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

      if (p === '/api/me/notification-types') {
        const role = currentUser().role;
        const types = NOTIFICATION_TYPES.filter(
          ([, audience]) => audience === 'all' || role === 'ADMIN' || (audience === 'analyst' && role === 'ANALYST'),
        ).map(([type, , locked]) => ({ type, locked }));
        return json(route, 200, { types });
      }
      if (p === '/api/me/preferences' && req.method() === 'PATCH') {
        state.preferences = { ...state.preferences, ...body };
        return json(route, 200, { preferences: state.preferences });
      }
      if (p === '/api/me/password') {
        if (body.currentPassword !== state.password) return json(route, 400, { error: 'Senha atual incorreta.' });
        if (body.newPassword === state.password) {
          return json(route, 400, { error: 'A nova senha deve ser diferente da atual.' });
        }
        state.password = body.newPassword;
        state.lastPasswordBody = body;
        // Troca obrigatoria (senha redefinida pelo admin): segue logado com sessao nova.
        if (users[0].mustChangePassword) {
          users[0].mustChangePassword = false;
          return json(route, 200, { ok: true, signedIn: true });
        }
        state.loggedIn = false;
        return json(route, 200, { ok: true });
      }
      // Com a troca obrigatoria pendente, a API recusa o resto (como a real).
      if (users[0].mustChangePassword && state.loggedIn && !['/api/auth/me', '/api/auth/session', '/api/auth/touch'].includes(p)) {
        state.blockedWhileForced = (state.blockedWhileForced ?? 0) + 1;
        return json(route, 403, { error: 'Defina uma nova senha para continuar.', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      if (p === '/api/entries') {
        const sp = url.searchParams;
        state.lastLimit = sp.get('limit');
        // Meus Uploads: vazio, a menos que o roteiro defina `state.mine` (ids).
        let items = sp.get('scope') === 'mine' ? entries.filter((e) => state.mine?.includes(e.id)) : entries;
        const q = (sp.get('q') || '').toLowerCase();
        if (q) items = items.filter((e) => e.title.toLowerCase().includes(q));
        if (sp.get('sha256')) items = entries.filter((e) => e.sha256 === sp.get('sha256'));
        if (sp.get('assignee') === 'me') items = items.filter((e) => e.assignee?.id === 'u1');
        if (sp.get('assignee') === 'none') items = items.filter((e) => !e.assignee);
        for (const k of ['type', 'status', 'verdict']) {
          if (sp.get(k)) items = items.filter((e) => e[k] === sp.get(k));
        }
        const age = sp.get('age');
        if (age) items = items.filter((e) => olderThan(e, age === 'late' ? limitsOf(e).lateHours : limitsOf(e).warnHours));
        if (sp.get('priority')) items = items.filter((e) => (e.priority ?? 'P3') === sp.get('priority'));
        // Tecnica ATT&CK de relatorio publicado (T1566 inclui T1566.xxx).
        const attack = sp.get('attack');
        if (attack) {
          const match = (t) => t === attack || t.startsWith(`${attack}.`);
          items = items.filter((e) =>
            reports.some((r) => r.entryId === e.id && r.status === 'PUBLISHED' && (r.attackTechniques ?? []).some(match)),
          );
        }
        state.lastListQuery = url.search;
        if (sp.get('sort') === 'priority') {
          const sign = sp.get('dir') === 'asc' ? -1 : 1;
          items = [...items].sort((a, b) => sign * (a.priority ?? 'P3').localeCompare(b.priority ?? 'P3'));
        }
        if (sp.get('sort') === 'age') {
          const sign = sp.get('dir') === 'asc' ? -1 : 1;
          items = [...items].sort((a, b) => sign * (Date.parse(a.statusChangedAt) - Date.parse(b.statusChangedAt)));
        }
        return json(route, 200, { total: items.length, limit: Number(sp.get('limit') || 50), offset: 0, items, sla: SLA });
      }
      if (p === '/api/me/updates') return json(route, 200, state.updates);
      // Cota de envio (padrao: sem limite, como analista); `quotaReject` simula o 429.
      if (p === '/api/me/sample-access') return json(route, 200, { ownOnly: Boolean(state.ownSamplesOnly) && state.role === 'USER' });
      if (p === '/api/admin/settings') {
        if (req.method() === 'PATCH') state.ownSamplesOnly = body.ownSamplesOnly;
        return json(route, 200, { ownSamplesOnly: Boolean(state.ownSamplesOnly) });
      }
      if (p === '/api/me/upload-quota') {
        return json(route, 200, { ...(state.uploadQuota ?? { limit: null, used: 0, remaining: null, resetAt: null }), maxUploadMb: 200 });
      }
      if (state.quotaReject && /^\/api\/entries\/(url|file|zip)$/.test(p) && req.method() === 'POST') {
        return json(route, 429, { error: state.quotaReject, resetAt: '2026-10-24T13:05:00.000Z' });
      }
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
      // Antivirus (ClamAV): mesma ideia da reputacao.
      const av = p.match(/^\/api\/entries\/(\w+)\/antivirus$/);
      if (av && req.method() === 'GET') {
        state.antivirusGets += 1;
        const r = state.antivirus[av[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, value ?? { enabled: false, pending: false, scan: null });
      }
      if (av && req.method() === 'POST') return json(route, 202, { ok: true });
      // Analise de funcoes (capa, item 7.2): lista = sequencia de respostas, como o antivirus.
      const capa = p.match(/^\/api\/entries\/(\w+)\/capa$/);
      if (capa && req.method() === 'GET') {
        const r = state.capa[capa[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, value ?? { enabled: false, eligible: false, maxMb: 32, analysis: null });
      }
      if (capa && req.method() === 'POST') {
        state.capaPosts.push(capa[1]);
        return json(route, 202, { ok: true });
      }
      // Analise com o Ghidra (item 7.3): mesma ideia; sem estado, a secao nao se aplica.
      const ghidra = p.match(/^\/api\/entries\/(\w+)\/ghidra$/);
      if (ghidra && req.method() === 'GET') {
        const r = state.ghidra[ghidra[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(
          route,
          200,
          value ?? { enabled: false, applicable: false, eligible: false, reason: null, maxMb: 32, canDownload: false, analysis: null },
        );
      }
      if (ghidra && req.method() === 'POST') {
        state.ghidraPosts.push(ghidra[1]);
        return json(route, 202, { ok: true });
      }
      // Desempacotamento (item 7.8): mesma ideia; sem estado, a secao nao se aplica.
      const unpack = p.match(/^\/api\/entries\/(\w+)\/unpack$/);
      if (unpack && req.method() === 'GET') {
        const r = state.unpack[unpack[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, value ?? { enabled: false, applicable: false, maxMb: 64, job: null, children: [] });
      }
      if (unpack && req.method() === 'POST') {
        state.unpackPosts.push(unpack[1]);
        return json(route, 202, { ok: true });
      }
      // Regras YARA: "$b" sem declarar = erro de compilacao (como o YARA-X).
      const yaraErrors = (source) =>
        /\$b\b/.test(source) && !/\$b\s*=/.test(source)
          ? ['error[E025]: unknown pattern `$b`\n --> line:7:5\n  |\n7 |     $b\n  |     ^^ this pattern is not declared in the `strings` section']
          : [];
      const yr = p.match(/^\/api\/entries\/(\w+)\/yara$/);
      if (yr && req.method() === 'GET') {
        const r = state.yara[yr[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, value ?? { activeRules: 0, pending: false, scan: null });
      }
      if (yr && req.method() === 'POST') {
        state.yaraCalls.push({ rescan: yr[1] });
        return json(route, 202, { ok: true });
      }
      if (p === '/api/yara/packs') return json(route, 200, { packs: state.yaraPacks });
      if (p === '/api/admin/yara-packs/updates') {
        if (req.method() === 'PATCH') state.yaraUpdates.autoUpdate = body.autoUpdate;
        return json(route, 200, state.yaraUpdates);
      }
      const packCheck = p.match(/^\/api\/admin\/yara-packs\/([\w-]+)\/check$/);
      if (packCheck) {
        state.yaraUpdateCalls.push(`check:${packCheck[1]}:${body.apply}`);
        return json(route, 200, state.yaraCheckResult(body.apply));
      }
      const releaseAct = p.match(/^\/api\/admin\/yara-releases\/(\w+)\/(\w+)$/);
      if (releaseAct) {
        state.yaraUpdateCalls.push(`${releaseAct[2]}:${releaseAct[1]}`);
        const rel = state.yaraUpdates.releases.find((r) => r.id === releaseAct[1]);
        rel.status = { approve: 'APPLIED', dismiss: 'DISMISSED', rollback: 'ROLLED_BACK' }[releaseAct[2]];
        rel.canRollback = releaseAct[2] === 'approve';
        return json(route, 200, state.yaraUpdates);
      }
      const packToggle = p.match(/^\/api\/admin\/yara-packs\/([\w-]+)$/);
      if (packToggle) {
        const pack = state.yaraPacks.find((x) => x.id === packToggle[1]);
        Object.assign(pack, { enabled: body.enabled, installed: true, rulesTotal: pack.fileCount, rulesActive: pack.fileCount });
        state.yaraPackCalls.push(`${pack.id}:${body.enabled}`);
        return json(route, 200, { packs: state.yaraPacks });
      }
      const packRules = p.match(/^\/api\/yara\/packs\/([\w-]+)\/rules$/);
      if (packRules) {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const rules = state.yaraPackRules.filter((r) => r.pack === packRules[1] && r.name.toLowerCase().includes(q)).map(({ source, ...rest }) => rest);
        return json(route, 200, { total: rules.length, limit: 200, rules });
      }
      const packRule = p.match(/^\/api\/yara\/rules\/(pr\d+)$/);
      if (packRule) {
        const rule = state.yaraPackRules.find((r) => r.id === packRule[1]);
        if (req.method() === 'PATCH') Object.assign(rule, body);
        if (req.method() === 'DELETE') state.yaraPackRules.splice(state.yaraPackRules.indexOf(rule), 1);
        return json(route, 200, { rule, warnings: [] });
      }
      if (p === '/api/yara/rules' && req.method() === 'GET') {
        return json(route, 200, { rules: [...state.yaraRules].sort((a, b) => a.name.localeCompare(b.name)) });
      }
      // Busca avancada: o roteiro pode fixar a resposta; senao, amostras pelo titulo.
      if (p === '/api/search') {
        state.lastSearch = url.search;
        if (state.searchResult) return json(route, 200, state.searchResult);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const found = entries.filter((e) => e.title.toLowerCase().includes(q));
        const items = found.map((e) => ({ id: e.id, title: e.title, type: e.type, status: e.status, verdict: e.verdict, snippet: e.title.replace(new RegExp(q, 'i'), (m) => `⟦${m}⟧`) }));
        return json(route, 200, { q, type: 'all', groups: { entries: { total: items.length, items } } });
      }
      // Lista de permissoes: dominio vale para subdominios; o filtro so olha dominios e valores exatos.
      if (p === '/api/allowlist' && req.method() === 'GET') return json(route, 200, { items: state.allowlist });
      if (p === '/api/allowlist/filter') {
        const covered = (v) => {
          let host = v.toLowerCase();
          try { if (/^https?:/.test(host)) host = new URL(host).hostname; } catch { /* texto */ }
          if (host.includes('@')) host = host.split('@')[1];
          return state.allowlist.some((a) => a.value === v.toLowerCase() || (a.kind === 'DOMAIN' && (host === a.value || host.endsWith(`.${a.value}`))));
        };
        return json(route, 200, { allowed: (body.values ?? []).filter(covered) });
      }
      if (p === '/api/allowlist' && req.method() === 'POST') {
        state.allowlistCalls.push({ method: 'POST', body });
        if (body.kind === 'IPV4' && !/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(body.value)) {
          return json(route, 400, { error: 'Dados invalidos.', details: { value: ['use um IP ou uma faixa, ex.: 10.0.0.0/8'] } });
        }
        const value = body.value.trim().toLowerCase();
        if (state.allowlist.some((a) => a.kind === body.kind && a.value === value)) {
          return json(route, 409, { error: 'Este indicador já está na lista de permissões.', details: { value: ['já está na lista'] } });
        }
        const item = { id: `al${state.allowlist.length + 1}`, kind: body.kind, value, reason: body.reason, createdAt: '2026-10-24T16:00:00.000Z', createdBy: { id: 'u1', displayName: 'Ana Souza' } };
        state.allowlist.push(item);
        return json(route, 201, { item });
      }
      const allowDel = p.match(/^\/api\/allowlist\/(\w+)$/);
      if (allowDel && req.method() === 'DELETE') {
        state.allowlistCalls.push({ method: 'DELETE', id: allowDel[1] });
        state.allowlist = state.allowlist.filter((a) => a.id !== allowDel[1]);
        return json(route, 200, { ok: true });
      }
      // YARA retroativo: uma por vez; o roteiro avanca o progresso no estado.
      const retroStart = p.match(/^\/api\/yara\/rules\/(\w+)\/retroscan$/);
      if (retroStart) {
        state.yaraCalls.push({ retroscan: retroStart[1] });
        if (state.retroscans.some((r) => r.status === 'RUNNING')) {
          return json(route, 409, { error: 'Já há uma varredura retroativa em andamento.' });
        }
        const rule = state.yaraRules.find((r) => r.id === retroStart[1]);
        const item = { id: `rs${state.retroscans.length + 1}`, ruleId: rule.id, ruleName: rule.name, status: 'RUNNING', total: 3000, scanned: 0, matched: 0, failed: 0, skipped: 2, startedAt: '2026-10-24T14:00:00.000Z', finishedAt: null, error: null, startedBy: { id: 'u1', displayName: 'Ana Souza' } };
        state.retroscans.unshift(item);
        return json(route, 202, { retroscan: { id: item.id, total: item.total, skipped: item.skipped } });
      }
      if (p === '/api/yara/retroscans') return json(route, 200, { items: state.retroscans });
      const retroOne = p.match(/^\/api\/yara\/retroscans\/(\w+)(\/cancel)?$/);
      if (retroOne) {
        const item = state.retroscans.find((r) => r.id === retroOne[1]);
        if (!item) return json(route, 404, { error: 'Varredura não encontrada.' });
        if (retroOne[2]) {
          if (item.status !== 'RUNNING') return json(route, 409, { error: 'A varredura não está em andamento.' });
          item.status = 'CANCELLED';
          item.finishedAt = '2026-10-24T14:05:00.000Z';
          return json(route, 200, { ok: true });
        }
        return json(route, 200, { retroscan: { ...item, hits: state.retroHits[item.id] ?? [] } });
      }
      if (p === '/api/yara/validate') {
        state.yaraCalls.push({ validate: body.source });
        const errors = yaraErrors(body.source ?? '');
        return json(route, 200, { ok: errors.length === 0, errors, warnings: [] });
      }
      const yrule = p.match(/^\/api\/yara\/rules(?:\/(\w+))?$/);
      if (yrule && ['POST', 'PATCH', 'DELETE'].includes(req.method())) {
        state.yaraCalls.push({ method: req.method(), id: yrule[1] ?? null, body });
        const existing = state.yaraRules.find((r) => r.id === yrule[1]);
        if (req.method() === 'DELETE') {
          state.yaraRules = state.yaraRules.filter((r) => r.id !== yrule[1]);
          return json(route, 200, { ok: true });
        }
        const toggle = Object.keys(body).length === 1 && 'enabled' in body;
        if (!toggle) {
          const errors = yaraErrors(body.source ?? '');
          if (errors.length) {
            return json(route, 400, { error: 'A regra não compila. Corrija e salve de novo.', details: { source: errors } });
          }
          if (state.yaraRules.some((r) => r.name === body.name.trim() && r.id !== yrule[1])) {
            return json(route, 409, { error: 'Já existe uma regra com este nome.', details: { name: ['nome em uso'] } });
          }
        }
        const editor = { id: 'u1', displayName: 'Ana Souza' };
        const at = '2026-10-23T15:00:00.000Z';
        const rule = existing
          ? Object.assign(existing, toggle ? { enabled: body.enabled } : { ...body, name: body.name.trim(), description: body.description || null }, { updatedBy: editor, updatedAt: at })
          : { id: `y${state.yaraRules.length + 1}`, name: body.name.trim(), description: body.description || null, source: body.source, enabled: body.enabled, createdAt: at, updatedAt: at, createdBy: editor, updatedBy: editor };
        if (!existing) state.yaraRules.push(rule);
        return json(route, existing ? 200 : 201, { rule, warnings: [] });
      }
      // Pontuacao de risco: sem roteiro, nota 0 (a secao aparece com "nenhum sinal").
      const rk = p.match(/^\/api\/entries\/(\w+)\/risk$/);
      if (rk && req.method() === 'GET') {
        state.riskGets = (state.riskGets ?? 0) + 1;
        if (state.role === 'USER') return json(route, 403, { error: 'Somente analistas veem a pontuação de risco.' });
        const r = state.risk?.[rk[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, {
          risk: value ?? { score: 0, level: 'low', suggestedVerdict: null, reasons: [], pending: [] },
          thresholds: { malicious: 70, suspicious: 35 },
        });
      }
      // Reputacao externa: o roteiro define o que cada GET devolve (lista = sequencia).
      const rp = p.match(/^\/api\/entries\/(\w+)\/reputation$/);
      if (rp && req.method() === 'GET') {
        state.reputationGets += 1;
        const r = state.reputation[rp[1]];
        const value = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
        return json(route, 200, value ?? { services: [], indicator: null, pending: false, results: [] });
      }
      if (rp && req.method() === 'POST') return json(route, 202, { ok: true });
      // Tokens de API pessoais (Minha Conta) e a aba da Administracao.
      if (p === '/api/me/api-tokens' && req.method() === 'GET') {
        return json(route, 200, { apiAccess: Boolean(users[0].apiAccess), maxDays: 90, tokens: state.apiTokens });
      }
      if (p === '/api/me/api-tokens' && req.method() === 'POST') {
        if (!body.name || body.name.trim().length < 2) {
          return json(route, 400, { error: 'Dados invalidos.', details: { name: ['mínimo de 2 caracteres'] } });
        }
        const n = state.apiTokens.length + 1;
        state.lastTokenBody = body;
        const token = {
          id: `tk${n}`, name: body.name, scope: body.scope ?? 'SAMPLES', prefix: `dlk_Ab12Cd3${n}`, createdAt: '2026-10-22T12:00:00.000Z',
          expiresAt: new Date(Date.parse('2026-10-22T12:00:00.000Z') + body.expiresInDays * 86400000).toISOString(),
          lastUsedAt: null, lastUsedIp: null, revokedAt: null,
        };
        state.apiTokens.unshift(token);
        return json(route, 201, { token, secret: `dlk_Ab12Cd3${n}EfGh5678IjKl9012MnOp3456QrSt` });
      }
      const mt = p.match(/^\/api\/(me|admin)\/api-tokens\/(\w+)$/);
      if (mt && req.method() === 'DELETE') {
        const list = mt[1] === 'me' ? state.apiTokens : state.adminTokens;
        list.find((t) => t.id === mt[2]).revokedAt = '2026-10-22T13:00:00.000Z';
        return json(route, 200, { ok: true });
      }
      if (p === '/api/admin/api-tokens') {
        const all = url.searchParams.get('status') === 'all';
        return json(route, 200, { tokens: state.adminTokens.filter((t) => all || !t.revokedAt) });
      }
      // Lixeira: mover (ficha), listar, restaurar e excluir de vez.
      const tr = p.match(/^\/api\/entries\/(\w+)\/trash$/);
      if (tr && req.method() === 'POST') {
        const i = entries.findIndex((e) => e.id === tr[1]);
        const [e] = entries.splice(i, 1);
        state.trash.unshift({ ...e, deletedAt: new Date().toISOString(), deletedBy: { id: 'u1', displayName: 'Ana Souza' }, _count: { reports: e._count?.reports ?? 0 } });
        return json(route, 200, { ok: true });
      }
      if (p === '/api/admin/trash') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const items = state.trash.filter((t) => !q || t.title.toLowerCase().includes(q));
        return json(route, 200, { total: items.length, items });
      }
      const trx = p.match(/^\/api\/admin\/trash\/(\w+)(\/restore)?$/);
      if (trx) {
        const i = state.trash.findIndex((t) => t.id === trx[1]);
        const [t] = state.trash.splice(i, 1);
        if (trx[2]) entries.push(t);
        return json(route, 200, { ok: true });
      }
      // Envio de arquivo (um por requisicao no lote). "falha" no nome simula o
      // limite de tamanho; "repetida" aponta uma amostra anterior.
      if ((p === '/api/entries/file' || p === '/api/entries/zip') && req.method() === 'POST') {
        const raw = req.postDataBuffer()?.toString('utf8') ?? '';
        const fields = {};
        for (const m of raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) fields[m[1]] = m[2];
        const filename = raw.match(/filename="([^"]*)"/)?.[1] ?? '';
        if (p === '/api/entries/zip') {
          state.lastZipFields = fields;
          if (fields.password !== 'infected') {
            return json(route, 400, { error: 'Senha incorreta para o .zip.', details: { password: ['Senha incorreta para o .zip.'] }, created: [], skipped: [] });
          }
          return json(route, 201, {
            created: [
              { name: 'dropper.exe', path: 'dropper.exe', entry: { id: 'z1', title: 'dropper.exe', fileSize: 48213 }, previous: null },
              { name: 'config.bin', path: 'payload/config.bin', entry: { id: 'z2', title: 'config.bin', fileSize: 912 }, previous: { id: 'e1', title: entries[0].title } },
            ],
            skipped: [{ name: 'vazio.txt', path: 'vazio.txt', reason: 'arquivo vazio' }],
          });
        }
        state.uploads.push({ filename, ...fields });
        if (filename.includes('falha')) return json(route, 413, { error: 'Arquivo maior que o limite de 200 MB.' });
        const id = `n${state.uploads.length}`;
        return json(route, 201, {
          entry: { id, title: fields.title || filename },
          previous: filename.includes('repetida') ? { id: 'e1', title: entries[0].title } : null,
        });
      }
      const hx = p.match(/^\/api\/entries\/(\w+)\/hex$/);
      if (hx) {
        const all = state.fileBytes[hx[1]] ?? Buffer.alloc(0);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const length = Number(url.searchParams.get('length') ?? 4096);
        const limit = Math.min(all.length, 65536);
        state.calls.push(`HEX ${hx[1]} ${offset}`);
        return json(route, 200, { offset, size: all.length, limit, data: all.subarray(offset, Math.min(offset + length, limit)).toString('base64') });
      }
      if (p === '/api/me/sessions' && req.method() === 'GET') return json(route, 200, { sessions: state.sessions });
      if (p === '/api/me/sessions/revoke-others' && req.method() === 'POST') {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((x) => x.current);
        return json(route, 200, { revoked: before - state.sessions.length });
      }
      const ss = p.match(/^\/api\/me\/sessions\/(\w+)$/);
      if (ss && req.method() === 'DELETE') {
        state.sessions = state.sessions.filter((x) => x.handle !== ss[1]);
        return json(route, 200, { ok: true });
      }
      if (p === '/api/entries/next' && req.method() === 'POST') {
        const id = state.nextQueue.shift();
        if (!id) return json(route, 404, { error: 'Nenhuma amostra pendente sem responsável.' });
        const e = entries.find((x) => x.id === id);
        Object.assign(e, { status: 'IN_REVIEW', assignee: { id: 'u1', displayName: 'Ana Souza' } });
        return json(route, 200, { entry: { id: e.id, title: e.title } });
      }
      if (p === '/api/entries/bulk' && req.method() === 'POST') {
        state.lastBulk = body;
        const targets = entries.filter((e) => body.ids.includes(e.id));
        for (const e of targets) {
          const { assigneeId, ...rest } = body.patch;
          for (const [key, type] of [['status', 'STATUS_CHANGED'], ['verdict', 'VERDICT_CHANGED']]) {
            if (rest[key] && rest[key] !== e[key]) pushEvent(e.id, type, e[key], rest[key]);
          }
          if (rest.priority && rest.priority !== (e.priority ?? 'P3')) pushEvent(e.id, 'PRIORITY_CHANGED', e.priority ?? 'P3', rest.priority);
          if (rest.status && rest.status !== e.status) e.statusChangedAt = new Date().toISOString();
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
        const late = entries.filter((e) => olderThan(e, limitsOf(e).lateHours)).length;
        const reviews = reports.filter((r) => r.status === 'IN_REVIEW' && r.analystId !== 'u1').length;
        return json(route, 200, { counts, mine, late, reviews });
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
        state.lastPatch = body;
        const e = entries.find((x) => x.id === m[1]);
        const { assigneeId, ...rest } = body;
        for (const [key, type] of [['status', 'STATUS_CHANGED'], ['verdict', 'VERDICT_CHANGED']]) {
          if (rest[key] && rest[key] !== e[key]) pushEvent(e.id, type, e[key], rest[key]);
        }
        if (rest.priority && rest.priority !== (e.priority ?? 'P3')) pushEvent(e.id, 'PRIORITY_CHANGED', e.priority ?? 'P3', rest.priority);
        if (rest.status && rest.status !== e.status) e.statusChangedAt = new Date().toISOString();
        if (rest.resolution !== undefined && rest.resolution !== (e.resolution ?? null)) pushEvent(e.id, 'RESOLUTION_SET', null, rest.resolution);
        Object.assign(e, rest);
        if (assigneeId !== undefined) {
          const next = assigneeId ? actorOf(users.find((u) => u.id === assigneeId)) : null;
          pushEvent(e.id, 'ASSIGNED', e.assignee?.displayName ?? null, next?.displayName ?? null);
          e.assignee = next;
        }
        return json(route, 200, { entry: e });
      }
      // Indicadores: reconhecimento simplificado (a API usa lib/iocs.ts). O resolve (item 166)
      // recebe o texto no corpo e prefere a URL inteira; a URL fica conhecida pela chave.
      if (p === '/api/iocs/resolve' && req.method() === 'POST') {
        const text = String(body.text ?? '').trim().replace(/^hxxp/i, 'http').replace(/\[\.\]/g, '.');
        if (/^https?:\/\/[^\s]+$/i.test(text)) {
          const value = new URL(text).href.replace(/#.*$/, '');
          state.knownUrls.add(value);
          return json(route, 200, { ioc: { kind: 'URL', value } });
        }
      }
      if (p === '/api/iocs/lookup' || p === '/api/iocs/resolve') {
        const raw = p === '/api/iocs/resolve' ? String(body.text ?? '') : url.searchParams.get('q') || '';
        const q = raw.trim().replace(/^hxxp/i, 'http').replace(/\[\.\]/g, '.').toLowerCase();
        const host = q.match(/^https?:\/\/([^/:?#]+)/)?.[1];
        let ioc = null;
        if (/^[a-f0-9]{64}$/.test(q)) ioc = { kind: 'SHA256', value: q };
        else if (/^[a-f0-9]{40}$/.test(q)) ioc = { kind: 'SHA1', value: q };
        else if (/^[a-f0-9]{32}$/.test(q)) ioc = { kind: 'MD5', value: q };
        else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(q)) ioc = /^(10|127)\.|^192\.168\./.test(q) ? null : { kind: 'IPV4', value: q };
        else if (host) ioc = { kind: 'DOMAIN', value: host };
        else if (q.includes('@')) ioc = { kind: 'EMAIL', value: q };
        else if (/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(q)) ioc = { kind: 'DOMAIN', value: q };
        return ioc ? json(route, 200, { ioc }) : json(route, 404, { error: 'Não é um indicador reconhecido.' });
      }
      const iw = p.match(/^\/api\/iocs\/(\w+)\/(.+)\/watch$/);
      if (iw) {
        const kindW = iw[1].toUpperCase();
        const valueW = kindW === 'URL' ? urlOfKey(decodeURIComponent(iw[2])) : decodeURIComponent(iw[2]);
        if (!valueW) return json(route, 404, { error: 'Indicador não encontrado.' });
        const key = `${kindW}:${valueW}`;
        if (req.method() === 'DELETE') delete state.watches[key];
        else state.watches[key] = new Date().toISOString();
        return json(route, 200, { watching: req.method() !== 'DELETE' });
      }
      if (p === '/api/me/watches') {
        const watches = Object.entries(state.watches).map(([key, createdAt]) => {
          const i = key.indexOf(':');
          return { kind: key.slice(0, i), value: key.slice(i + 1), createdAt };
        });
        return json(route, 200, { watches });
      }
      const io = p.match(/^\/api\/iocs\/(\w+)\/(.+)$/);
      if (io) {
        const kind = io[1].toUpperCase();
        // URL pela chave (SHA-256 do link, item 166).
        const value = kind === 'URL' ? urlOfKey(decodeURIComponent(io[2])) : decodeURIComponent(io[2]);
        if (kind === 'URL' && !value) return json(route, 404, { error: 'Indicador não encontrado.' });
        if (!['IPV4', 'IPV6', 'DOMAIN', 'EMAIL', 'MD5', 'SHA1', 'SHA256', 'URL'].includes(kind)) return json(route, 400, { error: 'Indicador inválido.' });
        const detail = state.iocDetails[`${kind}:${value}`] ?? { ioc: { kind, value }, items: [], total: 0, firstSeen: null, lastSeen: null };
        const cover = state.allowlist.find((x) => x.kind === kind && (x.value === value || (kind === 'DOMAIN' && value.endsWith(`.${x.value}`))));
        return json(route, 200, { ...detail, watching: Boolean(state.watches[`${kind}:${value}`]), allowed: cover ? { by: cover.value, reason: cover.reason } : null });
      }
      const ex = p.match(/^\/api\/entries\/([\w-]+)\/iocs\/export$/);
      if (ex) {
        const format = url.searchParams.get('format');
        state.lastIocExport = format;
        const name = `deeplook-${ex[1]}-iocs.${format === 'csv' ? 'csv' : `${format}.json`}`;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': format === 'csv' ? 'text/csv' : 'application/json', 'Content-Disposition': `attachment; filename="${name}"` },
          body: format === 'csv' ? 'Tipo;Valor\r\n' : '{}',
        });
      }
      const ei = p.match(/^\/api\/entries\/([\w-]+)\/iocs$/);
      if (ei) {
        const e = entries.find((x) => x.id === ei[1]);
        const own = e?.sha256
          ? [{ kind: 'SHA256', value: e.sha256, source: 'SAMPLE', reportIds: [] }]
          : e?.url
            ? [{ kind: 'URL', value: e.url, source: 'SAMPLE', reportIds: [] }]
            : [];
        return json(route, 200, { iocs: state.entryIocs[ei[1]] ?? own });
      }
      const rel = p.match(/^\/api\/entries\/([\w-]+)\/related$/);
      if (rel) {
        // Funcao = resposta conforme a similaridade minima do TLSH (?similarity=, padrao 70).
        const found = state.related[rel[1]];
        const res = typeof found === 'function' ? found(Number(url.searchParams.get('similarity') ?? 70)) : found;
        return json(route, 200, res ?? { items: [], total: 0, limit: 50 });
      }
      // Analise estatica sob demanda.
      const sa = p.match(/^\/api\/entries\/([\w-]+)\/static-analysis$/);
      if (sa && req.method() === 'POST') {
        const e = entries.find((x) => x.id === sa[1]);
        e.staticInfo = state.staticResult;
        return json(route, 200, { staticInfo: e.staticInfo });
      }

      // Duplicatas: marcar conclui com o veredito da principal; desfazer restaura.
      const dupm = p.match(/^\/api\/entries\/([\w-]+)\/duplicate$/);
      if (dupm) {
        const e = entries.find((x) => x.id === dupm[1]);
        if (req.method() === 'POST') {
          const principal = entries.find((x) => x.id === body.of);
          if (!principal) return json(route, 400, { error: 'Amostra principal nao encontrada.', details: { of: ['amostra não encontrada'] } });
          e.duplicatePrev = { status: e.status, verdict: e.verdict };
          pushEvent(e.id, 'MARKED_DUPLICATE', null, principal.title);
          Object.assign(e, { duplicateOfId: principal.id, duplicateOf: { id: principal.id, title: principal.title }, status: 'COMPLETED', verdict: principal.verdict });
          principal.duplicates = [...(principal.duplicates ?? []), { id: e.id, title: e.title, createdAt: e.createdAt }];
          principal._count = { ...principal._count, duplicates: principal.duplicates.length };
          return json(route, 200, { entry: e, principal: { id: principal.id, title: principal.title } });
        }
        const principal = entries.find((x) => x.id === e.duplicateOfId);
        if (principal) {
          principal.duplicates = (principal.duplicates ?? []).filter((d) => d.id !== e.id);
          principal._count = { ...principal._count, duplicates: principal.duplicates.length };
        }
        pushEvent(e.id, 'UNMARKED_DUPLICATE', null, null);
        Object.assign(e, { duplicateOfId: null, duplicateOf: null, ...e.duplicatePrev });
        return json(route, 200, { entry: e });
      }

      // Novo relatorio (aba Relatorios): so confirma o salvamento.
      if (/^\/api\/entries\/[\w-]+\/reports$/.test(p) && req.method() === 'POST') {
        state.lastReportBody = body;
        const unknown = (body.attackTechniques ?? []).filter((t) => !ATTACK.techniques.some((x) => x.id === t));
        if (unknown.length) {
          return json(route, 400, { error: 'Dados invalidos.', details: { attackTechniques: [`técnica desconhecida: ${unknown.join(', ')}`] } });
        }
        return json(route, 201, { report: { id: `r-${Date.now()}`, ...body } });
      }
      // Revisao de relatorio (quatro olhos).
      if (p === '/api/reports/review-queue') {
        const items = reports
          .filter((r) => r.status === 'IN_REVIEW' && r.analystId !== 'u1')
          .map((r) => ({ ...r, entry: { id: r.entryId, title: entries.find((e) => e.id === r.entryId).title, type: entries.find((e) => e.id === r.entryId).type } }));
        return json(route, 200, { reports: items });
      }
      // Evidencias do relatorio (item 76): envio (multipart), legenda, exclusao e a imagem.
      const evUp = p.match(/^\/api\/reports\/([\w-]+)\/evidence$/);
      if (evUp && req.method() === 'POST') {
        const r = reports.find((x) => x.id === evUp[1]);
        const raw = req.postDataBuffer()?.toString('latin1') ?? '';
        const caption = Buffer.from(raw.match(/name="caption"\r\n\r\n([^\r]*)\r\n/)?.[1] ?? '', 'latin1').toString('utf8');
        const filename = raw.match(/filename="([^"]*)"/)?.[1] ?? '';
        state.evidenceCalls.push({ method: 'POST', report: r.id, caption, filename });
        if (/\.svg$/i.test(filename)) {
          const error = 'Envie uma imagem PNG, JPEG ou WebP (o conteúdo não é de imagem).';
          return json(route, 400, { error, details: { file: [error] } });
        }
        const evidence = { id: `ev${state.evidenceCalls.length}`, caption: caption || null, mimeType: 'image/png', width: 40, height: 30, size: 184, createdAt: '2026-10-24T12:00:00.000Z', uploadedBy: { id: 'u1', displayName: 'Ana Souza' } };
        (r.evidence ??= []).push(evidence);
        return json(route, 201, { evidence, metadataRemoved: 3 });
      }
      const evOne = p.match(/^\/api\/evidence\/([\w-]+)$/);
      if (evOne) {
        const r = reports.find((x) => (x.evidence ?? []).some((e) => e.id === evOne[1]));
        const e = r?.evidence.find((x) => x.id === evOne[1]);
        const inCase = state.cases.some((c) => c.entries.some((ce) => ce.entry.reports.some((rep) => (rep.evidence ?? []).some((x) => x.id === evOne[1]))));
        if (!e && inCase && req.method() === 'GET') {
          return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from(EVIDENCE_PNG, 'base64') });
        }
        if (!e) return json(route, 404, { error: 'Evidência não encontrada.' });
        if (req.method() === 'GET') {
          return route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from(EVIDENCE_PNG, 'base64') });
        }
        state.evidenceCalls.push({ method: req.method(), id: e.id, body });
        if (req.method() === 'PATCH') {
          e.caption = body.caption || null;
          return json(route, 200, { evidence: e });
        }
        r.evidence = r.evidence.filter((x) => x !== e);
        return json(route, 200, { ok: true });
      }
      // Versoes do relatorio (item 75): as guardadas + a atual.
      const vr = p.match(/^\/api\/reports\/([\w-]+)\/versions$/);
      if (vr) {
        if (state.role === 'USER') return json(route, 403, { error: 'Acesso negado.' });
        const r = reports.find((x) => x.id === vr[1]);
        const revs = state.reportRevisions[r.id] ?? [];
        const content = (x) => ({ summary: x.summary, findings: x.findings ?? null, iocs: x.iocs ?? null, verdict: x.verdict, attackTechniques: x.attackTechniques ?? [], status: x.status });
        const versions = [...revs.map(content), content(r)].map((v, i) => ({
          number: i + 1,
          current: i === revs.length,
          author: i === 0 ? { id: r.analyst.id, displayName: r.analyst.displayName } : revs[i - 1].editor,
          at: i === 0 ? r.createdAt : revs[i - 1].at,
          ...v,
        }));
        return json(route, 200, { versions });
      }
      const rv = p.match(/^\/api\/reports\/([\w-]+)(?:\/(submit|approve|return))?$/);
      if (rv && req.method() !== 'GET') {
        const r = reports.find((x) => x.id === rv[1]);
        const me = { id: 'u1', displayName: 'Ana Souza' };
        if (rv[2] === 'submit') Object.assign(r, { status: 'IN_REVIEW', submittedAt: new Date().toISOString(), reviewNote: null });
        if (rv[2] === 'approve') Object.assign(r, { status: 'PUBLISHED', reviewedBy: me, reviewedAt: new Date().toISOString() });
        if (rv[2] === 'return') Object.assign(r, { status: 'DRAFT', reviewedBy: me, reviewedAt: new Date().toISOString(), reviewNote: body.note });
        if (!rv[2] && body.status) r.status = body.status;
        if (!rv[2] && 'summary' in body) {
          const list = (state.reportRevisions[r.id] ??= []);
          list.push({ summary: r.summary, findings: r.findings ?? null, iocs: r.iocs ?? null, verdict: r.verdict, attackTechniques: r.attackTechniques ?? [], status: r.status, editor: me, at: new Date().toISOString() });
          Object.assign(r, { summary: body.summary, findings: body.findings || null, iocs: body.iocs || null, verdict: body.verdict ?? r.verdict, attackTechniques: body.attackTechniques ?? [], _count: { revisions: list.length } });
          state.lastReportPatch = body;
        }
        state.calls.push(`REPORT ${rv[2] ?? 'patch'} ${r.id}`);
        return json(route, 200, { report: r });
      }
      const cm = p.match(/^\/api\/entries\/([\w-]+)\/comments$/);
      if (cm && req.method() === 'POST') {
        if (state.commentError) return json(route, state.commentError.status, { error: state.commentError.error });
        const text = String(body.text ?? '').replace(/\r\n?/g, '\n').trim();
        if (!text || text.length > 4000) return json(route, 400, { error: 'Escreva a atualização (até 4000 caracteres).' });
        const list = events[cm[1]];
        if (!list) return json(route, 404, { error: 'Amostra nao encontrada.' });
        state.lastCommentBody = body;
        const mentions = users
          .filter((u) => (body.mentions ?? []).includes(u.id) && text.includes(`@${u.displayName}`))
          .map((u) => ({ id: u.id, name: u.displayName }));
        const event = {
          id: `${cm[1]}-ev${list.length}`,
          entryId: cm[1],
          type: 'COMMENT',
          detail: text,
          toValue: mentions.length ? JSON.stringify(mentions) : null,
          createdAt: new Date().toISOString(),
          actor: actorOf(users[0]),
        };
        list.push(event);
        return json(route, 201, { event });
      }
      const gm = p.match(/^\/api\/entries\/(\w+)\/graph$/);
      if (gm) {
        if (state.graphs?.[p]) return json(route, 200, state.graphs[p]);
        const ge = entries.find((x) => x.id === gm[1]);
        const center = `entry:${gm[1]}`;
        return json(route, 200, { center, nodes: [{ id: center, kind: 'ENTRY', label: ge?.title, entryId: gm[1], type: ge?.type, status: ge?.status, verdict: ge?.verdict }], edges: [], hidden: { entries: 0, iocs: 0, cases: 0 } });
      }
      const ev = p.match(/^\/api\/entries\/(\w+)\/events$/);
      if (ev) return json(route, 200, { events: events[ev[1]] ?? [] });
      if (m) {
        const e = entries.find((x) => x.id === m[1]);
        return e
          ? json(route, 200, {
              entry: { ...e, reports: reports.filter((r) => r.entryId === e.id && (state.role !== 'USER' || r.status === 'PUBLISHED')) },
              sla: SLA,
              reviewRequired: state.reviewRequired,
              retentionDays: state.retentionDays,
            })
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
      if (p === '/api/admin/activation-keys' && req.method() === 'POST') {
        const key = { id: `k${keys.length + 1}`, code: 'DL-NEW1-NEW2-NEW3', role: body.role, maxUses: body.maxUses, usesUsed: 0, expiresAt: null, revoked: false, createdAt: now };
        state.lastKeyBody = body;
        return json(route, 201, { key });
      }
      if (p === '/api/admin/activation-keys') return json(route, 200, { keys });
      return json(route, 404, { error: 'Mock sem rota: ' + p });
    }

    let file = join(DIST, decodeURIComponent(p));
    if (p === '/' || !existsSync(file) || !extname(file)) file = join(DIST, 'index.html');
    return route.fulfill({
      status: 200,
      contentType: MIME[extname(file)] || 'application/octet-stream',
      headers: { 'content-security-policy': CSP },
      body: readFileSync(file),
    });
  });
}

/** Registra erros da pagina no console do roteiro (tela branca = erro de render). */
export function watchErrors(page) {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  page.on('console', (msg) => msg.type() === 'error' && console.log('CONSOLE:', msg.text().slice(0, 300)));
}
