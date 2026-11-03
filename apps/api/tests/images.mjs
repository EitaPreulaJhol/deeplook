// Testa as imagens reais (npm run test:images): compilam pelo lockfile, a API
// sobe sem root e sem capacidades (migra, cria o admin, recebe amostra, gera e
// baixa backup com o pg_dump), e a captura abre pagina e bloqueia rede interna.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeService, runArgs } from './compose-service.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = join(HERE, '..', '..');
const TMP = join(HERE, '.tmp');
mkdirSync(TMP, { recursive: true });
writeFileSync(join(TMP, '.gitignore'), '*\n');

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
const quiet = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let fails = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fails += 1;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
};
const until = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(2000);
  }
  return null;
};

/** nginx real, com um eco no lugar da API: IP do cliente e cabecalhos (itens 112 e 115). */
async function webImage() {
  docker('build', '-q', '-t', 'dl-test-web', join(APPS, 'web'));
  ok('imagem do web compila pelo lockfile', true);
  const net = 'dl-test-web-net';
  quiet('rm', '-f', 'dl-test-echo', 'dl-test-webrun');
  docker('network', 'create', net);
  try {
    const echo =
      "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify(q.headers))}).listen(3000)";
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-echo',
      '--network',
      net,
      '--network-alias',
      'api',
      'node:26-slim',
      'node',
      '-e',
      echo,
    );
    await sleep(1500);
    // O web roda com a configuracao do compose (somente leitura, sem capacidades, limites e
    // healthcheck): o teste exercita o que vai para producao.
    const svc = composeService('web');
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-webrun',
      '--network',
      net,
      '-p',
      `58080:${svc.ports[0].target}`,
      ...runArgs(svc),
      'dl-test-web',
    );
    const up = await until(() => fetch('http://localhost:58080/').then((r) => r.ok));
    ok('web sobe', Boolean(up));
    const page = await fetch('http://localhost:58080/');
    const csp = page.headers.get('content-security-policy') ?? '';
    ok(
      'CSP sem script de fora',
      csp.includes("script-src 'self'") && !csp.includes("script-src 'self' 'unsafe"),
      csp,
    );
    // Contrato dos cabecalhos (itens 115, 4.1 e 6.7), em toda resposta, inclusive a de erro.
    const CONTRACT = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    };
    const lacking = (res) =>
      Object.entries(CONTRACT)
        .filter(([name, value]) => res.headers.get(name) !== value)
        .map(([name]) => name);
    ok('cabeçalhos de segurança em /', !lacking(page).length, lacking(page));
    ok('Server sem a versão do nginx', page.headers.get('server') === 'nginx');
    ok(
      'index.html sempre revalida',
      (page.headers.get('cache-control') ?? '').includes('no-cache'),
      page.headers.get('cache-control'),
    );
    const html = await page.text();
    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0] ?? '/assets/index.js';
    const js = await fetch(`http://localhost:58080${asset}`);
    ok('asset: 200 com os cabeçalhos de segurança', js.status === 200 && !lacking(js).length, {
      asset,
      status: js.status,
      lacking: lacking(js),
    });
    ok(
      'asset com hash: um ano de cache',
      (js.headers.get('cache-control') ?? '').includes('max-age=31536000'),
      js.headers.get('cache-control'),
    );
    ok('asset sai compactado (gzip)', js.headers.get('content-encoding') === 'gzip');
    ok(
      'asset compactado avisa o Vary: Accept-Encoding',
      (js.headers.get('vary') ?? '').toLowerCase().includes('accept-encoding'),
      js.headers.get('vary'),
    );
    const gone = await fetch('http://localhost:58080/assets/nao-existe-163.js');
    ok(
      'asset que não existe dá 404 (e não o index.html)',
      gone.status === 404 && !lacking(gone).length,
      { status: gone.status, lacking: lacking(gone) },
    );
    const route = await fetch('http://localhost:58080/entries/abc');
    ok(
      'rota da SPA cai no index.html',
      route.status === 200 && (await route.text()).includes('<div id="root">'),
    );
    // Sem root, sem capacidades, somente leitura e saudavel pelo healthcheck do compose.
    const inWeb = (...cmd) => quiet('exec', 'dl-test-webrun', ...cmd);
    const uid = inWeb('id', '-u').stdout.trim();
    ok('web roda sem root', uid !== '' && uid !== '0', uid);
    ok(
      'web sem capacidades',
      /CapEff:\s+0+\s/.test(inWeb('grep', 'CapEff', '/proc/self/status').stdout),
    );
    ok(
      'web com o sistema de arquivos somente leitura',
      inWeb('touch', '/usr/share/nginx/html/x').status !== 0,
    );
    ok(
      'compose: web somente leitura, sem capacidades e sem novos privilégios',
      svc.read_only === true &&
        svc.cap_drop?.includes('ALL') &&
        svc.security_opt?.includes('no-new-privileges:true'),
      svc,
    );
    const healthy = await until(
      async () =>
        quiet('inspect', '-f', '{{.State.Health.Status}}', 'dl-test-webrun').stdout.trim() ===
        'healthy',
    );
    ok(
      'healthcheck do compose responde (web)',
      Boolean(healthy),
      quiet('inspect', '-f', '{{json .State.Health}}', 'dl-test-webrun').stdout.slice(-500),
    );
    const seen = async (headers) =>
      (await fetch('http://localhost:58080/api/x', { headers })).json();
    const direct = await seen({});
    ok('sem proxy: vale a conexão', /^[\d.]+$/.test(direct['x-forwarded-for'] ?? ''), direct);
    const forged = await seen({ 'x-forwarded-for': '1.2.3.4' });
    ok(
      'X-Forwarded-For forjado é descartado',
      !forged['x-forwarded-for'].includes('1.2.3.4'),
      forged,
    );
    const tunnel = await seen({ 'cf-connecting-ip': '203.0.113.50' });
    ok('Tunnel: vale o CF-Connecting-IP', tunnel['x-forwarded-for'] === '203.0.113.50', tunnel);
    // Item 163: a query string (URL de vitima com token) nao vai para o log do nginx.
    await fetch('http://localhost:58080/api/search?q=token-da-vitima-163', {
      headers: { referer: 'http://localhost:58080/busca?q=referer-da-vitima-163' },
    });
    await sleep(500);
    const logs = quiet('logs', 'dl-test-webrun');
    const logged = `${logs.stdout}${logs.stderr}`;
    ok(
      'log do nginx sem query string nem referer',
      logged.includes('/api/search') && !logged.includes('vitima-163'),
      logged.slice(-600),
    );
  } finally {
    quiet('rm', '-f', 'dl-test-webrun', 'dl-test-echo');
    quiet('network', 'rm', net);
    quiet('rmi', 'dl-test-web');
  }
}

