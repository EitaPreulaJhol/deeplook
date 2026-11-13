// Testa as imagens reais (npm run test:images): compilam pelo lockfile, a API
// sobe sem root e sem capacidades (migra, cria o admin, recebe amostra, gera e
// baixa backup com o pg_dump), e a captura abre pagina e bloqueia rede interna.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeService, networkArgs, runArgs } from './compose-service.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = join(HERE, '..', '..');
const TMP = join(HERE, '.tmp');
mkdirSync(TMP, { recursive: true });
writeFileSync(join(TMP, '.gitignore'), '*\n');

// Senha propria: a padrao do compose (publica) a API recusa em producao.
const MINIO_PASSWORD = 'senha-do-minio-so-dos-testes';
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
  // O nginx so aceita o CF-Connecting-IP do gateway da rede (REAL_IP_FROM): e por onde chega
  // quem entra pela porta publicada no host, como o cloudflared.
  const gateway = docker(
    'network',
    'inspect',
    net,
    '-f',
    '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
  ).trim();
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
      '-e',
      `REAL_IP_FROM=${gateway}`,
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
    // De outro container da mesma rede (ou de um proxy que repasse o cabecalho do cliente), o
    // CF-Connecting-IP nao vale: quem o forja nao escolhe o IP que a API ve.
    const inside = quiet(
      'exec',
      'dl-test-echo',
      'node',
      '-e',
      "fetch('http://dl-test-webrun:8080/api/x',{headers:{'cf-connecting-ip':'203.0.113.66'}}).then(r=>r.json()).then(h=>console.log(h['x-forwarded-for']))",
    ).stdout.trim();
    ok(
      'CF-Connecting-IP forjado de outro container é ignorado',
      /^[\d.]+$/.test(inside) && inside !== '203.0.113.66' && inside !== gateway,
      inside,
    );
    ok(
      'compose: REAL_IP_FROM é o gateway da rede deeplook',
      svc.environment?.REAL_IP_FROM === '172.31.250.1',
      svc.environment,
    );
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
      // Com o endurecimento do compose (item 6.20): a API migra, grava e faz backup com ele.
      ...runArgs(composeService('db')),
      'postgres:16-alpine',
    );
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-minio',
      '--network',
      'dl-test-net',
      ...runArgs(composeService('minio')),
      '-e',
      'MINIO_ROOT_USER=deeplook',
      '-e',
      `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
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
      // Com o endurecimento do compose: sem capacidades, raiz somente leitura, /tmp em volume,
      // limites de memoria e de processos (revisao, item 4).
      ...runArgs(composeService('api')),
      '-e',
      `DATABASE_URL=postgresql://postgres:pg@dl-test-pg:5432/${db}?schema=public`,
      '-e',
      'SESSION_SECRET=0123456789abcdef0123456789abcdef',
      '-e',
      'S3_ENDPOINT=http://dl-test-minio:9000',
      '-e',
      `S3_SECRET_KEY=${MINIO_PASSWORD}`,
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
    const zipBytes = Buffer.from(await zip.arrayBuffer());
    ok('baixa o ZIP', zip.status === 200 && zipBytes.byteLength > 1000);
    // Restauracao (revisao de novembro, 1.2): o ensaio roda na imagem de producao, com o
    // pg_restore dela e o endurecimento do compose, num banco e bucket temporarios.
    const zipFile = join(TMP, `restore-${db}.zip`);
    writeFileSync(zipFile, zipBytes, { mode: 0o644 });
    const rehearsal = quiet(
      'run',
      '--rm',
      '--network',
      'dl-test-net',
      ...runArgs(composeService('api')),
      '-v',
      `${zipFile}:/restore/backup.zip:ro`,
      '-e',
      'RESTORE_PASSWORD=Senha-Do-Zip-123',
      '-e',
      `DATABASE_URL=postgresql://postgres:pg@dl-test-pg:5432/${db}?schema=public`,
      '-e',
      'SESSION_SECRET=0123456789abcdef0123456789abcdef',
      '-e',
      'S3_ENDPOINT=http://dl-test-minio:9000',
      '-e',
      `S3_SECRET_KEY=${MINIO_PASSWORD}`,
      '-e',
      'CLAMAV_HOST=',
      '-e',
      'CAPTURE_URL=',
      'dl-test-api',
      'node',
      'dist/restore.js',
      '/restore/backup.zip',
      '--rehearsal',
    );
    ok(
      'restauração: o ensaio roda na imagem da API e o backup volta',
      rehearsal.status === 0 && rehearsal.stdout.includes('ensaio concluído'),
      `${rehearsal.stdout}${rehearsal.stderr}`.slice(-800),
    );
    rmSync(zipFile, { force: true });
    const health = quiet(
      'exec',
      'dl-test-run',
      'node',
      '-e',
      "fetch('http://localhost:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
    );
    ok('healthcheck do compose responde', health.status === 0, health.stderr);
    // Raiz somente leitura: so o /tmp (volume em disco) aceita escrita, nem a home do node.
    const inApi = (...args) => quiet('exec', 'dl-test-run', ...args);
    ok(
      'API: raiz somente leitura, /tmp gravável',
      inApi('touch', '/home/node/x').status !== 0 &&
        inApi('touch', '/app/x').status !== 0 &&
        inApi('touch', '/tmp/x').status === 0,
    );
    ok(
      'API: Prisma sem telemetria',
      inApi('sh', '-c', 'test ! -e /tmp/.cache/checkpoint-nodejs').status === 0,
      inApi('ls', '-R', '/tmp/.cache').stdout,
    );
    // Teto de processos: o pico depois de migrar, receber amostra e gerar backup, com folga.
    const pidsMax = Number(inApi('cat', '/sys/fs/cgroup/pids.max').stdout?.trim());
    const pidsPeak = Number(inApi('cat', '/sys/fs/cgroup/pids.peak').stdout?.trim());
    console.log(`     pids: pico ${pidsPeak} de ${pidsMax}`);
    ok(
      'API: limite de processos com folga (pico abaixo da metade)',
      pidsMax > 0 && pidsPeak > 0 && pidsPeak * 2 <= pidsMax,
      { pidsPeak, pidsMax },
    );
    // Sobras de um backup ou ISO interrompido somem na subida seguinte (o /tmp sobrevive).
    inApi('mkdir', '-p', '/tmp/deeplook-backup-sobra/x', '/tmp/deeplook-iso-sobra');
    docker('restart', '-t', '20', 'dl-test-run');
    await until(() => fetch(`${base}/health`).then((r) => r.ok));
    await sleep(1000);
    ok(
      'API: sobras de backup e ISO limpas na subida',
      inApi('sh', '-c', 'ls -d /tmp/deeplook-* 2>/dev/null').stdout?.trim() === '' &&
        inApi('test', '-e', '/tmp/x').status === 0,
      inApi('ls', '/tmp').stdout,
    );
    const start = Date.now();
    docker('stop', '-t', '20', 'dl-test-run');
    const code = docker('inspect', '-f', '{{.State.ExitCode}}', 'dl-test-run').trim();
    ok('desligamento controlado', code === '0' && Date.now() - start < 15_000, {
      code,
      ms: Date.now() - start,
    });
    const logs = quiet('logs', 'dl-test-run');
    ok(
      'sem erro de permissão',
      !/EACCES|EPERM|EROFS|read-only file system/i.test(logs.stdout + logs.stderr),
    );

    // Pasta de backup (item 6.13), montada como o compose faz: o usuario sem root da imagem grava
    // no disco do host, e so ele le o ZIP. A pasta do teste e 777 para valer com qualquer uid de
    // quem roda; numa instalacao, o README manda dar a pasta ao uid 1000.
    const backupDir = join(TMP, 'pasta-backup');
    rmSync(backupDir, { recursive: true, force: true });
    mkdirSync(backupDir, { recursive: true });
    chmodSync(backupDir, 0o777);
    writeFileSync(join(backupDir, '.deeplook-backups'), '');
    docker('rm', '-f', 'dl-test-run');
    // O Postgres reinicia com os dados ja dele: e o caso que pede DAC_OVERRIDE (item 6.20).
    const caps = (name) =>
      docker(
        'inspect',
        '-f',
        '{{json .HostConfig.CapDrop}} {{json .HostConfig.CapAdd}}',
        name,
      ).trim();
    ok(
      'banco e MinIO sem as capacidades padrão, como no compose',
      /"ALL"/.test(caps('dl-test-pg')) &&
        !/NET_RAW|MKNOD|FOWNER/.test(caps('dl-test-pg')) &&
        // O Docker guarda as capacidades com o prefixo CAP_.
        /"ALL"\] \["(CAP_)?DAC_OVERRIDE"\]/.test(caps('dl-test-minio')),
      { pg: caps('dl-test-pg'), minio: caps('dl-test-minio') },
    );
    docker('restart', 'dl-test-pg');
    const pgBack = await until(
      async () => quiet('exec', 'dl-test-pg', 'pg_isready', '-U', 'postgres').status === 0,
    );
    ok('banco endurecido reinicia com os próprios dados', Boolean(pgBack));
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-run',
      '--network',
      'dl-test-net',
      '-p',
      '127.0.0.1:53000:3000',
      // Com o endurecimento do compose: sem capacidades, raiz somente leitura, /tmp em volume,
      // limites de memoria e de processos (revisao, item 4).
      ...runArgs(composeService('api')),
      '-v',
      `${backupDir}:/backups`,
      '-e',
      'BACKUP_DIR=/backups',
      '-e',
      `DATABASE_URL=postgresql://postgres:pg@dl-test-pg:5432/${db}?schema=public`,
      '-e',
      'SESSION_SECRET=0123456789abcdef0123456789abcdef',
      '-e',
      'S3_ENDPOINT=http://dl-test-minio:9000',
      '-e',
      `S3_SECRET_KEY=${MINIO_PASSWORD}`,
      '-e',
      'CLAMAV_HOST=',
      '-e',
      'CAPTURE_URL=',
      'dl-test-api',
    );
    await until(() => fetch(`${base}/health`).then((r) => r.ok));
    cookie = '';
    await call('/auth/login', json({ email: 'adm@x.io', password: 'Nova-Senha-Forte-77!' }));
    const toDir = await call('/admin/backups', json({ noPassword: true }));
    const inDir = await until(async () => {
      const b = (await (await call('/admin/backups')).json()).items[0];
      return toDir.status === 202 && b.status !== 'RUNNING' ? b : null;
    }, 30);
    const zips = readdirSync(backupDir).filter((f) => f.endsWith('.zip'));
    ok(
      'pasta de backup: o ZIP sai no disco do host',
      inDir?.status === 'READY' && zips.length === 1,
      {
        status: inDir?.status,
        error: inDir?.error,
        files: readdirSync(backupDir),
      },
    );
    if (zips.length === 1) {
      const file = join(backupDir, zips[0]);
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      ok(
        'pasta de backup: .sha256 confere, só o uid da API lê',
        readFileSync(`${file}.sha256`, 'utf8') === `${sha}  ${zips[0]}\n` &&
          (statSync(file).mode & 0o777) === 0o600 &&
          statSync(file).uid === 1000,
        { mode: (statSync(file).mode & 0o777).toString(8), uid: statSync(file).uid },
      );
      const dl = await call(`/admin/backups/${inDir.id}/download`);
      ok(
        'pasta de backup: baixa pela API',
        dl.status === 200 && (await dl.arrayBuffer()).byteLength === statSync(file).size,
      );
    }
  } finally {
    quiet('rm', '-f', 'dl-test-run', 'dl-test-pg', 'dl-test-minio');
    rmSync(join(TMP, 'pasta-backup'), { recursive: true, force: true });
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
  location = /kit { default_type text/html; return 200 '<html><body style="margin:0;font-family:sans-serif"><div style="background:#0a3d91;height:160px"></div><div style="display:flex"><div style="width:400px;height:640px;background:#f2f2f2"></div><div style="padding:40px"><h1>Banco Exemplo</h1><div style="width:500px;height:60px;background:#cccccc;margin:20px 0"></div><div style="width:500px;height:60px;background:#cccccc;margin:20px 0"></div><div style="width:200px;height:50px;background:#e60000"></div></div></div></body></html>'; }
  location = /kit2 { default_type text/html; return 200 '<html><body style="margin:0;font-family:sans-serif"><div style="background:#0b3e93;height:160px"></div><div style="display:flex"><div style="width:400px;height:640px;background:#f2f2f2"></div><div style="padding:40px"><h1>Banco Exemplo S.A. - acesse sua conta</h1><div style="width:500px;height:60px;background:#cccccc;margin:20px 0"></div><div style="width:500px;height:60px;background:#cccccc;margin:20px 0"></div><div style="width:200px;height:50px;background:#e60000"></div></div></div></body></html>'; }
  location = /outra { default_type text/html; return 200 '<html><body style="margin:0"><div style="height:400px;background:linear-gradient(90deg,#000,#fff)"></div><div style="height:400px;background:linear-gradient(90deg,#fff,#000)"></div></body></html>'; }
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
    // Hash perceptual do print (revisao de novembro, 3.4): o mesmo layout com outro texto e outra
    // cor de cabecalho fica perto; outro layout fica longe; pagina quase em branco tambem tem hash.
    const bits = (a, b) =>
      [...Buffer.from(a, 'hex')].reduce(
        (sum, byte, i) =>
          sum + (byte ^ Buffer.from(b, 'hex')[i]).toString(2).replace(/0/g, '').length,
        0,
      );
    const hashOf = async (path) => (await capture(`http://pagina.test${path}`)).body.screenshotHash;
    const [kit, kit2, other] = [
      await hashOf('/kit'),
      await hashOf('/kit2'),
      await hashOf('/outra'),
    ];
    ok(
      'hash perceptual: 64 dígitos hexadecimais em toda captura',
      [page.screenshotHash, kit, kit2, other].every((h) => /^[0-9a-f]{64}$/.test(h ?? '')),
      { oi: page.screenshotHash, kit, kit2, other },
    );
    ok(
      'hash perceptual: mesmo layout com outro texto fica perto (90% ou mais)',
      kit && kit2 && bits(kit, kit2) <= 25,
      { distance: kit && kit2 ? bits(kit, kit2) : null },
    );
    ok('hash perceptual: outro layout fica longe', kit && other && bits(kit, other) > 60, {
      distance: kit && other ? bits(kit, other) : null,
    });
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

const CAPA_CONTAINERS = ['dl-test-capa', 'dl-test-capa-front'];
const CAPA_NETWORKS = ['dl-test-capa-net', 'dl-test-capa-front-net'];

/**
 * Analise de funcoes (item 7.2): o servico capa com a configuracao do compose (raiz somente
 * leitura, /tmp em memoria sem executaveis, sem capacidades, sem root, limites e o restart que
 * troca o container a cada analise) e na rede interna "analysis". O "front" faz o papel da API.
 */
async function capaImage() {
  docker('build', '-q', '-t', 'dl-test-capa', join(APPS, 'capa'));
  ok('imagem do capa compila pelo lockfile (hashes) e com regras conferidas', true);
  quiet('rm', '-f', ...CAPA_CONTAINERS);
  for (const net of CAPA_NETWORKS) quiet('network', 'rm', net);
  docker('network', 'create', ...networkArgs('analysis'), 'dl-test-capa-net');
  docker('network', 'create', 'dl-test-capa-front-net');
  const TOKEN = '0123456789abcdef01';
  try {
    const service = composeService('capa');
    const env = Object.entries(service.environment ?? {})
      .filter(([k]) => k !== 'CAPA_TOKEN')
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-capa',
      '--network',
      'dl-test-capa-net',
      '--network-alias',
      'capa',
      '-e',
      `CAPA_TOKEN=${TOKEN}`,
      ...env,
      ...runArgs(service, { restart: true }),
      'dl-test-capa',
    );
    const forward =
      "const net=require('net');net.createServer((c)=>{const u=net.connect(3200,'capa');" +
      "c.pipe(u).pipe(c);u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(3200)";
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-capa-front',
      '--network',
      'dl-test-capa-front-net',
      '-p',
      '127.0.0.1:53210:3200',
      'node:26-slim',
      'node',
      '-e',
      forward,
    );
    docker('network', 'connect', 'dl-test-capa-net', 'dl-test-capa-front');
    const base = 'http://localhost:53210';
    const health = await until(() => fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)));
    ok(
      'capa sobe com a configuração do compose (versões no /health)',
      health?.state === 'livre' && health.capa === '10.0.0' && health.rules === '10.0.0',
      health,
    );
    const inCapa = (...args) => quiet('exec', 'dl-test-capa', ...args);
    ok('capa sem root', inCapa('id', '-u').stdout?.trim() === '10001');
    ok(
      'capa: raiz somente leitura; /tmp gravável e sem execução',
      inCapa('touch', '/opt/capa/x').status !== 0 &&
        inCapa('sh', '-c', 'cp /bin/true /tmp/t && /tmp/t').status !== 0 &&
        inCapa('sh', '-c', 'echo ok > /tmp/ok').status === 0,
    );
    const capEff = inCapa(
      'sh',
      '-c',
      "grep CapEff /proc/1/status | awk '{print $2}'",
    ).stdout?.trim();
    ok('capa sem capacidades', capEff === '0000000000000000', capEff);
    const egress = inCapa(
      'python',
      '-c',
      "import socket;s=socket.socket();s.settimeout(3);s.connect(('1.1.1.1',80))",
    );
    ok('capa sem saída para a internet', egress.status !== 0);
    const post = (body, token = TOKEN) =>
      fetch(`${base}/analyze`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body,
      });
    ok('capa: token errado recusado', (await post(Buffer.from('MZ'), 'errado')).status === 401);
    ok('capa: só executáveis', (await post(Buffer.from('só texto'))).status === 415);
    const big = await post(Buffer.alloc(33 * 1024 * 1024, 0x41)).then(
      (r) => r.status,
      (e) => String(e?.cause?.code ?? e),
    );
    ok('capa: acima do teto recusado com resposta (não conexão derrubada)', big === 413, big);
    // Um ELF de verdade, tirado da propria imagem: o capa le as regras do cache pronto (com a raiz
    // somente leitura, ele nao conseguiria grava-lo) e responde.
    const elf = execFileSync('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'cat',
      'dl-test-capa',
      '/bin/true',
    ]);
    const before = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-capa').trim());
    const analysis = await (await post(elf)).json();
    ok(
      'capa analisa com a raiz somente leitura',
      analysis.ok === true &&
        analysis.kind === 'elf' &&
        analysis.capa?.format === 'elf' &&
        !analysis.capaError,
      analysis,
    );
    const swapped = await until(async () => {
      const count = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-capa').trim());
      if (count <= before) return null;
      const h = await fetch(`${base}/health`).then((r) => r.json());
      return h.state === 'livre';
    });
    ok('capa: container novo depois da análise, livre de novo', Boolean(swapped));
  } finally {
    quiet('rm', '-f', ...CAPA_CONTAINERS);
    for (const net of CAPA_NETWORKS) quiet('network', 'rm', net);
    quiet('rmi', 'dl-test-capa');
  }
}

