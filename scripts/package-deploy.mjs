#!/usr/bin/env node
// Pacote de implantacao: um .zip so com o que o servidor precisa para `docker compose up -d --build`
// (o compose constroi as imagens a partir de apps/, entao o pacote leva o codigo, nao imagens).
//
//   node scripts/package-deploy.mjs                 pacote do HEAD em release/
//   node scripts/package-deploy.mjs --ref v1.2      de um commit, tag ou branch
//   node scripts/package-deploy.mjs --out /tmp/rel  em outra pasta
//   node scripts/package-deploy.mjs --list          so lista o que entraria, sem gerar
//
// Sai de um commit pelo `git archive`: so entra o que esta versionado, entao node_modules, dist,
// data/, .env, plans/ e qualquer resto de build ficam de fora sem depender de lista. Mudanca nao
// commitada NAO entra (o script avisa). O mesmo commit gera sempre o mesmo conteudo, com o fim de
// linha do .gitattributes (o .bat do template sai em CRLF).
//
// Por cima disso, INCLUDE diz o que vai e EXCLUDE tira o que so serve para desenvolver (testes,
// lint, verificacao visual). O RELEASE.txt do pacote traz o commit e a data (export-subst do
// .gitattributes). Ao lado do .zip sai o .sha256 para conferir a copia no servidor.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** O que vai para o servidor. */
export const INCLUDE = [
  'docker-compose.yml',
  '.env.example',
  'RELEASE.txt',
  'README.md',
  'README.pt-BR.md',
  // Guias de implantacao e do Proxmox (os outros documentos sao de desenvolvimento).
  'docs/implantacao.md',
  'docs/implantacao.pt-BR.md',
  'docs/proxmox.md',
  'docs/proxmox.pt-BR.md',
  // Contextos de build de todos os servicos do compose.
  'apps',
  // Scripts que rodam no servidor ou contra ele depois de subir.
  'scripts/restore.sh',
  'scripts/chromium-unsafe-ports.mjs',
  'scripts/smoke-test.ps1',
  'scripts/smoke-sandbox.ps1',
  'scripts/ws-console-check.mjs',
  'scripts/sandbox-real-check.mjs',
  // Template Windows do sandbox: o .bat do Sysmon e os papeis de parede da VM.
  'scripts/template-windows',
  'icons/vmwallpaper',
];

/** O que sai de dentro do INCLUDE: so serve para desenvolver e testar. */
export const EXCLUDE = [
  'apps/api/tests', // o .dockerignore da API ja deixa fora do build
  'apps/netcap/tests', // idem, netcap
  'apps/*/eslint.config.mjs',
  'apps/*/vitest.config.ts',
  'apps/*/requirements.in', // fonte do requirements.txt (pip-compile); o build usa o .txt
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.mjs',
];

/** Nunca pode estar no pacote (conferido no fim, alem do git archive). */
const FORBIDDEN = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /^data\//,
  /^plans\//,
  /(^|\/)\.env$/,
  /(^|\/)__pycache__\//,
];

const pathspec = () => [
  ...INCLUDE,
  ...EXCLUDE.map((p) => `:(exclude,glob)${p.includes('*') ? p : `${p}/**`}`),
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const ref = option('--ref', 'HEAD');
const outDir = resolve(ROOT, option('--out', 'release'));
const commit = git('rev-parse', '--verify', `${ref}^{commit}`);
const short = commit.slice(0, 10);
const date = git('show', '-s', '--format=%cs', commit).replaceAll('-', '');
const files = git('ls-tree', '-r', '--name-only', commit, '--', ...pathspec())
  .split('\n')
  .filter(Boolean);

const bad = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
if (bad.length) {
  console.error(`Arquivos que nao podem ir para o servidor:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
for (const must of ['docker-compose.yml', '.env.example', 'RELEASE.txt']) {
  if (!files.includes(must)) {
    console.error(`Falta ${must} no commit ${short}.`);
    process.exit(1);
  }
}

if (process.argv.includes('--list')) {
  for (const f of files) console.log(f);
  console.log(`\n${files.length} arquivo(s) do commit ${short}.`);
  process.exit(0);
}

if (ref === 'HEAD' && git('status', '--porcelain', '--untracked-files=no')) {
  console.warn('Aviso: ha mudancas nao commitadas; o pacote sai do ultimo commit, sem elas.\n');
}

mkdirSync(outDir, { recursive: true });
const name = `deeplook-${date}-${short}`;
const zip = join(outDir, `${name}.zip`);
// --prefix: tudo dentro de uma pasta, para o unzip nao espalhar arquivos onde for aberto.
git('archive', '--format=zip', `--prefix=${name}/`, '-o', zip, commit, '--', ...pathspec());

const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(`${zip}.sha256`, `${sha}  ${name}.zip\n`);
const size = statSync(zip).size;

console.log(`Pacote: ${relative(ROOT, zip)}`);
console.log(`Commit: ${commit}`);
console.log(`Arquivos: ${files.length} · ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA-256: ${sha}`);
console.log(
  `\nNo servidor: unzip ${name}.zip && cd ${name} && cp .env.example .env (ver docs/implantacao).`,
);
