// Proxy da captura encadeado no proxy de saida (item 6.19): npm test, so em loopback.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';

import { parseUpstream, startProxy } from '../src/proxy.mjs';

let page;
let echo;
let egress;
let inner;
const blocked = [];

before(async () => {
  page = http.createServer((req, res) => res.end(`pagina ${req.url}`));
  await new Promise((r) => page.listen(0, '127.0.0.1', r));
  echo = net.createServer((s) => s.pipe(s));
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  // O de saida libera so o 127.0.0.1 (o papel da internet aqui); o resto da rede interna, nao.
  egress = await startProxy({ allowHosts: new Set(['127.0.0.1']) });
  inner = await startProxy({
    upstream: { hostname: '127.0.0.1', port: egress.port },
    onBlocked: (host, reason) => blocked.push({ host, reason }),
  });
});

after(async () => {
  await inner.close();
  await egress.close();
  page.close();
  echo.close();
});

/** GET pela forma absoluta, como o Chromium fala com um proxy. */
function viaProxy(port, url) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: url, headers: { host: hostOf(url) } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

const hostOf = (url) => (url.startsWith('/') ? 'proxy' : new URL(url).host);

/** CONNECT; devolve o status e, se abriu, o eco de uma mensagem pelo tunel. */
function tunnel(port, authority, message = 'oi pelo tunel') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        resolve({ status: res.statusCode, headers: res.headers });
        return;
      }
      socket.once('data', (data) => {
        socket.destroy();
        resolve({ status: 200, echoed: data.toString() });
      });
      socket.write(message);
    });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP passa pelos dois proxies', async () => {
  const { port } = page.address();
  const res = await viaProxy(inner.port, `http://127.0.0.1:${port}/x?y=1`);
  assert.equal(res.status, 200);
  assert.equal(res.body, 'pagina /x?y=1');
});

test('HTTP para rede interna: o de saída recusa e o motivo chega à ficha', async () => {
  blocked.length = 0;
  const res = await viaProxy(inner.port, 'http://10.0.0.1/');
  assert.equal(res.status, 403);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].host, '10.0.0.1');
  assert.match(blocked[0].reason, /endereço interno/);
});

test('CONNECT passa pelos dois proxies', async () => {
  const { port } = echo.address();
  const res = await tunnel(inner.port, `127.0.0.1:${port}`);
  assert.equal(res.status, 200);
  assert.equal(res.echoed, 'oi pelo tunel');
});

test('CONNECT para metadados: recusado, com o motivo do de saída', async () => {
  blocked.length = 0;
  const res = await tunnel(inner.port, '169.254.169.254:443');
  assert.equal(res.status, 403);
  assert.equal(blocked[0]?.host, '169.254.169.254');
  assert.match(blocked[0]?.reason ?? '', /endereço interno/);
});

test('porta inválida é recusada sem derrubar o proxy', async () => {
  for (const authority of ['exemplo.test:99999', 'exemplo.test:0', 'exemplo.test:abc', ':443']) {
    assert.equal((await tunnel(egress.port, authority)).status, 400, authority);
    assert.equal((await tunnel(inner.port, authority)).status, 400, authority);
  }
  const health = await viaProxy(egress.port, '/health');
  assert.equal(health.status, 200);
});

test('proxy de saída fora do ar: 502, e não conexão direta', async () => {
  const dead = await startProxy({ upstream: { hostname: '127.0.0.1', port: 1 } });
  try {
    const { port } = echo.address();
    assert.equal((await tunnel(dead.port, `127.0.0.1:${port}`)).status, 502);
    const res = await viaProxy(dead.port, `http://127.0.0.1:${page.address().port}/`);
    assert.equal(res.status, 502);
  } finally {
    await dead.close();
  }
});

test('endereço do proxy de saída', () => {
  assert.deepEqual(parseUpstream('http://egress:3128'), { hostname: 'egress', port: 3128 });
  assert.equal(parseUpstream(''), null);
  assert.throws(() => parseUpstream('https://egress:3128'));
});
