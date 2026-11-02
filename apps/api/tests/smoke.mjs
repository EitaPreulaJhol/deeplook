// Teste rapido contra a API real (npm run test:smoke, item 124): navegador real com
// as imagens do web e da API, mais Postgres e MinIO, numa rede propria. Complementa
// os cenarios de tela, que usam a API simulada: o roteiro esta em
// scripts/ui-playwright/smoke.mjs. Nao mexe na stack em execucao.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = join(HERE, '..', '..');
const SCENARIOS = join(APPS, '..', 'scripts', 'ui-playwright');
const NET = 'dl-smoke-net';
const CONTAINERS = ['dl-smoke-web', 'dl-smoke-api', 'dl-smoke-pg', 'dl-smoke-minio'];
const PLAYWRIGHT = '1.64.1';
const ADMIN = { email: 'adm@x.io', password: 'Senha-Inicial-77!' };

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
const quiet = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const until = async (label, fn, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await sleep(2000);
  }
  throw new Error(`${label} não respondeu`);
};
const run = (name, ...args) => docker('run', '-d', '--name', name, '--network', NET, ...args);

/** So o que nao e rotina no log da API (nivel acima de info). */
const apiErrors = () =>
  (quiet('logs', '--tail', '200', 'dl-smoke-api').stdout ?? '')
    .split('\n')
    .filter((line) => !line.includes('"level":30'))
    .join('\n');

function cleanup() {
  quiet('rm', '-f', ...CONTAINERS);
  quiet('network', 'rm', NET);
  quiet('rmi', 'dl-smoke-web-img', 'dl-smoke-api-img');
}

let status = 1;
cleanup();
try {
  console.log('compilando as imagens do web e da API...');
  docker('build', '-q', '-t', 'dl-smoke-web-img', join(APPS, 'web'));
  docker('build', '-q', '-t', 'dl-smoke-api-img', join(APPS, 'api'));
  docker('network', 'create', NET);
  run('dl-smoke-pg', '-e', 'POSTGRES_PASSWORD=pg', '-e', 'POSTGRES_DB=smoke', 'postgres:16-alpine');
  run(
    'dl-smoke-minio',
    '-e',
    'MINIO_ROOT_USER=deeplook',
    '-e',
    'MINIO_ROOT_PASSWORD=deeplook123',
    'pgsty/silo@sha256:7bb2aff6b89efe1cb1303c10fc21d579447434ed06649ac9ec05a5e2dbf30ad7',
    'server',
    '/data',
  );
  // A API migra ao subir e precisa do banco pronto.
  await until(
    'Postgres',
    () => quiet('exec', 'dl-smoke-pg', 'pg_isready', '-U', 'postgres').status === 0,
  );
  run(
    'dl-smoke-api',
    '--network-alias',
    'api',
    '-e',
    'DATABASE_URL=postgresql://postgres:pg@dl-smoke-pg:5432/smoke?schema=public',
    '-e',
    'SESSION_SECRET=0123456789abcdef0123456789abcdef',
    '-e',
    'S3_ENDPOINT=http://dl-smoke-minio:9000',
    '-e',
    `ADMIN_EMAIL=${ADMIN.email}`,
    '-e',
    `ADMIN_PASSWORD=${ADMIN.password}`,
    '-e',
    'CLAMAV_HOST=',
    '-e',
    'CAPTURE_URL=',
    'dl-smoke-api-img',
  );
  const health =
    "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))";
  await until('API', () => quiet('exec', 'dl-smoke-api', 'node', '-e', health).status === 0);
  run('dl-smoke-web', 'dl-smoke-web-img');
  const res = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--ipc=host',
      '--network',
      NET,
      '-v',
      `${SCENARIOS}:/work`,
      '-w',
      '/work',
      '-e',
      'SMOKE_URL=http://dl-smoke-web',
      '-e',
      `SMOKE_ADMIN_EMAIL=${ADMIN.email}`,
      '-e',
      `SMOKE_ADMIN_PASSWORD=${ADMIN.password}`,
      `mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble`,
      'sh',
      '-c',
      `npm i --no-save --no-package-lock --silent --no-audit --no-fund playwright@${PLAYWRIGHT} && node smoke.mjs`,
    ],
    { stdio: 'inherit' },
  );
  status = res.status ?? 1;
  if (status !== 0) {
    console.log('--- erros no log da API ---');
    console.log(apiErrors());
  }
} catch (err) {
  console.error(err.message);
  console.log(apiErrors());
} finally {
  cleanup();
}
process.exit(status);
