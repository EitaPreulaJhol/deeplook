// Screenshot de uma pagina autenticada usando CDP direto (sem dependencias).
// Uso: node scripts/ui-shot.mjs <url> <saida.png> [cookie dl_session] [largura] [altura]
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, cookie, wArg = '1440', hArg = '1000'] = process.argv.slice(2);
const width = Number(wArg);
const height = Number(hArg);

if (!url || !out) {
  console.error('uso: node scripts/ui-shot.mjs <url> <saida.png> [cookie] [largura] [altura]');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge nao encontrado (defina CHROME_PATH).');
  process.exit(2);
}

const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'deeplook-shot-'));
const child = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* ainda subindo */
    }
    await sleep(250);
  }
  throw new Error('DevTools nao respondeu a tempo.');
}

const ws = new WebSocket(await targetWs());
let seq = 0;
const pending = new Map();
const events = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg.method);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', () => reject(new Error('falha ao abrir o CDP')));
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, { resolve, reject });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

await send('Page.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});

if (cookie) {
  const host = new URL(url).hostname;
  await send('Network.setCookie', {
    name: 'dl_session',
    value: cookie,
    domain: host,
    path: '/',
  });
}

await send('Page.navigate', { url });

for (let i = 0; i < 40 && !events.includes('Page.loadEventFired'); i += 1) {
  await sleep(250);
}
// Dá tempo para o React Query carregar os dados e o console conectar.
await sleep(6000);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`screenshot salvo em ${out}`);

ws.close();
child.kill();
process.exit(0);