const GHIDRA_CONTAINERS = ['dl-test-ghidra', 'dl-test-ghidra-front'];
const GHIDRA_NETWORKS = ['dl-test-ghidra-net', 'dl-test-ghidra-front-net'];

/**
 * Analise com o Ghidra (item 7.3): o servico com a configuracao do compose, na rede interna
 * "analysis" (sem internet), como o capa. O "front" faz o papel da API.
 */
async function ghidraImage() {
  docker('build', '-q', '-t', 'dl-test-ghidra', join(APPS, 'ghidra'));
  ok('imagem do Ghidra compila (pacote e guava conferidos pelo hash)', true);
  quiet('rm', '-f', ...GHIDRA_CONTAINERS);
  for (const net of GHIDRA_NETWORKS) quiet('network', 'rm', net);
  docker('network', 'create', ...networkArgs('analysis'), 'dl-test-ghidra-net');
  docker('network', 'create', 'dl-test-ghidra-front-net');
  const TOKEN = '0123456789abcdef01';
  try {
    const service = composeService('ghidra');
    const env = Object.entries(service.environment ?? {})
      .filter(([k]) => k !== 'GHIDRA_TOKEN')
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-ghidra',
      '--network',
      'dl-test-ghidra-net',
      '--network-alias',
      'ghidra',
      '-e',
      `GHIDRA_TOKEN=${TOKEN}`,
      ...env,
      ...runArgs(service, { restart: true }),
      'dl-test-ghidra',
    );
    const forward =
      "const net=require('net');net.createServer((c)=>{const u=net.connect(3300,'ghidra');" +
      "c.pipe(u).pipe(c);u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(3300)";
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-ghidra-front',
      '--network',
      'dl-test-ghidra-front-net',
      '-p',
      '127.0.0.1:53310:3300',
      'node:26-slim',
      'node',
      '-e',
      forward,
    );
    docker('network', 'connect', 'dl-test-ghidra-net', 'dl-test-ghidra-front');
    const base = 'http://localhost:53310';
    const health = await until(() => fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)));
    ok(
      'Ghidra sobe com a configuração do compose',
      health?.state === 'livre' && health.ghidra === '12.2',
      health,
    );
    const inGhidra = (...args) => quiet('exec', 'dl-test-ghidra', ...args);
    ok('Ghidra sem root', inGhidra('id', '-u').stdout?.trim() === '10002');
    ok(
      'Ghidra: raiz somente leitura; /tmp gravável e sem execução',
      inGhidra('touch', '/opt/ghidra/x').status !== 0 &&
        inGhidra('sh', '-c', 'cp /bin/true /tmp/t && /tmp/t').status !== 0 &&
        inGhidra('sh', '-c', 'echo ok > /tmp/ok').status === 0,
    );
    const capEff = inGhidra(
      'sh',
      '-c',
      "grep CapEff /proc/1/status | awk '{print $2}'",
    ).stdout?.trim();
    ok('Ghidra sem capacidades', capEff === '0000000000000000', capEff);
    const egress = inGhidra(
      'python3',
      '-c',
      "import socket;s=socket.socket();s.settimeout(3);s.connect(('1.1.1.1',80))",
    );
    ok('Ghidra sem saída para a internet', egress.status !== 0);
    ok(
      'Ghidra: sem o guava 32 (CVE) e sem o yajsw',
      inGhidra('sh', '-c', 'ls /opt/ghidra/Ghidra/Framework/Generic/lib').stdout?.includes(
        'guava-33.7.2',
      ) &&
        !inGhidra('sh', '-c', 'ls /opt/ghidra/Ghidra/Framework/Generic/lib').stdout?.includes(
          'guava-32',
        ) &&
        inGhidra('sh', '-c', 'ls -d /opt/ghidra/Ghidra/Features/GhidraServer/data/yajsw-*')
          .status !== 0,
    );
    const post = (body, token = TOKEN) =>
      fetch(`${base}/analyze`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body,
      });
    ok('Ghidra: token errado recusado', (await post(Buffer.from('MZ'), 'errado')).status === 401);
    ok('Ghidra: só executáveis', (await post(Buffer.from('só texto'))).status === 415);
    // Um ELF de verdade, tirado da propria imagem: o Ghidra analisa e empacota com a raiz somente
    // leitura (tudo o que ele grava vai para o /tmp).
    const elf = execFileSync('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'cat',
      'dl-test-ghidra',
      '/bin/true',
    ]);
    const before = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-ghidra').trim());
    const analysis = await (await post(elf)).json();
    ok(
      'Ghidra analisa e empacota o projeto com a raiz somente leitura',
      analysis.ok === true &&
        /ELF/.test(analysis.summary?.format ?? '') &&
        analysis.summary.functions > 5 &&
        typeof analysis.gzf === 'string' &&
        analysis.gzf.length > 1000,
      { ok: analysis.ok, error: analysis.error, gzfError: analysis.gzfError },
    );
    const swapped = await until(async () => {
      const count = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-ghidra').trim());
      if (count <= before) return null;
      const h = await fetch(`${base}/health`).then((r) => r.json());
      return h.state === 'livre';
    });
    ok('Ghidra: container novo depois da análise, livre de novo', Boolean(swapped));
  } finally {
    quiet('rm', '-f', ...GHIDRA_CONTAINERS);
    for (const net of GHIDRA_NETWORKS) quiet('network', 'rm', net);
    quiet('rmi', 'dl-test-ghidra');
  }
}

