// Cursor no console do sandbox (noVNC): sem cursor da VM, ou com um transparente, o cursor do
// sistema fica visivel (como no console do Proxmox); com um cursor visivel da VM, vale o dela. O
// servidor VNC e falso: so o aperto de mao do RFB 3.8 sem senha e, conforme o caso, uma imagem de
// cursor (pseudo-encoding Cursor, -239).
import { chromium } from 'playwright';

import { createState, ORIGIN, runningSandbox, setupMock, watchErrors } from './mock-api.mjs';

const W = 64;
const H = 48;

/** ServerInit: tamanho, formato de pixel de 32 bits (24 de profundidade, true color) e o nome. */
function serverInit() {
  const name = Buffer.from('deeplook-e1');
  const b = Buffer.alloc(24 + name.length);
  b.writeUInt16BE(W, 0);
  b.writeUInt16BE(H, 2);
  b.writeUInt8(32, 4); // bits por pixel
  b.writeUInt8(24, 5); // profundidade
  b.writeUInt8(0, 6); // little-endian
  b.writeUInt8(1, 7); // true color
  b.writeUInt16BE(255, 8);
  b.writeUInt16BE(255, 10);
  b.writeUInt16BE(255, 12);
  b.writeUInt8(16, 14);
  b.writeUInt8(8, 15);
  b.writeUInt8(0, 16);
  b.writeUInt32BE(name.length, 20);
  name.copy(b, 24);
  return b;
}

/** FramebufferUpdate com um retangulo de cursor 8x8; `visible` liga todos os bits da mascara. */
function cursorUpdate(visible) {
  const w = 8;
  const h = 8;
  const head = Buffer.alloc(4 + 12);
  head.writeUInt8(0, 0); // FramebufferUpdate
  head.writeUInt16BE(1, 2); // um retangulo
  head.writeUInt16BE(0, 4); // hotspot x
  head.writeUInt16BE(0, 6); // hotspot y
  head.writeUInt16BE(w, 8);
  head.writeUInt16BE(h, 10);
  head.writeInt32BE(-239, 12); // pseudo-encoding Cursor
  const pixels = Buffer.alloc(w * h * 4); // preto
  const mask = Buffer.alloc(Math.ceil(w / 8) * h, visible ? 0xff : 0x00);
  return Buffer.concat([head, pixels, mask]);
}

/** O que a VM falsa manda de cursor: nada, um transparente ou um visivel. */
let mode = 'none';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const state = createState({ loggedIn: true });
state.sandboxes.e1 = runningSandbox('e1', 60);
await setupMock(context, state);
await context.routeWebSocket(/\/api\/sandbox\/[\w-]+\/console\/ws$/, (ws) => {
  let step = 0;
  ws.send(Buffer.from('RFB 003.008\n'));
  ws.onMessage(() => {
    step += 1;
    if (step === 1) ws.send(Buffer.from([1, 1])); // um tipo de seguranca: None
    else if (step === 2) ws.send(Buffer.alloc(4)); // SecurityResult: ok
    else if (step === 3) {
      ws.send(serverInit());
      if (mode !== 'none') setTimeout(() => ws.send(cursorUpdate(mode === 'visible')), 300);
    }
  });
});
// O noVNC exige send, onmessage etc. no proprio prototipo do WebSocket (websock.js); o WebSocket
// simulado do routeWebSocket os herda de mais acima. Copia-os para o prototipo imediato.
await context.addInitScript(() => {
  const proto = window.WebSocket.prototype;
  for (const prop of ['send', 'close', 'binaryType', 'onerror', 'onmessage', 'onopen', 'protocol', 'readyState']) {
    if (Object.prototype.hasOwnProperty.call(proto, prop)) continue;
    for (let p = Object.getPrototypeOf(proto); p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, prop);
      if (d) {
        Object.defineProperty(proto, prop, d);
        break;
      }
    }
  }
});
const page = await context.newPage();
watchErrors(page);

let failures = 0;
const expect = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${label}${detail ? ` (${detail})` : ''}`);
};

const cursorOf = async (m) => {
  mode = m;
  await page.goto(`${ORIGIN}/sandbox/entry/e1/console`, { waitUntil: 'networkidle' });
  await page.locator('.dl-sandbox-console__state--connected').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  return page.locator('.dl-sandbox-console__screen canvas').evaluate((c) => c.style.cursor);
};

const none = await cursorOf('none');
expect('VM sem cursor: o cursor do sistema aparece', none === 'default', none);
const hidden = await cursorOf('transparent');
expect('VM com cursor transparente: o cursor do sistema aparece', hidden === 'default', hidden);
const shown = await cursorOf('visible');
expect('VM com cursor visível: vale o da VM', shown.startsWith('url('), shown.slice(0, 40));

await browser.close();
console.log(failures ? `\n${failures} falha(s)` : '\ncursor do console: tudo ok');
process.exit(failures ? 1 : 0);
