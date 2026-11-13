// Testes do netcap (plano pos-revisao, item 5.4): TZSP, pcap e a API HTTP, com o servidor de
// verdade num processo filho e os pacotes mandados por UDP, como o MikroTik faria.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { frameMacs, normalizeMac, parseTzsp, pcapHeader, tzspDatagram } from '../src/tzsp.mjs';
import { dnsQueryFrame, httpFrames } from './packets.mjs';

const VM = 'BC:24:11:00:00:01';
const OTHER = 'BC:24:11:00:00:02';
const GW = '4C:5E:0C:00:00:01';
const TOKEN = '0123456789abcdef01';
const HTTP_PORT = 53700 + Math.floor(Math.random() * 200);
const UDP_PORT = HTTP_PORT + 1000;
const base = `http://127.0.0.1:${HTTP_PORT}`;
const auth = { authorization: `Bearer ${TOKEN}` };
let child;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (datagrams) =>
  new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let left = datagrams.length;
    for (const d of datagrams) {
      sock.send(d, UDP_PORT, '127.0.0.1', (err) => {
        if (err) reject(err);
        if (--left === 0) {
          sock.close();
          resolve();
        }
      });
    }
  });

before(async () => {
  child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(HTTP_PORT),
      NETCAP_TZSP_PORT: String(UDP_PORT),
      NETCAP_TOKEN: TOKEN,
      NETCAP_DIR: mkdtempSync(join(tmpdir(), 'netcap-')),
      NETCAP_MAX_MB: '1',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await sleep(100);
  }
  throw new Error('netcap nao subiu');
});

after(() => child?.kill());

test('TZSP: quadro depois da etiqueta END, com padding e etiqueta com valor', () => {
  const frame = dnsQueryFrame({
    vmMac: VM,
    gwMac: GW,
    vmIp: '10.0.0.2',
    dnsIp: '10.0.0.1',
    name: 'a.test',
  });
  assert.deepEqual(parseTzsp(tzspDatagram(frame)), frame);
  const tagged = Buffer.concat([Buffer.from([1, 0, 0, 1, 0, 0x0a, 2, 0xaa, 0xbb, 1]), frame]);
  assert.deepEqual(parseTzsp(tagged), frame);
  assert.equal(parseTzsp(Buffer.from([2, 0, 0, 1, 1])), null, 'versao errada');
  assert.equal(parseTzsp(Buffer.from([1, 0, 0, 1, 0x0a, 9])), null, 'etiqueta truncada');
  assert.equal(
    parseTzsp(Buffer.concat([Buffer.from([1, 0, 0, 0x12, 1]), frame])),
    null,
    'nao Ethernet',
  );
  assert.deepEqual(frameMacs(frame), { src: VM, dst: GW });
});

test('MAC normalizado; pcap com o cabecalho classico', () => {
  assert.equal(normalizeMac('bc-24-11-00-00-01'), VM);
  assert.equal(normalizeMac('bc2411000001'), VM);
  assert.equal(normalizeMac('nao'), null);
  const h = pcapHeader();
  assert.equal(h.readUInt32LE(0), 0xa1b2c3d4);
  assert.equal(h.readUInt32LE(20), 1);
});

test('API: sem token 401; health sem segredo', async () => {
  assert.equal((await fetch(`${base}/sessions`)).status, 401);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.state, 'livre');
  assert.equal(health.sessions, 0);
});

test('sessao grava so os quadros do MAC (nos dois sentidos) e devolve o pcap', async () => {
  const open = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's1', mac: VM.toLowerCase() }),
  });
  assert.equal(open.status, 201);
  const again = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 's2', mac: VM }),
  });
  assert.equal(again.status, 409, 'MAC em outra sessao');

  const mine = [
    dnsQueryFrame({
      vmMac: VM,
      gwMac: GW,
      vmIp: '10.0.0.2',
      dnsIp: '10.0.0.1',
      name: 'c2.evil.example',
    }),
    ...httpFrames({
      vmMac: VM,
      gwMac: GW,
      vmIp: '10.0.0.2',
      serverIp: '203.0.113.7',
      host: 'evil.example',
    }),
  ];
  const others = [
    dnsQueryFrame({ vmMac: OTHER, gwMac: GW, vmIp: '10.0.0.3', dnsIp: '10.0.0.1', name: 'x.test' }),
  ];
  await send([...mine, ...others].map(tzspDatagram));
  await send([Buffer.from('lixo')]);
  await sleep(200);

  const info = await (await fetch(`${base}/sessions/s1`, { headers: auth })).json();
  assert.equal(info.packets, mine.length);
  const pcap = await fetch(`${base}/sessions/s1/pcap`, { headers: auth });
  assert.equal(pcap.headers.get('content-type'), 'application/vnd.tcpdump.pcap');
  assert.equal(pcap.headers.get('x-packets'), String(mine.length));
  const body = Buffer.from(await pcap.arrayBuffer());
  assert.equal(body.readUInt32LE(0), 0xa1b2c3d4);
  const expected = 24 + mine.reduce((n, f) => n + 16 + f.length, 0);
  assert.equal(body.length, expected);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ignored, 2, 'o quadro de outra VM e o lixo');

  assert.equal(
    (await fetch(`${base}/sessions/s1`, { method: 'DELETE', headers: auth })).status,
    204,
  );
  assert.equal((await fetch(`${base}/sessions/s1`, { headers: auth })).status, 404);
});

test('teto do pcap: para de gravar e marca como truncado', async () => {
  await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'big', mac: VM }),
  });
  const big = Buffer.concat([
    dnsQueryFrame({ vmMac: VM, gwMac: GW, vmIp: '10.0.0.2', dnsIp: '10.0.0.1', name: 'a.test' }),
    Buffer.alloc(1400),
  ]);
  for (let i = 0; i < 9; i++) await send(Array.from({ length: 100 }, () => tzspDatagram(big)));
  await sleep(300);
  const info = await (await fetch(`${base}/sessions/big`, { headers: auth })).json();
  assert.equal(info.truncated, true);
  assert.ok(info.bytes <= 1024 * 1024, String(info.bytes));
  await fetch(`${base}/sessions/big`, { method: 'DELETE', headers: auth });
});

test('pedido invalido: id ou MAC', async () => {
  const res = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: '../x', mac: VM }),
  });
  assert.equal(res.status, 400);
});