const UNPACK_CONTAINERS = ['dl-test-unpack', 'dl-test-unpack-front'];
const UNPACK_NETWORKS = ['dl-test-unpack-net', 'dl-test-unpack-front-net'];

/** Desempacotar e extrair (item 7.8): o servico com a configuracao do compose, como o capa. */
async function unpackImage() {
  docker('build', '-q', '-t', 'dl-test-unpack', join(APPS, 'unpack'));
  ok('imagem do unpack compila (pyinstxtractor conferido pelo hash)', true);
  quiet('rm', '-f', ...UNPACK_CONTAINERS);
  for (const net of UNPACK_NETWORKS) quiet('network', 'rm', net);
  docker('network', 'create', ...networkArgs('analysis'), 'dl-test-unpack-net');
  docker('network', 'create', 'dl-test-unpack-front-net');
  const TOKEN = '0123456789abcdef01';
  try {
    const service = composeService('unpack');
    const env = Object.entries(service.environment ?? {})
      .filter(([k]) => k !== 'UNPACK_TOKEN')
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-unpack',
      '--network',
      'dl-test-unpack-net',
      '--network-alias',
      'unpack',
      '-e',
      `UNPACK_TOKEN=${TOKEN}`,
      ...env,
      ...runArgs(service, { restart: true }),
      'dl-test-unpack',
    );
    const forward =
      "const net=require('net');net.createServer((c)=>{const u=net.connect(3400,'unpack');" +
      "c.pipe(u).pipe(c);u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(3400)";
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-unpack-front',
      '--network',
      'dl-test-unpack-front-net',
      '-p',
      '127.0.0.1:53410:3400',
      'node:26-slim',
      'node',
      '-e',
      forward,
    );
    docker('network', 'connect', 'dl-test-unpack-net', 'dl-test-unpack-front');
    const base = 'http://localhost:53410';
    const health = await until(() => fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)));
    ok(
      'unpack sobe com a configuração do compose, o Detect It Easy e os desempacotadores',
      health?.state === 'livre' &&
        health.die === '3.21' &&
        ['upx', 'pyinstaller', 'inno', 'nsis', 'archive'].every((u) =>
          health.unpackers?.includes(u),
        ),
      health,
    );
    const inUnpack = (...args) => quiet('exec', 'dl-test-unpack', ...args);
    ok('unpack sem root', inUnpack('id', '-u').stdout?.trim() === '10003');
    ok(
      'unpack: raiz somente leitura; /tmp gravável e sem execução',
      inUnpack('touch', '/app/x').status !== 0 &&
        inUnpack('sh', '-c', 'cp /bin/true /tmp/t && /tmp/t').status !== 0 &&
        inUnpack('sh', '-c', 'echo ok > /tmp/ok').status === 0,
    );
    const capEff = inUnpack(
      'sh',
      '-c',
      "grep CapEff /proc/1/status | awk '{print $2}'",
    ).stdout?.trim();
    ok('unpack sem capacidades', capEff === '0000000000000000', capEff);
    const egress = inUnpack(
      'python3',
      '-c',
      "import socket;s=socket.socket();s.settimeout(3);s.connect(('1.1.1.1',80))",
    );
    ok('unpack sem saída para a internet', egress.status !== 0);
    const post = (body, token = TOKEN) =>
      fetch(`${base}/analyze`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body,
      });
    ok('unpack: token errado recusado', (await post(Buffer.from('MZ'), 'errado')).status === 401);
    // Um ELF empacotado com o upx da propria imagem (fora do servico, num container descartavel).
    const packed = execFileSync('docker', [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'dl-test-unpack',
      '-c',
      'upx -q -o /tmp/t.upx /bin/true >/dev/null && cat /tmp/t.upx',
    ]);
    const before = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-unpack').trim());
    const res = await post(packed);
    const zipPath = join(TMP, 'unpack-resposta.zip');
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    const listing = spawnSync('python3', [
      '-c',
      "import json,sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));print(json.dumps({'m':m,'n':z.namelist()}))",
      zipPath,
    ]);
    const answer = listing.status === 0 ? JSON.parse(listing.stdout) : null;
    ok(
      'unpack identifica e desempacota com a raiz somente leitura e devolve o ZIP com o manifesto',
      res.headers.get('content-type') === 'application/zip' &&
        answer?.m.ok === true &&
        answer.m.unpacker === 'upx' &&
        answer.m.files.length === 1 &&
        // O Detect It Easy le o banco de assinaturas com a raiz somente leitura.
        answer.m.detections.some((d) => d.type.toLowerCase() === 'packer' && d.name === 'UPX') &&
        answer.n.includes('f0001'),
      answer?.m,
    );
    const swapped = await until(async () => {
      const count = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-unpack').trim());
      if (count <= before) return null;
      const h = await fetch(`${base}/health`).then((r) => r.json());
      return h.state === 'livre';
    });
    ok('unpack: container novo depois do trabalho, livre de novo', Boolean(swapped));
  } finally {
    quiet('rm', '-f', ...UNPACK_CONTAINERS);
    for (const net of UNPACK_NETWORKS) quiet('network', 'rm', net);
    quiet('rmi', 'dl-test-unpack');
  }
}

