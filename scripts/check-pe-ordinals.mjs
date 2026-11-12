// Confere que as duas copias do pe-ordinals.json sao iguais (revisao de novembro, item 2.9).
//
// A tabela de ordinais (DLL -> numero -> nome da funcao) e usada pela analise estatica da API e
// pelo script do Ghidra. Cada Dockerfile so enxerga a propria pasta, entao o arquivo existe duas
// vezes; se so uma copia for atualizada, a API e o Ghidra passam a dar nomes diferentes ao mesmo
// import, em silencio. Este script reprova a divergencia no CI.
//
//   node scripts/check-pe-ordinals.mjs              confere o repositorio
//   node scripts/check-pe-ordinals.mjs --root <dir> confere outra arvore (testes)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg > 0
    ? resolve(process.argv[rootArg + 1])
    : join(dirname(fileURLToPath(import.meta.url)), '..');

const COPIES = ['apps/api/src/lib/pe-ordinals.json', 'apps/ghidra/pe-ordinals.json'];

const digests = COPIES.map((file) => {
  const text = readFileSync(join(ROOT, file), 'utf8');
  JSON.parse(text);
  return createHash('sha256').update(text).digest('hex');
});

if (new Set(digests).size > 1) {
  console.error('FALHA as copias do pe-ordinals.json divergem:');
  COPIES.forEach((file, i) => console.error(`      ${digests[i].slice(0, 16)}  ${file}`));
  console.error('      Atualize as duas juntas (copie uma sobre a outra).');
  process.exit(1);
}
console.log(`ok   pe-ordinals.json igual nas ${COPIES.length} copias (${digests[0].slice(0, 16)})`);
