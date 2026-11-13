// Artefatos do sandbox (revisao 3.7): a leitura da lista de processos que o agente devolve.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  newProcesses,
  parseLinuxProcesses,
  parseWindowsProcesses,
} from '../../src/lib/sandbox-artifacts';

test('Windows: CSV do PowerShell, com aspas dobradas e linha de comando vazia', () => {
  const out = [
    '"ProcessId","ParentProcessId","Name","CommandLine"',
    '"4","0","System",""',
    '"4410","3020","fatura.exe","""D:\\fatura.exe"" /silent, ""x"""',
    '',
    'lixo sem aspas',
  ].join('\r\n');
  assert.deepEqual(parseWindowsProcesses(out), [
    { pid: 4, ppid: 0, name: 'System', cmd: null },
    { pid: 4410, ppid: 3020, name: 'fatura.exe', cmd: '"D:\\fatura.exe" /silent, "x"' },
  ]);
});

test('Windows: sem o cabeçalho esperado, nada', () => {
  assert.deepEqual(parseWindowsProcesses('"A","B"\r\n"1","2"'), []);
  assert.deepEqual(parseWindowsProcesses(''), []);
});

test('Linux: pid, ppid, nome e argumentos', () => {
  const out =
    '    1     0 systemd /sbin/init splash\n  812     1 sshd sshd: /usr/sbin/sshd -D\n 9001   812 bash\n';
  assert.deepEqual(parseLinuxProcesses(out), [
    { pid: 1, ppid: 0, name: 'systemd', cmd: '/sbin/init splash' },
    { pid: 812, ppid: 1, name: 'sshd', cmd: 'sshd: /usr/sbin/sshd -D' },
    { pid: 9001, ppid: 812, name: 'bash', cmd: null },
  ]);
});

test('o que surgiu: pelo nome e pela linha de comando, não pelo PID', () => {
  const first = [
    { pid: 10, ppid: 1, name: 'explorer.exe', cmd: 'C:\\Windows\\Explorer.EXE' },
    { pid: 11, ppid: 1, name: 'svchost.exe', cmd: 'svchost -k netsvcs' },
  ];
  const later = [
    { pid: 99, ppid: 1, name: 'Explorer.exe', cmd: 'C:\\Windows\\Explorer.EXE' },
    { pid: 12, ppid: 1, name: 'svchost.exe', cmd: 'svchost -k other' },
    { pid: 50, ppid: 99, name: 'fatura.exe', cmd: null },
  ];
  assert.deepEqual(
    newProcesses(first, later).map((p) => p.pid),
    [12, 50],
  );
});

test('DES pelo 3DES de chaves iguais: o vetor clássico do FIPS', async () => {
  const { desEncrypt } = await import('../../src/lib/vnc-snapshot');
  const out = desEncrypt(
    Buffer.from('133457799BBCDFF1', 'hex'),
    Buffer.from('0123456789ABCDEF', 'hex'),
  );
  assert.equal(out.toString('hex').toUpperCase(), '85E813540F0AB405');
});