async function apiImage() {
  docker('build', '-q', '-t', 'dl-test-api', join(APPS, 'api'));
  ok('imagem da API compila pelo lockfile', true);
  const inside = (cmd) =>
    spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', 'dl-test-api', '-c', cmd], {
      encoding: 'utf8',
    });
  ok('usuário sem privilégios', inside('id -un').stdout.trim() === 'node');
  ok('não altera o próprio código', inside('touch /app/dist/x').status !== 0);
  ok(
    'sem ferramentas de desenvolvimento',
    inside('[ ! -e node_modules/.bin/tsx ] && [ ! -e node_modules/.bin/eslint ]').status === 0,
  );
  ok('pg_dump 16', inside('pg_dump --version').stdout.includes(' 16.'));

  const db = `img_${Date.now()}`;
  quiet('rm', '-f', 'dl-test-pg', 'dl-test-minio', 'dl-test-run');
  docker('network', 'create', 'dl-test-net');
  try {
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-pg',
      '--network',
      'dl-test-net',
      '-e',
      'POSTGRES_PASSWORD=pg',
      '-e',
      `POSTGRES_DB=${db}`,
      'postgres:16-alpine',
    );
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-minio',
      '--network',
      'dl-test-net',
      '-e',
      'MINIO_ROOT_USER=deeplook',
      '-e',
      'MINIO_ROOT_PASSWORD=deeplook123',
      'pgsty/silo@sha256:7bb2aff6b89efe1cb1303c10fc21d579447434ed06649ac9ec05a5e2dbf30ad7',
      'server',
      '/data',
    );
    // Como o healthcheck do compose: a API migra ao subir e precisa do banco pronto.
    await until(
      async () => quiet('exec', 'dl-test-pg', 'pg_isready', '-U', 'postgres').status === 0,
    );
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-run',
      '--network',
      'dl-test-net',
      '-p',
      '53000:3000',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      `DATABASE_URL=postgresql://postgres:pg@dl-test-pg:5432/${db}?schema=public`,
      '-e',
      'SESSION_SECRET=0123456789abcdef0123456789abcdef',
      '-e',
      'S3_ENDPOINT=http://dl-test-minio:9000',
      '-e',
      'ADMIN_EMAIL=adm@x.io',
      '-e',
      'ADMIN_PASSWORD=Senha-Inicial-77!',
      '-e',
      'CLAMAV_HOST=',
      '-e',
      'CAPTURE_URL=',
      'dl-test-api',
    );
    const base = 'http://localhost:53000/api';
    const up = await until(() => fetch(`${base}/health`).then((r) => r.ok));
    ok(
      'sobe sem root e sem capacidades',
      Boolean(up),
      up ? '' : quiet('logs', 'dl-test-run').stderr.slice(-800),
    );
    if (!up) return;
    let cookie = '';
    const call = async (path, init = {}) => {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), cookie },
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    };
    const json = (body) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const first = await (
      await call('/auth/login', json({ email: 'adm@x.io', password: 'Senha-Inicial-77!' }))
    ).json();
    ok('admin troca a senha no primeiro acesso', first.user?.mustChangePassword === true, first);
    ok('bloqueado até trocar', (await call('/entries')).status === 403);
    ok(
      'troca a senha',
      (
        await call(
          '/me/password',
          json({ currentPassword: 'Senha-Inicial-77!', newPassword: 'Nova-Senha-Forte-77!' }),
        )
      ).status === 200,
    );
    await call('/auth/login', json({ email: 'adm@x.io', password: 'Nova-Senha-Forte-77!' }));
    const form = new FormData();
    form.append('file', new Blob(['powershell -enc QQBCAEMA\nhttp://evil.top/a\n']), 'a.ps1');
    form.append('title', 'teste');
    const sent = await (await call('/entries/file', { method: 'POST', body: form })).json();
    ok('recebe e analisa amostra', sent.entry?.staticInfo?.script?.language !== undefined, sent);
    const started = await call(
      '/admin/backups',
      json({ includeSamples: true, password: 'Senha-Do-Zip-123' }),
    );
    ok('inicia o backup', started.status === 202);
    const done = await until(async () => {
      const b = (await (await call('/admin/backups')).json()).items[0];
      return b.status === 'RUNNING' ? null : b;
    }, 30);
    ok('backup pronto com o pg_dump da imagem', done?.status === 'READY', done);
    const zip = await call(`/admin/backups/${done?.id}/download`);
    ok('baixa o ZIP', zip.status === 200 && (await zip.arrayBuffer()).byteLength > 1000);
    const health = quiet(
      'exec',
      'dl-test-run',
      'node',
      '-e',
      "fetch('http://localhost:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
    );
    ok('healthcheck do compose responde', health.status === 0, health.stderr);
    const start = Date.now();
    docker('stop', '-t', '20', 'dl-test-run');
    const code = docker('inspect', '-f', '{{.State.ExitCode}}', 'dl-test-run').trim();
    ok('desligamento controlado', code === '0' && Date.now() - start < 15_000, {
      code,
      ms: Date.now() - start,
    });
    const logs = quiet('logs', 'dl-test-run');
    ok('sem erro de permissão', !/EACCES|EPERM/.test(logs.stdout + logs.stderr));
  } finally {
    quiet('rm', '-f', 'dl-test-run', 'dl-test-pg', 'dl-test-minio');
    quiet('network', 'rm', 'dl-test-net');
    quiet('rmi', 'dl-test-api');
  }
}

