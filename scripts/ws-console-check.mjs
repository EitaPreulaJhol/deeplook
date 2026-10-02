// Verifica o tunel do console do sandbox: navegador -> nginx -> API -> console.
// Uso: node scripts/ws-console-check.mjs <sessionId> <cookie dl_session>
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', 'apps', 'api', 'package.json'));
// Reaproveita o pacote ws da API (o WebSocket global nao aceita headers).
const WebSocket = require('ws');

const [sessionId, cookie] = process.argv.slice(2);
if (!sessionId || !cookie) {
  console.error('uso: node scripts/ws-console-check.mjs <sessionId> <cookie dl_session>');
  process.exit(2);
}

const url = `ws://localhost:8080/api/sandbox/${sessionId}/console/ws`;
const ws = new WebSocket(url, ['binary'], { headers: { Cookie: `dl_session=${cookie}` } });

const timer = setTimeout(() => {
  console.error('FALHOU: nenhum frame do console em 15s.');
  process.exit(1);
}, 15_000);

ws.on('open', () => {
  console.log(`WS aberto (subprotocolo negociado: "${ws.protocol || 'nenhum'}")`);
});

ws.on('message', (data) => {
  const head = Buffer.from(data).subarray(0, 12).toString('latin1').replace(/\n/g, '\\n');
  clearTimeout(timer);
  if (head.startsWith('RFB 003.')) {
    console.log(`OK: console respondeu o handshake RFB ("${head}")`);
    ws.close();
    process.exit(0);
  }
  console.log(`OK: primeiro frame do console = "${head}"`);
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error(`FALHOU: ${err.message}`);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  if (code !== 1000) console.error(`WS fechado com ${code}: ${reason.toString()}`);
});