/** Quadros de teste (DNS da regra do DeepLook e uma conversa HTTP) num pcap, como o netcap grava. */
async function testPcap() {
  const { pcapHeader, pcapRecord } = await import('../../netcap/src/tzsp.mjs');
  const { dnsQueryFrame, httpFrames } = await import('../../netcap/tests/packets.mjs');
  const net = { vmMac: 'BC:24:11:00:00:01', gwMac: '4C:5E:0C:00:00:01', vmIp: '10.10.0.2' };
  const frames = [
    dnsQueryFrame({ ...net, dnsIp: '10.10.0.1', name: 'deeplook-teste.invalid' }),
    ...httpFrames({ ...net, serverIp: '203.0.113.7', host: 'evil.example', path: '/x.bin' }),
  ];
  let t = Date.now();
  return {
    frames,
    pcap: Buffer.concat([pcapHeader(), ...frames.map((f) => pcapRecord(f, (t += 5)))]),
  };
}

/** Captura de rede (plano pos-revisao, 5.4): netcap com o endurecimento do compose. */
async function netcapImage() {
  docker('build', '-q', '-t', 'dl-test-netcap', join(APPS, 'netcap'));
  ok('imagem do netcap compila', true);
  quiet('rm', '-f', 'dl-test-netcap');
  const TOKEN = '0123456789abcdef01';
  try {
    const service = composeService('netcap');
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-netcap',
      '-e',
      `NETCAP_TOKEN=${TOKEN}`,
      ...runArgs(service),
      '-p',
      '127.0.0.1:53710:3700',
      '-p',
      '127.0.0.1:54710:37008/udp',
      'dl-test-netcap',
    );
    const base = 'http://localhost:53710';
    const health = await until(() => fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)));
    ok('netcap sobe com a configuração do compose', health?.state === 'livre', health);
    const inNetcap = (...args) => quiet('exec', 'dl-test-netcap', ...args);
    ok('netcap sem root', inNetcap('id', '-u').stdout?.trim() === '1000');
    ok(
      'netcap: raiz somente leitura; /data gravável e sem execução',
      inNetcap('touch', '/app/x').status !== 0 &&
        inNetcap('sh', '-c', 'cp /bin/true /data/t && /data/t').status !== 0 &&
        inNetcap('sh', '-c', 'echo ok > /data/ok').status === 0,
    );
    const capEff = inNetcap(
      'sh',
      '-c',
      "grep CapEff /proc/1/status | awk '{print $2}'",
    ).stdout?.trim();
    ok('netcap sem capacidades', capEff === '0000000000000000', capEff);
    ok('netcap sem npm na imagem', inNetcap('sh', '-c', 'command -v npm').status !== 0);
    const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const open = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ id: 's1', mac: 'BC:24:11:00:00:01' }),
    });
    const { tzspDatagram } = await import('../../netcap/src/tzsp.mjs');
    const { frames } = await testPcap();
    const { createSocket } = await import('node:dgram');
    const sock = createSocket('udp4');
    for (const f of frames) {
      await new Promise((r) => sock.send(tzspDatagram(f), 54710, '127.0.0.1', () => r()));
    }
    sock.close();
    const got = await until(async () => {
      const s = await fetch(`${base}/sessions/s1`, { headers: auth }).then((r) => r.json());
      return s.packets === frames.length ? s : null;
    });
    ok(
      'netcap recebe o TZSP pela porta UDP publicada e grava o pcap',
      open.status === 201 && got?.packets === frames.length,
      got,
    );
  } finally {
    quiet('rm', '-f', 'dl-test-netcap');
    quiet('rmi', 'dl-test-netcap');
  }
}

