// Testes de integracao contra Postgres, MinIO e OpenLDAP reais, em docker.
//   npm run test:integration            todos
//   npm run test:integration -- ldap    so os que tem "ldap" no nome
//   npm run test:integration -- --clean remove os containers ao terminar
// Cada arquivo roda num banco novo; saida 1 se algum falhar.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { connect } from 'node:tls';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = join(HERE, '..');
const TMP = join(HERE, '.tmp');
const PG = 'dl-shadow-pg';
const MINIO = 'dl-minio';
const LDAP = 'dl-ldap';
const CAPA = 'dl-capa';
const GHIDRA = 'dl-ghidra';
const UNPACK = 'dl-unpack';
const OLETOOLS = 'dl-oletools';
const SURICATA = 'dl-suricata';
const EMULATE = 'dl-emulate';
const ANDROID = 'dl-android';
const EXTRACT = 'dl-extract';
const DOTNET = 'dl-dotnet';
const JAR = 'dl-jar';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
const quiet = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Sobe o container se ainda nao existir (ou so liga, se estiver parado). A configuracao vai
 * num rotulo: se ela mudou (ex.: as portas passaram a ouvir so no 127.0.0.1), o container
 * antigo e recriado, em vez de seguir de pe com a configuracao velha. Os dados sao de teste.
 */
function ensure(name, ...runArgs) {
  const config = createHash('sha256').update(JSON.stringify(runArgs)).digest('hex').slice(0, 16);
  const found = quiet(
    'inspect',
    '-f',
    '{{.State.Running}} {{index .Config.Labels "dl.config"}}',
    name,
  ).stdout?.trim();
  const [state, label] = (found ?? '').split(' ');
  if (state && label !== config) {
    docker('rm', '-f', name);
  } else if (state === 'true') {
    return;
  } else if (state === 'false') {
    docker('start', name);
    return;
  }
  docker('run', '-d', '--name', name, '--label', `dl.config=${config}`, ...runArgs);
}

async function waitFor(label, check, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await sleep(1500);
  }
  throw new Error(`${label} não respondeu`);
}

const tlsUp = (port) =>
  new Promise((res) => {
    const s = connect({ port, host: 'localhost', rejectUnauthorized: false }, () => {
      s.destroy();
      res(true);
    });
    s.on('error', () => res(false));
  });

/** CA propria e certificado com SAN localhost, e a segunda CA (a "errada"). */
function ldapCerts(dir) {
  mkdirSync(join(dir, 'certs'), { recursive: true });
  mkdirSync(join(dir, 'other'), { recursive: true });
  // Sem este arquivo o servidor gera o seu ao subir, o que pode passar de um minuto.
  if (!existsSync(join(dir, 'certs', 'dhparam.pem'))) {
    docker(
      'run',
      '--rm',
      '-v',
      `${dir}:/w`,
      'alpine:3.20',
      'sh',
      '-c',
      'apk add -q openssl >/dev/null && openssl genpkey -genparam -algorithm DH -pkeyopt group:ffdhe2048 -out /w/certs/dhparam.pem',
    );
  }
  if (existsSync(join(dir, 'certs', 'server.crt'))) return;
  const script = [
    'apk add -q openssl >/dev/null',
    'cd /w/certs',
    "openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj '/CN=DeepLook Teste CA' -keyout ca.key -out ca.crt 2>/dev/null",
    "openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' -keyout server.key -out server.csr 2>/dev/null",
    "printf 'subjectAltName=DNS:localhost,DNS:ldap.empresa.test\\n' > ext.cnf",
    'openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 3650 -extfile ext.cnf -out server.crt 2>/dev/null',
    'cd /w/other',
    "openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj '/CN=Outra CA' -keyout o.key -out ca.crt 2>/dev/null",
  ].join(' && ');
  docker('run', '--rm', '-v', `${dir}:/w`, 'alpine:3.20', 'sh', '-c', script);
}

