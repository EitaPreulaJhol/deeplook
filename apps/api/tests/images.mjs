// Testa as imagens reais (npm run test:images): compilam pelo lockfile, a API
// sobe sem root e sem capacidades (migra, cria o admin, recebe amostra, gera e
// baixa backup com o pg_dump), e a captura abre pagina e bloqueia rede interna.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeService, networkArgs, runArgs } from './compose-service.mjs';

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
      `127.0.0.1:58080:${svc.ports[0].target}`,
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
      '127.0.0.1:53000:3000',
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

/**
 * Roda dentro do container da captura: os renderizadores vivos, com o namespace (comparado ao
 * do PID 1, o do container), a contagem de filtros seccomp e a flag --no-sandbox.
 */
const RENDERER_PROBE = `
const fs = require('fs');
const ns = (pid, kind) => fs.readlinkSync('/proc/' + pid + '/ns/' + kind);
const out = [];
for (const pid of fs.readdirSync('/proc').filter((p) => /^\\d+$/.test(p) && p !== String(process.pid))) {
  let cmd = '';
  try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch { continue; }
  if (!cmd.includes('--type=renderer')) continue;
  const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
  out.push({
    pid,
    ownUserNs: ns(pid, 'user') !== ns(1, 'user'),
    ownPidNs: ns(pid, 'pid') !== ns(1, 'pid'),
    seccompFilters: (/Seccomp_filters:\\s*(\\d+)/.exec(status) || [])[1],
    noSandbox: cmd.includes('--no-sandbox'),
  });
}
console.log(JSON.stringify(out));
`;

/**
 * Roda dentro do container da captura (item 6.19): tenta sair direto, sem o egress. Cada alvo
 * precisa falhar sem chegar ao destino: ECONNREFUSED tambem reprova, porque quem recusa e um
 * host que foi alcancado. E o DNS externo nao pode resolver.
 */
const DIRECT_PROBE = `
const net = require('net');
const dns = require('dns').promises;
const attempt = (host, port) => new Promise((res) => {
  const s = net.connect({ host, port });
  const t = setTimeout(() => { s.destroy(); res('timeout'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('CONECTOU'); });
  s.on('error', (e) => { clearTimeout(t); res(e.code); });
});
(async () => {
  const out = {};
  for (const target of JSON.parse(process.argv[1])) {
    const i = target.lastIndexOf(':');
    out[target] = await attempt(target.slice(0, i), Number(target.slice(i + 1)));
  }
  out.dns = await dns.lookup('example.com').then(() => 'RESOLVEU', (e) => e.code);
  console.log(JSON.stringify(out));
})();
`;

const CAPTURE_CONTAINERS = [
  'dl-test-capt',
  'dl-test-capt-nosbx',
  'dl-test-page',
  'dl-test-egress',
  'dl-test-front',
];
const CAPTURE_NETWORKS = ['dl-test-capt-net', 'dl-test-egress-net', 'dl-test-front-net'];

