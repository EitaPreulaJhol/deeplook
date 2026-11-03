// Confere que a versao do Playwright e a mesma em todos os lugares que a repetem
// (item 6.2 do plano de melhorias).
//
// A imagem mcr.microsoft.com/playwright traz os navegadores de UMA versao, e o pacote npm
// precisa ser exatamente essa: com as duas diferentes o navegador nao abre. O CI do capture
// nao abre navegador, entao so este script pega a divergencia antes do deploy. Por isso o
// Dependabot ignora o Playwright (.github/dependabot.yml) e a troca se faz a mao, nos
// lugares abaixo, juntos.
//
//   node scripts/check-playwright-version.mjs              confere o repositorio
//   node scripts/check-playwright-version.mjs --root <dir> confere outra arvore (testes)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg > 0
    ? resolve(process.argv[rootArg + 1])
    : join(dirname(fileURLToPath(import.meta.url)), '..');

const VERSION = '(\\d+\\.\\d+\\.\\d+)';
const PLACES = [
  {
    file: 'apps/capture/package.json',
    label: 'pacote npm',
    pattern: `"playwright":\\s*"${VERSION}"`,
  },
  {
    file: 'apps/capture/Dockerfile',
    label: 'imagem da captura',
    pattern: `playwright:v${VERSION}-`,
  },
  { file: 'apps/api/tests/smoke.mjs', label: 'test:smoke', pattern: `PLAYWRIGHT = '${VERSION}'` },
  { file: 'scripts/ui-playwright/run.ps1', label: 'imagem', pattern: `playwright:v${VERSION}-` },
  { file: 'scripts/ui-playwright/run.ps1', label: 'pacote', pattern: `playwright@${VERSION}` },
  {
    file: 'scripts/ui-visual/package.json',
    label: 'suite visual',
    pattern: `"@playwright/test":\\s*"${VERSION}"`,
  },
];

const found = [];
const problems = [];
for (const place of PLACES) {
  let text;
  try {
    text = readFileSync(join(ROOT, place.file), 'utf8');
  } catch {
    problems.push(`${place.file}: arquivo não encontrado`);
    continue;
  }
  const match = new RegExp(place.pattern).exec(text);
  if (!match) {
    // Sem isto, uma reescrita do arquivo desligaria a conferencia sem ninguem notar.
    problems.push(
      `${place.file}: não achei a versão (${place.label}); ajuste o padrão deste script`,
    );
    continue;
  }
  found.push({ ...place, version: match[1] });
}

const versions = new Set(found.map((f) => f.version));
for (const f of found) console.log(`${f.version.padEnd(8)} ${f.file} (${f.label})`);
if (versions.size > 1) {
  problems.push(`versões diferentes do Playwright: ${[...versions].join(', ')}`);
}

if (problems.length) {
  console.error(`\nFALHA\n- ${problems.join('\n- ')}`);
  console.error(
    '\nSuba o Playwright em todos os lugares de uma vez (pacote, imagem, smoke e run.ps1).',
  );
  process.exit(1);
}
console.log(`\nok: Playwright ${[...versions][0]} em ${found.length} lugares`);