async function startLdap() {
  const dir = join(TMP, 'ldap');
  ldapCerts(dir);
  ensure(
    LDAP,
    '--hostname',
    'ldap.empresa.test',
    '-p',
    '127.0.0.1:6389:389',
    '-p',
    '127.0.0.1:6636:636',
    '-e',
    'LDAP_DOMAIN=empresa.test',
    '-e',
    'LDAP_ADMIN_PASSWORD=adminpw',
    '-e',
    'LDAP_TLS_CRT_FILENAME=server.crt',
    '-e',
    'LDAP_TLS_KEY_FILENAME=server.key',
    '-e',
    'LDAP_TLS_CA_CRT_FILENAME=ca.crt',
    '-e',
    'LDAP_TLS_VERIFY_CLIENT=never',
    '-v',
    `${join(dir, 'certs')}:/container/service/slapd/assets/certs`,
    'osixia/openldap:1.5.0',
    '--copy-service',
  );
  const bind = [
    '-x',
    '-H',
    'ldap://localhost',
    '-D',
    'cn=admin,dc=empresa,dc=test',
    '-w',
    'adminpw',
  ];
  await waitFor('OpenLDAP', () => quiet('exec', LDAP, 'ldapwhoami', ...bind).status === 0);
  docker('cp', join(HERE, 'fixtures', 'ldap-seed.ldif'), `${LDAP}:/tmp/seed.ldif`);
  // O servidor reinicia ao fim da configuracao: so vale depois do TLS no ar e com
  // o seed gravado. -c: em rodadas seguintes as entradas ja existem.
  await waitFor('TLS do OpenLDAP', () => tlsUp(6636));
  await waitFor('seed do OpenLDAP', () => {
    quiet('exec', LDAP, 'ldapadd', '-c', ...bind, '-f', '/tmp/seed.ldif');
    const dn = 'uid=jsilva,ou=people,dc=empresa,dc=test';
    return quiet('exec', LDAP, 'ldapsearch', ...bind, '-b', dn, '-s', 'base').status === 0;
  });
}

/** Imagens de disco e atalho gerados por ferramentas reais (fica em .tmp). */
function diskFixtures() {
  const dir = join(TMP, 'disk');
  if (existsSync(join(dir, 'fatura.lnk'))) return;
  mkdirSync(dir, { recursive: true });
  docker(
    'run',
    '--rm',
    '-v',
    `${dir}:/out`,
    '-v',
    `${join(HERE, 'fixtures')}:/f:ro`,
    'alpine:3.20',
    'sh',
    '/f/gen-disk.sh',
  );
}

/**
 * Executaveis de teste da analise de PE (item 7.1), compilados por ferramentas reais num Debian
 * (mingw-w64, mcs, upx, osslsigncode) com o gabarito do pefile e do dnfile. Ficam em .tmp/pe e so
 * sao refeitos quando as fontes em fixtures/pe mudam (a primeira vez leva cerca de 40 s).
 */
function peFixtures() {
  const src = join(HERE, 'fixtures', 'pe');
  const dir = join(TMP, 'pe');
  const hash = createHash('sha256');
  for (const f of readdirSync(src).sort()) hash.update(f).update(readFileSync(join(src, f)));
  const stamp = hash.digest('hex');
  const mark = join(dir, '.fontes');
  if (existsSync(mark) && readFileSync(mark, 'utf8') === stamp) return;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  docker(
    'run',
    '--rm',
    '-e',
    `OWNER=${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    '-v',
    `${dir}:/out`,
    '-v',
    `${join(HERE, 'fixtures')}:/f:ro`,
    'debian:trixie',
    'sh',
    '/f/pe/gen.sh',
  );
  writeFileSync(mark, stamp);
}

/**
 * Servico de analise de verdade (capa, item 7.2; Ghidra, 7.3), com o endurecimento do compose e o
 * restart que troca o container a cada analise. A primeira construcao demora (o capa compila o
 * binary2strings; o Ghidra baixa 570 MB); as seguintes vem do cache do Docker.
 */
async function startService({ name, dir, port, inner, env, memory, pids, tmpfs, extra = [] }) {
  docker('build', '-q', '-t', `dl-test-${dir}`, join(API, '..', dir));
  quiet('rm', '-f', name);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--restart',
    'unless-stopped',
    '--read-only',
    '--tmpfs',
    tmpfs,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    memory,
    '--pids-limit',
    String(pids),
    '-e',
    `${env}=0123456789abcdef01`,
    ...extra.flatMap((e) => ['-e', e]),
    '-p',
    `127.0.0.1:${port}:${inner}`,
    `dl-test-${dir}`,
  );
  await waitFor(name, () =>
    fetch(`http://localhost:${port}/health`).then(
      (r) => r.ok,
      () => false,
    ),
  );
}

