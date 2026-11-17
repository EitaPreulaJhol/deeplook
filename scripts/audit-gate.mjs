// Porta do `npm audit` do CI: reprova em vulnerabilidade alta ou critica, exceto as da lista abaixo.
// Uso: node scripts/audit-gate.mjs   (dentro de apps/<app>; le o lockfile e consulta o registro).
//
// O `npm audit` nao tem como ignorar um advisory, e um `--audit-level=high` puro deixaria o CI
// vermelho por algo sem correcao. Cada excecao tem motivo e condicao para sair.
import { execFileSync } from 'node:child_process';

/** GHSA -> por que esta aceito. Remover quando houver versao corrigida. */
const ACCEPTED = new Map([
  [
    'GHSA-fc5q-39xc-vjpf',
    // picomatch: ReDoS em extglobs repetidos. Afeta todas as versoes publicadas (a 4.0.7 e a ultima),
    // entao nao ha correcao. So entra por ferramentas de lint/build (typescript-eslint, vite, vitest),
    // que rodam sobre o nosso proprio codigo, nunca sobre entrada de usuario, e nada disso vai para as imagens.
    'picomatch ReDoS (sem versao corrigida; so ferramentas de lint/build)',
  ],
]);

const LEVELS = ['high', 'critical'];

let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // O npm sai com 1 quando acha vulnerabilidade, mas o JSON vem no stdout.
  raw = err.stdout?.toString() ?? '';
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('npm audit nao devolveu JSON; nao da para decidir. Saida:\n' + raw);
  process.exit(2);
}
if (report.error) {
  console.error(`npm audit falhou: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(2);
}

// Os advisories de verdade sao os itens de `via` que sao objetos; os que sao texto so apontam
// para outro pacote da cadeia, entao decidir por advisory cobre a cadeia toda.
const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !LEVELS.includes(via.severity)) continue;
    advisories.set(via.url ?? String(via.source), via);
  }
}

let failed = 0;
for (const [url, adv] of advisories) {
  const ghsa = url.split('/').pop();
  const why = ACCEPTED.get(ghsa);
  if (why) {
    console.log(`aceito  ${adv.severity.padEnd(8)} ${adv.name}  ${url}\n        ${why}`);
  } else {
    failed++;
    console.log(
      `REPROVA ${adv.severity.padEnd(8)} ${adv.name}  ${url}\n        ${adv.title ?? ''}`,
    );
  }
}

if (advisories.size === 0) console.log('Nenhuma vulnerabilidade alta ou critica.');
if (failed) {
  console.error(`\n${failed} vulnerabilidade(s) alta(s)/critica(s) sem excecao.`);
  process.exit(1);
}