/** Suricata (plano pos-revisao, 5.4): sem baixar regras (sem egress aqui), so a regra de teste. */
async function suricataImage() {
  docker('build', '-q', '-t', 'dl-test-suricata', join(APPS, 'suricata'));
  ok('imagem do Suricata compila', true);
  quiet('rm', '-f', 'dl-test-suricata');
  const TOKEN = '0123456789abcdef01';
  try {
    const service = composeService('suricata');
    const env = Object.entries(service.environment ?? {})
      .filter(
        ([k]) =>
          !['SURICATA_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'SURICATA_UPDATE_HOURS'].includes(k),
      )
      .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    docker(
      'run',
      '-d',
      '--name',
      'dl-test-suricata',
      '-e',
      `SURICATA_TOKEN=${TOKEN}`,
      '-e',
      'SURICATA_UPDATE_HOURS=0',
      ...env,
      ...runArgs(service, { restart: true }),
      '-p',
      '127.0.0.1:53810:3800',
      'dl-test-suricata',
    );
    const base = 'http://localhost:53810';
    const health = await until(() => fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)));
    ok(
      'Suricata sobe com a configuração do compose (7.0)',
      health?.state === 'livre' && String(health.suricata).startsWith('7.0'),
      health,
    );
    const inSuricata = (...args) => quiet('exec', 'dl-test-suricata', ...args);
    ok('Suricata sem root', inSuricata('id', '-u').stdout?.trim() === '10007');
    ok(
      'Suricata: raiz somente leitura; regras no volume; /tmp sem execução',
      inSuricata('touch', '/app/x').status !== 0 &&
        inSuricata('touch', '/var/lib/suricata/rules/x').status === 0 &&
        inSuricata('sh', '-c', 'cp /bin/true /tmp/t && /tmp/t').status !== 0,
    );
    const capEff = inSuricata(
      'sh',
      '-c',
      "grep CapEff /proc/1/status | awk '{print $2}'",
    ).stdout?.trim();
    ok('Suricata sem capacidades', capEff === '0000000000000000', capEff);
    const post = (body, token = TOKEN) =>
      fetch(`${base}/analyze`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body,
      });
    ok('Suricata: token errado recusado', (await post(Buffer.from('x'), 'errado')).status === 401);
    const before = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-suricata').trim());
    const { pcap } = await testPcap();
    const result = await (await post(pcap)).json();
    ok(
      'Suricata lê o pcap: o alerta da regra de teste, o DNS e o HTTP',
      result.ok === true &&
        result.alerts.some((a) => a.sid === 9900001) &&
        result.dns.some((d) => d.name === 'deeplook-teste.invalid') &&
        result.http.some((h) => h.host === 'evil.example' && h.url === '/x.bin'),
      result,
    );
    const swapped = await until(async () => {
      const count = Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-test-suricata').trim());
      if (count <= before) return null;
      const h = await fetch(`${base}/health`).then((r) => r.json());
      return h.state === 'livre';
    });
    ok('Suricata: container novo depois do trabalho, livre de novo', Boolean(swapped));
    const notPcap = await (await post(Buffer.from('MZ isto nao e um pcap'))).json();
    ok(
      'Suricata: arquivo que não é pcap recusado',
      notPcap.ok === false && /pcap/.test(notPcap.error),
      notPcap,
    );
  } finally {
    quiet('rm', '-f', 'dl-test-suricata');
    quiet('rmi', 'dl-test-suricata');
  }
}

const composeCheck = spawnSync('docker', ['compose', 'config', '-q'], {
  cwd: join(APPS, '..'),
  encoding: 'utf8',
});
ok('compose válido', composeCheck.status === 0, composeCheck.stderr);
// `node tests/images.mjs netcap suricata` roda so essas imagens; sem nomes, todas.
const only = process.argv.slice(2);
const images = {
  web: webImage,
  api: apiImage,
  capture: captureImage,
  capa: capaImage,
  ghidra: ghidraImage,
  unpack: unpackImage,
  netcap: netcapImage,
  suricata: suricataImage,
};
for (const [name, run] of Object.entries(images)) {
  if (!only.length || only.includes(name)) await run();
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
process.exit(fails ? 1 : 0);