const startCapa = () =>
  startService({
    name: CAPA,
    dir: 'capa',
    port: 53200,
    inner: 3200,
    env: 'CAPA_TOKEN',
    memory: '3g',
    pids: 64,
    tmpfs: '/tmp:size=256m,noexec,nosuid,nodev',
  });
const startGhidra = () =>
  startService({
    name: GHIDRA,
    dir: 'ghidra',
    port: 53300,
    inner: 3300,
    env: 'GHIDRA_TOKEN',
    memory: '6g',
    pids: 256,
    tmpfs: '/tmp:size=1g,noexec,nosuid,nodev',
  });

const startOletools = () =>
  startService({
    name: OLETOOLS,
    dir: 'oletools',
    port: 53500,
    inner: 3500,
    env: 'OLETOOLS_TOKEN',
    memory: '1g',
    pids: 64,
    tmpfs: '/tmp:size=256m,noexec,nosuid,nodev',
  });

// Servicos novos (plans/novas-analises): emulacao, APK e configuracao/memoria.
const startEmulate = () =>
  startService({
    name: EMULATE,
    dir: 'emulate',
    port: 53600,
    inner: 3600,
    env: 'EMULATE_TOKEN',
    memory: '1g',
    pids: 64,
    tmpfs: '/tmp:size=256m,noexec,nosuid,nodev',
    extra: ['EMULATE_RUN_S=20'],
  });

const startAndroid = () =>
  startService({
    name: ANDROID,
    dir: 'android',
    port: 53700,
    inner: 3700,
    env: 'ANDROID_TOKEN',
    memory: '1g',
    pids: 64,
    tmpfs: '/tmp:size=512m,noexec,nosuid,nodev',
  });

const startExtract = () =>
  startService({
    name: EXTRACT,
    dir: 'extract',
    // 53800 e a do Suricata.
    port: 53900,
    inner: 3800,
    env: 'EXTRACT_TOKEN',
    memory: '2g',
    pids: 64,
    tmpfs: '/tmp:size=1g,noexec,nosuid,nodev',
  });

// Descompilacao de .NET (plans/caca-e-formatos, item 3).
const startDotnet = () =>
  startService({
    name: DOTNET,
    dir: 'dotnet',
    port: 54000,
    inner: 3900,
    env: 'DOTNET_TOKEN',
    memory: '2g',
    pids: 64,
    tmpfs: '/tmp:size=512m,noexec,nosuid,nodev',
  });

// Descompilacao de Java (CFR numa JRE headless). A JVM usa mais threads que o Python: pids 128.
const startJar = () =>
  startService({
    name: JAR,
    dir: 'jarcfr',
    port: 54100,
    inner: 4000,
    env: 'JAR_TOKEN',
    memory: '2g',
    pids: 128,
    tmpfs: '/tmp:size=512m,noexec,nosuid,nodev',
  });

const startUnpack = () =>
  startService({
    name: UNPACK,
    dir: 'unpack',
    port: 53400,
    inner: 3400,
    env: 'UNPACK_TOKEN',
    memory: '2g',
    pids: 64,
    tmpfs: '/tmp:size=1g,noexec,nosuid,nodev',
    // Teto baixo de proposito: o instalador do Inno Setup tem uns 90 arquivos.
    extra: ['UNPACK_MAX_FILES=10'],
  });

// Suricata (plano pos-revisao, 5.4): sem baixar as regras ET Open (o teste usa a regra do DeepLook).
const startSuricata = () =>
  startService({
    name: SURICATA,
    dir: 'suricata',
    port: 53800,
    inner: 3800,
    env: 'SURICATA_TOKEN',
    memory: '2g',
    pids: 128,
    tmpfs: '/tmp:size=512m,noexec,nosuid,nodev',
    extra: ['SURICATA_UPDATE_HOURS=0'],
  });

