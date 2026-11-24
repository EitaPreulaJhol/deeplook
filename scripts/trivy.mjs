// Roda o Trivy pela imagem oficial, com a configuracao do repositorio (trivy.yaml). E o MESMO
// comando do CI (.github/workflows/security-scan.yml): o que reprova la reprova aqui.
//
//   node scripts/trivy.mjs image deeplook-api          imagem construida (docker build -t ...)
//   node scripts/trivy.mjs image postgres:16-alpine    imagem de terceiros (o Trivy baixa)
//   node scripts/trivy.mjs config apps                 erros de configuracao nos Dockerfiles
//   node scripts/trivy.mjs sbom deeplook-api sbom/api.cdx.json
//                                                      SBOM (CycloneDX) da imagem, sem reprovar por CVE
//
// O banco de vulnerabilidades fica em ~/.cache/trivy (TRIVY_CACHE_DIR muda). A versao do
// Trivy fica fixada aqui; TRIVY_IMAGE troca (item 6.4 do plano de melhorias).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRIVY_IMAGE = process.env.TRIVY_IMAGE ?? 'aquasec/trivy:0.76.2';
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

// SBOM: inventario de pacotes da imagem em CycloneDX. Nao usa o trivy.yaml: ali ficam os limites
// de CVE (exit-code, skip-dirs), e o inventario deve listar tudo o que a imagem traz.
let trivyArgs = ['--config', 'trivy.yaml', ...args];
let outMount = [];
if (args[0] === 'sbom') {
  const [, image, outFile] = args;
  if (!image || !outFile) {
    console.error('uso: node scripts/trivy.mjs sbom <imagem> <arquivo.cdx.json>');
    process.exit(2);
  }
  const out = resolve(outFile);
  mkdirSync(dirname(out), { recursive: true });
  outMount = ['-v', `${dirname(out)}:/out`];
  trivyArgs = [
    'image',
    '--format',
    'cyclonedx',
    '--scanners',
    'license',
    '--output',
    `/out/${basename(out)}`,
    image,
  ];
}

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
    ...outMount,
    '-w',
    // No SBOM o trivy.yaml (limites de CVE, skip-dirs) nao pode valer: o diretorio de trabalho
    // fica fora do repositorio, onde o Trivy nao o procura.
    outMount.length ? '/out' : '/work',
    '-e',
    `TRIVY_DB_REPOSITORY=${DB_REPOSITORY}`,
    '-e',
    'TRIVY_NO_PROGRESS=true',
    TRIVY_IMAGE,
    ...trivyArgs,
  ],
  { stdio: 'inherit' },
);
process.exit(res.status ?? 1);