async function captureImage() {
  docker('build', '-q', '-t', 'dl-test-capture', join(APPS, 'capture'));
  ok('imagem da captura compila pelo lockfile', true);
  const conf = join(TMP, 'pagina.conf');
  writeFileSync(
    conf,
    `server { listen 80; server_name _;
  location = /r { return 302 http://pagina.test/final; }
  location / { default_type text/html; return 200 '<html><head><title>Pagina de Teste</title></head><body><h1>Oi</h1><img src="http://169.254.169.254/x.png"></body></html>'; }
}\n`,
  );
  quiet('rm', '-f', 'dl-test-page', 'dl-test-capt');
  docker('network', 'create', 'dl-test-capt-net');
  try {
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-page',
      '--network',
      'dl-test-capt-net',
      '--network-alias',
      'pagina.test',
      '-v',
      `${conf}:/etc/nginx/conf.d/default.conf:ro`,
      'nginx:1.27-alpine',
    );
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-capt',
      '--network',
      'dl-test-capt-net',
      '-p',
      '53100:3100',
      '-e',
      'CAPTURE_TOKEN=0123456789abcdef01',
      '-e',
      'CAPTURE_ALLOW_HOSTS=pagina.test',
      '--security-opt',
      'no-new-privileges:true',
      '--shm-size',
      '512m',
      'dl-test-capture',
    );
    const up = await until(() => fetch('http://localhost:53100/health').then((r) => r.ok));
    ok('captura sobe', Boolean(up));
    const capture = async (url, token = '0123456789abcdef01') => {
      const res = await fetch('http://localhost:53100/capture', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return { status: res.status, body: await res.json() };
    };
    ok('token errado recusado', (await capture('http://pagina.test/', 'errado')).status === 401);
    const page = (await capture('http://pagina.test/r')).body;
    ok(
      'abre a página, com print e redirecionamento',
      page.ok &&
        page.title === 'Pagina de Teste' &&
        page.screenshot?.length > 1000 &&
        page.redirects?.length === 2,
      { ...page, screenshot: undefined, html: undefined },
    );
    ok(
      'recurso interno da página bloqueado',
      page.blocked?.some((b) => b.host === '169.254.169.254'),
    );
    ok('rede interna recusada', (await capture('http://10.0.0.1/')).body.ok === false);
    ok('metadados recusados', (await capture('http://169.254.169.254/latest/')).body.ok === false);
  } finally {
    quiet('rm', '-f', 'dl-test-capt', 'dl-test-page');
    quiet('network', 'rm', 'dl-test-capt-net');
    quiet('rmi', 'dl-test-capture');
  }
}

const composeCheck = spawnSync('docker', ['compose', 'config', '-q'], {
  cwd: join(APPS, '..'),
  encoding: 'utf8',
});
ok('compose válido', composeCheck.status === 0, composeCheck.stderr);
await webImage();
await apiImage();
await captureImage();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