function runTest(file) {
  const db = `it_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  docker('exec', PG, 'psql', '-U', 'postgres', '-c', `create database ${db}`);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: `postgresql://postgres:pg@localhost:55432/${db}`,
    SESSION_SECRET: '0123456789abcdef0123',
    S3_ENDPOINT: 'http://localhost:59000',
    TEST_TMP: TMP,
  };
  const migrate = spawnSync(
    process.execPath,
    [join(API, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: API,
      env,
      encoding: 'utf8',
    },
  );
  if (migrate.status !== 0) return { oks: 0, failed: [`migrate: ${migrate.stderr}`], status: 1 };
  const res = spawnSync(process.execPath, ['--import', 'tsx', join(HERE, 'integration', file)], {
    cwd: API,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const lines = (res.stdout ?? '').split('\n');
  const failed = lines.filter((l) => l.startsWith('FALHA'));
  if (res.status !== 0 && !failed.length)
    failed.push((res.stderr || 'terminou com erro').slice(-1500));
  quiet('exec', PG, 'psql', '-U', 'postgres', '-c', `drop database if exists ${db}`);
  return { oks: lines.filter((l) => l.startsWith('ok')).length, failed, status: res.status };
}

const args = process.argv.slice(2);
const clean = args.includes('--clean');
const filters = args.filter((a) => !a.startsWith('--'));
const files = readdirSync(join(HERE, 'integration'))
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();

mkdirSync(TMP, { recursive: true });
writeFileSync(join(TMP, '.gitignore'), '*\n');
// Portas so no loopback: em 0.0.0.0, o Postgres (senha "pg"), o MinIO e o OpenLDAP de teste
// ficavam abertos para a rede local, e continuam de pe entre uma rodada e outra.
ensure(PG, '-e', 'POSTGRES_PASSWORD=pg', '-p', '127.0.0.1:55432:5432', 'postgres:16-alpine');
await waitFor('Postgres', () => quiet('exec', PG, 'pg_isready', '-U', 'postgres').status === 0);
// MinIO vazio a cada rodada: cada arquivo usa um banco novo, mas o bucket era o mesmo e guardava as
// amostras de todas as rodadas anteriores. Com 600 MB acumulados, o backup com amostras passou dos
// 512 MB que o inject do Fastify consegue montar numa string, e o backup.test caiu (achado K).
quiet('rm', '-f', MINIO);
ensure(
  MINIO,
  '-e',
  'MINIO_ROOT_USER=deeplook',
  '-e',
  'MINIO_ROOT_PASSWORD=deeplook123',
  '-p',
  '127.0.0.1:59000:9000',
  'pgsty/silo@sha256:c20d112390b9a9ce8c11b8af95ad35bcaa62f4759663c09c936cd8d2b511f329',
  'server',
  '/data',
);
await waitFor('MinIO', () =>
  fetch('http://localhost:59000/minio/health/live').then(
    (r) => r.ok,
    () => false,
  ),
);
if (files.some((f) => f.includes('ldap'))) await startLdap();
if (files.some((f) => f.includes('disk'))) diskFixtures();
if (
  files.some((f) =>
    /^pe-|capa|ghidra|unpack|emulate|extract|delivery|dotnet|jar|eml-msg|oletools-decrypt/.test(f),
  )
) {
  peFixtures();
}
if (files.some((f) => f.includes('capa'))) await startCapa();
if (files.some((f) => f.includes('ghidra'))) await startGhidra();
if (files.some((f) => f.includes('unpack'))) await startUnpack();
if (files.some((f) => f.includes('oletools'))) await startOletools();
if (files.some((f) => f.includes('suricata'))) await startSuricata();
if (files.some((f) => f.includes('emulate'))) await startEmulate();
if (files.some((f) => f.includes('android'))) await startAndroid();
if (files.some((f) => f.includes('extract'))) await startExtract();
if (files.some((f) => f.includes('dotnet'))) await startDotnet();
if (files.some((f) => f.includes('jar'))) await startJar();

let total = 0;
const bad = [];
for (const file of files) {
  const { oks, failed, status } = runTest(file);
  total += oks;
  console.log(`${status === 0 && !failed.length ? 'ok   ' : 'FALHA'} ${file}: ${oks} checagem(ns)`);
  for (const line of failed) console.log(`      ${line}`);
  if (status !== 0 || failed.length) bad.push(file);
}
if (clean) {
  quiet('rm', '-f', PG, MINIO, LDAP, CAPA, GHIDRA, UNPACK, OLETOOLS, SURICATA, DOTNET);
  quiet('rm', '-f', EMULATE, ANDROID, EXTRACT, JAR);
} else quiet('rm', '-f', LDAP, CAPA, GHIDRA, UNPACK, OLETOOLS, SURICATA);
console.log(
  bad.length
    ? `\n${bad.length} arquivo(s) com falha: ${bad.join(', ')}`
    : `\ntudo ok: ${total} checagens em ${files.length} arquivo(s)`,
);
process.exit(bad.length ? 1 : 0);