async function captureImage() {
  docker('build', '-q', '-t', 'dl-test-capture', join(APPS, 'capture'));
  ok('imagem da captura compila pelo lockfile', true);
  docker(
    'build',
    '-q',
    '-t',
    'dl-test-egress',
    '-f',
    join(APPS, 'capture', 'Dockerfile.egress'),
    join(APPS, 'capture'),
  );
  ok('imagem do proxy de saída compila', true);
  const conf = join(TMP, 'pagina.conf');
  writeFileSync(
    conf,
    `server { listen 80; server_name _;
  location = /r { return 302 http://pagina.test/final; }
  location = /lenta { default_type text/html; return 200 '<html><body><script>const t = Date.now() + 4000; while (Date.now() < t) {}</script>lenta</body></html>'; }
  location / { default_type text/html; return 200 '<html><head><title>Pagina de Teste</title></head><body><h1>Oi</h1><img src="http://169.254.169.254/x.png"></body></html>'; }
}\n`,
  );
  // Sobra de uma rodada interrompida (rede "already exists") nao derruba esta.
  quiet('rm', '-f', ...CAPTURE_CONTAINERS);
  for (const net of CAPTURE_NETWORKS) quiet('network', 'rm', net);
  // A topologia do compose (item 6.19): a rede da captura e interna, como no compose; so o
  // egress fica nela e na rede com saida, onde esta a pagina de teste. O "front" faz o papel da
  // API, nas duas redes, porque rede interna nao publica porta para o host.
  docker('network', 'create', ...networkArgs('capture'), 'dl-test-capt-net');
  docker('network', 'create', 'dl-test-egress-net');
  docker('network', 'create', 'dl-test-front-net');
  try {
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-page',
      '--network',
      'dl-test-egress-net',
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
      'dl-test-egress',
      '--network',
      'dl-test-capt-net',
      '--network-alias',
      'egress',
      '-e',
      'CAPTURE_ALLOW_HOSTS=pagina.test',
      ...runArgs(composeService('egress')),
      'dl-test-egress',
    );
    docker('network', 'connect', 'dl-test-egress-net', 'dl-test-egress');
    const egressUp = await until(async () =>
      docker('inspect', '-f', '{{.State.Health.Status}}', 'dl-test-egress').includes('healthy'),
    );
    ok('proxy de saída sobe saudável', Boolean(egressUp));
    const inEgress = (...args) => quiet('exec', 'dl-test-egress', ...args);
    ok(
      'proxy de saída sem root e somente leitura',
      inEgress('id', '-u').stdout?.trim() !== '0' && inEgress('touch', '/app/x').status !== 0,
    );
    const forward =
      "const net=require('net');for(const [p,h] of [[3100,'dl-test-capt'],[3101,'dl-test-capt-nosbx']])" +
      'net.createServer((c)=>{const u=net.connect(3100,h);c.pipe(u).pipe(c);' +
      "u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(p)";
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-front',
      '--network',
      'dl-test-front-net',
      '-p',
      '127.0.0.1:53100:3100',
      '-p',
      '127.0.0.1:53101:3101',
      'node:26-slim',
      'node',
      '-e',
      forward,
    );
    docker('network', 'connect', 'dl-test-capt-net', 'dl-test-front');
    // A captura roda com a configuracao do compose: sem capacidades, limites, o perfil seccomp
    // do sandbox do Chromium (item 6.16), raiz somente leitura e o reinicio que troca o
    // container a cada captura (item 6.17).
    // Sem CAPTURE_ALLOW_HOSTS aqui: quem libera a pagina de teste e o egress.
    const service = composeService('capture');
    const startCapture = (name, args) =>
      docker(
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'dl-test-capt-net',
        '-e',
        'CAPTURE_TOKEN=0123456789abcdef01',
        '-e',
        `CAPTURE_EGRESS_PROXY=${service.environment.CAPTURE_EGRESS_PROXY}`,
        ...args,
        'dl-test-capture',
      );
    startCapture('dl-test-capt', runArgs(service, { restart: true }));
    const up = await until(() => fetch('http://localhost:53100/health').then((r) => r.ok));
    ok('captura sobe', Boolean(up));
    const health = await fetch('http://localhost:53100/health').then((r) => r.json());
    ok('captura com o sandbox do Chromium ligado', health.sandbox === true, health);
    ok('captura sai pelo proxy de saída', health.egress === true, health);

    // Sem o egress, nada: nem a internet, nem a pagina na rede dele, nem o host pela bridge.
    const pageIp = docker(
      'inspect',
      '-f',
      '{{(index .NetworkSettings.Networks "dl-test-egress-net").IPAddress}}',
      'dl-test-page',
    ).trim();
    const hostIp = docker(
      'network',
      'inspect',
      '-f',
      '{{(index .IPAM.Config 0).Gateway}}',
      'dl-test-egress-net',
    ).trim();
    const targets = ['1.1.1.1:443', `${pageIp}:80`, `${hostIp}:1`];
    const directRaw =
      quiet('exec', 'dl-test-capt', 'node', '-e', DIRECT_PROBE, JSON.stringify(targets)).stdout ??
      '';
    const direct = (() => {
      try {
        return JSON.parse(directRaw);
      } catch {
        return null;
      }
    })();
    ok(
      'rede da captura sem saída direta: internet, outra rede e host inalcançáveis',
      direct !== null && targets.every((t) => !['CONECTOU', 'ECONNREFUSED'].includes(direct[t])),
      direct ?? directRaw,
    );
    ok('rede da captura sem DNS externo', direct !== null && direct.dns !== 'RESOLVEU', direct);
    const post = (url, token, port) =>
      fetch(`http://localhost:${port}/capture`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    // Como a API: entre uma captura e outra o container troca (503 ou sem conexao), e o
    // pedido espera a vez.
    const capture = async (url, token = '0123456789abcdef01', port = 53100) => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          const res = await post(url, token, port);
          if (res.status !== 503 || Date.now() > deadline) {
            return { status: res.status, body: await res.json() };
          }
          await res.body?.cancel();
        } catch (err) {
          if (Date.now() > deadline) throw err;
        }
        await sleep(500);
      }
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

    // Somente leitura: so o /tmp (tmpfs, sem executaveis) aceita escrita.
    const inCapture = (...args) => quiet('exec', 'dl-test-capt', ...args);
    const ready = () =>
      fetch('http://localhost:53100/health')
        .then((r) => r.json())
        .then((h) => h.ready === true);
    await until(ready);
    ok('raiz somente leitura', inCapture('touch', '/app/x').status !== 0);
    const tmpMount = inCapture('sh', '-c', 'grep " /tmp " /proc/mounts').stdout ?? '';
    ok(
      '/tmp em tmpfs, sem executáveis',
      /^tmpfs /.test(tmpMount) && /noexec/.test(tmpMount),
      tmpMount,
    );

    // Um container por captura: nem arquivo nem processo de uma captura chega a proxima.
    const restarts = () =>
      Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-capt').trim());
    const before = restarts();
    docker('exec', 'dl-test-capt', 'sh', '-c', 'echo sobra > /tmp/marca');
    docker('exec', '-d', 'dl-test-capt', 'sleep', '600');
    ok('captura antes da troca', (await capture('http://pagina.test/')).body.ok === true);
    const busy = await post('http://pagina.test/', '0123456789abcdef01', 53100).then(
      (r) => r.status,
      () => 'sem conexão',
    );
    ok('logo depois, o container não aceita outra', busy === 503 || busy === 'sem conexão', busy);
    await until(async () => restarts() > before && (await ready()));
    ok('container trocado depois da captura', restarts() === before + 1, {
      before,
      after: restarts(),
    });
    ok('arquivo da captura anterior sumiu', inCapture('test', '-e', '/tmp/marca').status !== 0);
    const sleeping = inCapture('sh', '-c', 'cat /proc/[0-9]*/comm').stdout ?? '';
    ok('processo deixado para trás sumiu', !/^sleep$/m.test(sleeping), sleeping);

    // Sandbox de verdade: a pagina lenta segura o renderizador vivo enquanto ele e inspecionado.
    const slow = capture('http://pagina.test/lenta');
    await new Promise((res) => setTimeout(res, 2000));
    const inspected = quiet('exec', 'dl-test-capt', 'node', '-e', RENDERER_PROBE).stdout?.trim();
    const renderers = (() => {
      try {
        return JSON.parse(inspected);
      } catch {
        return [];
      }
    })();
    ok(
      'renderizador em user e pid namespace próprios, com o seccomp do Chromium',
      renderers.length > 0 &&
        renderers.every(
          (r) => r.ownUserNs && r.ownPidNs && Number(r.seccompFilters) >= 2 && !r.noSandbox,
        ),
      inspected,
    );
    const slowResult = (await slow).body;
    ok('página lenta capturada com o sandbox', slowResult.ok === true, slowResult);

    // Sem o perfil do compose (seccomp padrao do Docker), o sandbox nao sobe e a captura diz por que.
    startCapture(
      'dl-test-capt-nosbx',
      runArgs({
        ...service,
        security_opt: service.security_opt.filter((o) => !o.startsWith('seccomp=')),
      }),
    );
    await until(() => fetch('http://localhost:53101/health').then((r) => r.ok));
    const unsandboxed = (await capture('http://pagina.test/', undefined, 53101)).body;
    ok(
      'sem o perfil seccomp: a captura falha com o motivo',
      unsandboxed.ok === false && /sandbox do Chromium/.test(unsandboxed.error ?? ''),
      unsandboxed,
    );
  } finally {
    quiet('rm', '-f', ...CAPTURE_CONTAINERS);
    for (const net of CAPTURE_NETWORKS) quiet('network', 'rm', net);
    quiet('rmi', 'dl-test-capture', 'dl-test-egress');
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
