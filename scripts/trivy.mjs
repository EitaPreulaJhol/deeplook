// Roda o Trivy pela imagem oficial, com a configuracao do repositorio (trivy.yaml). E o MESMO
// comando do CI (.github/workflows/security-scan.yml): o que reprova la reprova aqui.
//
//   node scripts/trivy.mjs image deeplook-api          imagem construida (docker build -t ...)
//   node scripts/trivy.mjs image postgres:16-alpine    imagem de terceiros (o Trivy baixa)
//   node scripts/trivy.mjs config apps                 erros de configuracao nos Dockerfiles
//
// O banco de vulnerabilidades fica em ~/.cache/trivy (TRIVY_CACHE_DIR muda). A versao do
// Trivy fica fixada aqui; TRIVY_IMAGE troca (item 6.4 do plano de melhorias).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRIVY_IMAGE = process.env.TRIVY_IMAGE ?? 'aquasec/trivy:0.76.1';
const CACHE = process.env.TRIVY_CACHE_DIR ?? join(homedir(), '.cache', 'trivy');
// Espelho do banco primeiro: o ghcr.io limita as consultas anonimas dos runners do GitHub.
const DB_REPOSITORY =
  process.env.TRIVY_DB_REPOSITORY ??
  'public.ecr.aws/aquasecurity/trivy-db:2,ghcr.io/aquasecurity/trivy-db:2';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('uso: node scripts/trivy.mjs <image|config> <alvo>');
  process.exit(2);
}

mkdirSync(CACHE, { recursive: true });
const res = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    // O socket deixa o Trivy ver as imagens montadas na maquina (ainda nao publicadas).
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${CACHE}:/root/.cache/`,
    '-v',
    `${ROOT}:/work:ro`,
    '-w',
    '/work',
    '-e',
    `TRIVY_DB_REPOSITORY=${DB_REPOSITORY}`,
    '-e',
    'TRIVY_NO_PROGRESS=true',
    TRIVY_IMAGE,
    '--config',
    'trivy.yaml',
    ...args,
  ],
  { stdio: 'inherit' },
);
process.exit(res.status ?? 1);
