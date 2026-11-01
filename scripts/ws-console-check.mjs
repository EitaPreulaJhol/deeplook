// Verifica o console do sandbox de ponta a ponta: navegador -> nginx -> API -> PVE.
// Faz o handshake RFB completo + auth VNC, buscando a senha do console em
// /api/sandbox/<id>/console/credentials (igual ao noVNC no painel).
// Uso: node scripts/ws-console-check.mjs <sessionId> <cookie dl_session>
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', 'apps', 'api', 'package.json'));
// Reaproveita o pacote ws da API (o WebSocket global nao aceita headers) e o
// DES do noVNC (mesmo usado pelo console no navegador).
const WebSocket = require('ws');
const { DESECBCipher } = await import(
  pathToFileURL(
    resolve(here, '..', 'apps', 'web', 'node_modules', '@novnc', 'novnc', 'core', 'crypto', 'des.js'),
  ).href
);

const [sessionId, cookie] = process.argv.slice(2);
if (!sessionId || !cookie) {
  console.error('uso: node scripts/ws-console-check.mjs <sessionId> <cookie dl_session>');
  process.exit(2);
}

const httpBase = (process.env.DEEPLOOK_BASE ?? 'http://localhost:8080').replace(/\/+$/, '');
const ws = new WebSocket(`${httpBase.replace('http', 'ws')}/api/sandbox/${sessionId}/console/ws`, [
  'binary',
], { headers: { Cookie: `dl_session=${cookie}` } });

let finished = false;
const fail = (msg) => {
  if (finished) return;
  finished = true;
  console.error(`FALHOU: ${msg}`);
  try {
    ws.close();
  } catch {
    /* noop */
  }
  process.exit(1);
};

function genDes(password, challenge) {
  const key = DESECBCipher.importKey(
    [...password].map((c) => c.charCodeAt(0)),
    { name: 'DES-ECB' },
    false,
    ['encrypt'],
  );
  return Buffer.from(key.encrypt({ name: 'DES-ECB' }, [...challenge]));
}

const timer = setTimeout(() => fail('nenhum frame do console em 20s.'), 20_000);
let step = 0;

ws.on('open', () => console.log(`WS aberto (subprotocolo "${ws.protocol || 'nenhum'}")`));

ws.on('message', async (data) => {
  const buf = Buffer.from(data);

  if (step === 0) {
    if (!buf.toString('latin1').startsWith('RFB ')) return;
    console.log(`OK: handshake RFB ("${buf.subarray(0, 12).toString('latin1').replace(/\n/g, '\\n')}")`);
    ws.send(Buffer.from('RFB 003.008\n'), { binary: true });
    step = 1;
    return;
  }

  if (step === 1) {
    const types = [...buf.subarray(1, 1 + buf[0])];
    ws.send(Buffer.from([types[0]]), { binary: true });
    step = 2;
    return;
  }

  if (step === 2) {
    // Desafio do VNC: pega a senha efemera no backend, como o painel faz.
    const res = await fetch(`${httpBase}/api/sandbox/${sessionId}/console/credentials`, {
      headers: { Cookie: `dl_session=${cookie}` },
    });
    if (!res.ok) return fail(`/console/credentials respondeu HTTP ${res.status}.`);
    const { password } = await res.json();
    if (!password) return fail('o backend nao retornou a senha do console.');
    ws.send(genDes(password, buf), { binary: true });
    step = 3;
    return;
  }

  if (step === 3) {
    if (buf.readUInt32BE(0) !== 0) return fail('auth VNC recusada pelo PVE.');
    console.log('OK: auth VNC aceita (SecurityResult=0)');
    ws.send(Buffer.from([1]), { binary: true });
    step = 4;
    return;
  }

  if (step === 4) {
    const w = buf.readUInt16BE(0);
    const h = buf.readUInt16BE(2);
    console.log(`OK: ServerInit ${w}x${h}`);
    const enc = Buffer.alloc(8);
    enc.writeUInt8(2, 0);
    enc.writeUInt16BE(1, 2);
    enc.writeInt32BE(0, 4);
    ws.send(enc, { binary: true });
    const req = Buffer.alloc(10);
    req.writeUInt8(3, 0);
    req.writeUInt8(0, 1);
    req.writeUInt16BE(w, 6);
    req.writeUInt16BE(h, 8);
    ws.send(req, { binary: true });
    step = 5;
    return;
  }

  clearTimeout(timer);
  finished = true;
  console.log(`OK: framebuffer chegando (message-type ${buf[0]}) - console funcional.`);
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => fail(err.message));
ws.on('close', (code) => fail(`WS fechado com ${code} antes de completar o console.`));