test('resposta VNC: senha com os bits invertidos e cortada em 8', async () => {
  const { desEncrypt, vncAuthResponse } = await import('../../src/lib/vnc-snapshot');
  const challenge = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  // "a" = 0x61 = 01100001 -> invertido 10000110 = 0x86.
  const key = Buffer.from([0x86, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(vncAuthResponse('a', challenge), desEncrypt(key, challenge));
  assert.deepEqual(
    vncAuthResponse('abcdefghEXTRA', challenge),
    vncAuthResponse('abcdefgh', challenge),
  );
});

test('PNG: assinatura, tamanho e as cores de BGRX para RGB', async () => {
  const { inflateSync } = await import('node:zlib');
  const { encodePng } = await import('../../src/lib/vnc-snapshot');
  // 2x1: vermelho e azul em BGRX.
  const png = encodePng(2, 1, Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 1);
  const idat = png.indexOf('IDAT');
  const len = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
  assert.deepEqual([...raw], [0, 255, 0, 0, 0, 0, 255]);
});

/** Servidor RFB 3.8 de teste com senha (tipo 2): tela 4x2, uma campainha e dois retangulos. */
async function rfbServer(password: string) {
  const { WebSocketServer } = await import('ws');
  const { vncAuthResponse } = await import('../../src/lib/vnc-snapshot');
  const server = new WebSocketServer({ port: 0, handleProtocols: () => 'binary' });
  server.on('connection', (socket) => {
    const challenge = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    let stage = 0;
    let pending = Buffer.alloc(0);
    socket.send(Buffer.from('RFB 003.008\n'));
    socket.on('message', (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      const take = (n: number) => {
        if (pending.length < n) return null;
        const out = pending.subarray(0, n);
        pending = pending.subarray(n);
        return out;
      };
      for (;;) {
        if (stage === 0 && take(12)) {
          socket.send(Buffer.from([1, 2]));
          stage = 1;
        } else if (stage === 1 && take(1)) {
          socket.send(challenge);
          stage = 2;
        } else if (stage === 2) {
          const answer = take(16);
          if (!answer) return;
          const good = answer.equals(vncAuthResponse(password, challenge));
          const result = Buffer.alloc(4);
          result.writeUInt32BE(good ? 0 : 1);
          socket.send(result);
          if (!good) return socket.close();
          stage = 3;
        } else if (stage === 3 && take(1)) {
          const init = Buffer.alloc(24 + 4);
          init.writeUInt16BE(4, 0);
          init.writeUInt16BE(2, 2);
          init.writeUInt32BE(4, 20);
          init.write('test', 24);
          socket.send(init);
          stage = 4;
        } else if (stage === 4 && take(20 + 8 + 10)) {
          socket.send(Buffer.from([2])); // campainha no meio
          const rect = (x: number, y: number, w: number, h: number, bgrx: number[]) => {
            const head = Buffer.alloc(12);
            head.writeUInt16BE(x, 0);
            head.writeUInt16BE(y, 2);
            head.writeUInt16BE(w, 4);
            head.writeUInt16BE(h, 6);
            return Buffer.concat([
              head,
              Buffer.from(Array.from({ length: w * h }, () => bgrx).flat()),
            ]);
          };
          const head = Buffer.from([0, 0, 0, 2]);
          // Metade esquerda vermelha (BGRX 0,0,255), direita azul (255,0,0).
          socket.send(
            Buffer.concat([
              head,
              rect(0, 0, 2, 2, [0, 0, 255, 0]),
              rect(2, 0, 2, 2, [255, 0, 0, 0]),
            ]),
          );
          stage = 5;
        } else return;
      }
    });
  });
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => server.close(),
  };
}

test('print pelo console VNC: autentica, lê o quadro e gera o PNG', async () => {
  const { inflateSync } = await import('node:zlib');
  const { vncSnapshot } = await import('../../src/lib/vnc-snapshot');
  const server = await rfbServer('s3nha!!x');
  try {
    const png = await vncSnapshot(server.url, { password: 's3nha!!x' });
    assert.equal(png.readUInt32BE(16), 4);
    assert.equal(png.readUInt32BE(20), 2);
    const idat = png.indexOf('IDAT');
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    // Linha: filtro, dois pixels vermelhos e dois azuis.
    assert.deepEqual([...raw.subarray(0, 13)], [0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
    await assert.rejects(
      vncSnapshot(server.url, { password: 'errada' }),
      /senha do console recusada/,
    );
  } finally {
    server.close();
  }
});

test('print pelo console VNC: o VNC simulado do projeto (sem senha)', async () => {
  const { WebSocketServer } = await import('ws');
  const { attachMockVnc } = await import('../../src/lib/mock-vnc');
  const { vncSnapshot } = await import('../../src/lib/vnc-snapshot');
  const server = new WebSocketServer({ port: 0, handleProtocols: () => 'binary' });
  server.on('connection', (socket) => attachMockVnc(socket));
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const png = await vncSnapshot(`ws://127.0.0.1:${(server.address() as { port: number }).port}`, {
      password: '',
    });
    assert.equal(png.readUInt32BE(16), 640);
    assert.equal(png.readUInt32BE(20), 400);
  } finally {
    server.close();
  }
});

test('print pelo console VNC: servidor que não fala RFB falha rápido e legível', async () => {
  const { WebSocketServer } = await import('ws');
  const { vncSnapshot } = await import('../../src/lib/vnc-snapshot');
  const server = new WebSocketServer({ port: 0 });
  server.on('connection', (socket) => socket.send('HTTP/1.1 400\n'));
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await assert.rejects(
      vncSnapshot(`ws://127.0.0.1:${(server.address() as { port: number }).port}`, {
        password: '',
      }),
      /não falou RFB/,
    );
  } finally {
    server.close();
  }
});
