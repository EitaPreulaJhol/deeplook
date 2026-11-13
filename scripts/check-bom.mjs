// Arquivos versionados que comecam com o BOM do UTF-8 (plano pos-revisao, item 1.1).
//
// O BOM no inicio do .env.example ia parar no .env copiado dele, e o `. ./.env` do shell lia a
// primeira linha com o BOM grudado (`#: command not found`, ou o nome da primeira variavel
// errado). O mesmo vale para YAML, JSON e scripts lidos por ferramentas que nao o esperam.
//
// Excecao: *.ps1. O PowerShell 5.1 so le um script como UTF-8 se ele tiver BOM.
//
//   node scripts/check-bom.mjs      lista os arquivos com BOM e sai com erro se houver algum
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = /\.ps1$/i;
const BOM = [0xef, 0xbb, 0xbf];

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const head = Buffer.alloc(3);
const found = files.filter((file) => {
  if (ALLOWED.test(file)) return false;
  const path = join(root, file);
  let fd;
  try {
    if (!statSync(path).isFile()) return false;
    fd = openSync(path, 'r');
    const read = readSync(fd, head, 0, 3, 0);
    return read === 3 && BOM.every((byte, i) => head[i] === byte);
  } catch {
    // Apagado na arvore de trabalho mas ainda no indice: nao ha o que conferir.
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
});

if (found.length) {
  console.error('Arquivos com BOM no inicio (salve como UTF-8 sem BOM):');
  for (const file of found) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`Sem BOM: ${files.length} arquivos versionados conferidos.`);
