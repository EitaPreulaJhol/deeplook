// Mede as portas que o Chromium recusa (ERR_UNSAFE_PORT) e compara com a lista do proxy de saida
// da captura (UNSAFE_PORTS em apps/capture/src/proxy.mjs, item 6.20). Rode ao trocar a versao do
// Playwright: o Chromium muda a lista de tempos em tempos, e a do proxy foi medida, nao copiada.
//
//   node scripts/chromium-unsafe-ports.mjs          # portas 1 a 11000 (a maior da lista e 10080)
//   node scripts/chromium-unsafe-ports.mjs 20000    # outro teto
//
// Roda na imagem oficial do Playwright da versao do capture, sem rede (--network none): cada porta
// recusada falha antes de sair; as outras dao "conexao recusada" no loopback. Saida 1 se diferir.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNSAFE_PORTS } from '../apps/capture/src/proxy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(ROOT, 'apps/capture/package.json'), 'utf8'))
  .dependencies.playwright;
const max = Number(process.argv[2] || 11000);

const probe = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ports = Array.from({ length: ${max} }, (_, i) => i + 1);
  const unsafe = [];
  const worker = async () => {
    const page = await browser.newPage();
    for (let p = ports.shift(); p !== undefined; p = ports.shift()) {
      try {
        await page.goto('http://127.0.0.1:' + p + '/', { timeout: 5000 });
      } catch (err) {
        if (String(err.message).includes('ERR_UNSAFE_PORT')) unsafe.push(p);
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  console.log(JSON.stringify({ version: browser.version(), unsafe: unsafe.sort((a, b) => a - b) }));
  await browser.close();
})();
`;

// O pacote do Playwright e instalado numa pasta temporaria do container (com rede) e a medicao
// roda depois, num segundo container sem rede que reaproveita essa pasta.
const volume = `dl-unsafe-ports-${Date.now()}`;
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const run = (...args) => spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  console.log(`instalando playwright@${version} na imagem ${image}...`);
  const install = run(
    'run', '--rm', '-v', `${volume}:/probe`, '-w', '/probe', image,
    'sh', '-c', `npm i --no-save --no-package-lock --silent --no-audit --no-fund playwright@${version}`,
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
  console.log(`medindo as portas 1 a ${max} (sem rede)...`);
  const res = run(
    'run', '--rm', '--ipc=host', '--network', 'none', '-v', `${volume}:/probe`, '-w', '/probe',
    image, 'node', '-e', probe,
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
  const { version: chromium, unsafe } = JSON.parse(res.stdout.trim().split('\n').pop());
  const missing = unsafe.filter((p) => !UNSAFE_PORTS.has(p));
  const extra = [...UNSAFE_PORTS].filter((p) => p <= max && !unsafe.includes(p));
  console.log(`Chromium ${chromium}: ${unsafe.length} portas recusadas`);
  if (!missing.length && !extra.length) {
    console.log('ok: a lista do proxy confere com o navegador');
  } else {
    if (missing.length) console.log(`o navegador recusa e o proxy nao: ${missing.join(', ')}`);
    if (extra.length) console.log(`o proxy recusa e o navegador nao: ${extra.join(', ')}`);
    console.log(`lista medida, para o proxy.mjs:\n${JSON.stringify(unsafe)}`);
    process.exitCode = 1;
  }
} finally {
  spawnSync('docker', ['volume', 'rm', '-f', volume], { stdio: 'ignore' });
}
