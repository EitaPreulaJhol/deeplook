import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Captura de rede pelo MikroTik e Suricata (plano pos-revisao, item 5.4), ponta a ponta e sem o
// CHR: um servidor que imita a API REST do RouterOS, o netcap de verdade (processo filho), os
// quadros mandados por TZSP como o sniffer faria, o Proxmox simulado e o Suricata de verdade (o
// container do servico, so com a regra de teste do DeepLook).

/** RouterOS falso: o estado do sniffer e cada chamada recebida. */
function fakeRouterOs(user: string, password: string) {
  const state = {
    running: false,
    macs: '',
    streaming: '',
    calls: [] as string[],
    refuse: false,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (state.refuse || req.headers.authorization !== auth) {
        return send(401, { error: 401, message: 'Unauthorized' });
      }
      const path = req.url ?? '';
      state.calls.push(`${req.method} ${path}`);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.method === 'GET' && path === '/rest/tool/sniffer') {
        return send(200, {
          running: String(state.running),
          'filter-mac-address': state.macs,
          'streaming-enabled': 'true',
          'streaming-server': state.streaming,
        });
      }
      if (req.method === 'GET' && path === '/rest/system/resource') {
        return send(200, { version: '7.16.2 (stable)' });
      }
      if (req.method === 'POST' && path === '/rest/tool/sniffer/set') {
        if ('filter-mac-address' in body) state.macs = body['filter-mac-address'];
        if ('streaming-server' in body) state.streaming = body['streaming-server'];
        return send(200, []);
      }
      if (req.method === 'POST' && path === '/rest/tool/sniffer/start') {
        state.running = true;
        return send(200, []);
      }
      if (req.method === 'POST' && path === '/rest/tool/sniffer/stop') {
        state.running = false;
        return send(200, []);
      }
      return send(400, { error: 400, detail: 'no such command' });
    });
  });
  return { server, state };
}

async function main() {
  const tmp = mkdtempSync(join(process.env.TEST_TMP!, 'netcap-'));
  // genisoimage falso (a imagem da API traz o de verdade): a ISO nao importa no Proxmox simulado.
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'genisoimage'),
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then shift; : > "$1"; fi; shift; done\n',
  );
  chmodSync(join(bin, 'genisoimage'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;

  const router = fakeRouterOs('deeplook', 'senha-do-routeros');
  await new Promise<void>((r) => router.server.listen(0, '127.0.0.1', () => r()));
  const routerPort = (router.server.address() as AddressInfo).port;

  // netcap de verdade, num processo filho.
  const httpPort = 54700 + Math.floor(Math.random() * 200);
  const udpPort = httpPort + 1000;
  const token = '0123456789abcdef01';
  const netcap = spawn(
    process.execPath,
    [join(__dirname, '..', '..', '..', 'netcap', 'src', 'server.mjs')],
    {
      env: {
        ...process.env,
        PORT: String(httpPort),
        NETCAP_TZSP_PORT: String(udpPort),
        NETCAP_TOKEN: token,
        NETCAP_DIR: join(tmp, 'pcap'),
      },
      stdio: 'ignore',
    },
  );

  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  process.env.MIKROTIK_URL = `http://127.0.0.1:${routerPort}`;
  process.env.MIKROTIK_USER = 'deeplook';
  process.env.MIKROTIK_PASSWORD = 'senha-do-routeros';
  process.env.NETCAP_URL = `http://127.0.0.1:${httpPort}`;
  process.env.NETCAP_TOKEN = token;
  process.env.NETCAP_STREAM_TARGET = `127.0.0.1:${udpPort}`;
  process.env.SURICATA_URL = 'http://localhost:53800';
  process.env.SURICATA_TOKEN = token;
  const { PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { env } = await import('../../src/env');
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket, s3 } = await import('../../src/lib/s3');
  const { mockMac, pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { createSession, dispose } = await import('../../src/lib/sandbox');
  const { captureKeysOf, captureTiming, reconcileCaptures, startCapture } =
    await import('../../src/lib/network-capture');
  const { startSuricataQueue, stopSuricataQueue, suricataIdle, suricataTiming } =
    await import('../../src/lib/suricata');
  const { riskOf } = await import('../../src/lib/risk-score');
  const { systemStatus } = await import('../../src/lib/status');
  const { tzspDatagram } = await import('../../../netcap/src/tzsp.mjs');
  const { dnsQueryFrame, httpFrames } = await import('../../../netcap/tests/packets.mjs');
  const { buildApp } = await import('../../src/app');
  await ensureBucket(3, 500);
  pveMockReset();
  captureTiming.drainMs = 300;
  suricataTiming.serviceWaitMs = 120_000;
  suricataTiming.retryEveryMs = 1000;
  const quiet = { info: () => undefined, error: () => undefined };
  await startSuricataQueue(quiet);

  for (let i = 0; i < 50; i++) {
    const up = await fetch(`${env.NETCAP_URL}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) break;
    await sleep(100);
  }

  const app = await buildApp();
  await app.ready();
  const passwordHash = await hashPassword('senha-123!');
  const ana = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  const cookie = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const get = (url: string, lang = 'pt-BR') =>
    app.inject({ method: 'GET', url, headers: { cookie, 'accept-language': lang } });

  const key = `samples/teste-${Date.now()}.exe`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: Buffer.from('MZ') }));
  const entry = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.exe',
      ownerId: ana.id,
      storageKey: key,
      bucket: env.S3_BUCKET,
      originalFilename: 'fatura.exe',
      sha256: 'a'.repeat(64),
    },
  });

  // ---- 1. Abrir o ambiente: a captura comeca antes de ligar a VM.
  const created = await createSession(entry, ana.id);
  ok('ambiente criado', created.ok, created);
  const sessionId = created.ok ? created.session.id : '';
  let session = null;
  for (let i = 0; i < 60; i++) {
    session = await prisma.sandboxSession.findUnique({ where: { id: sessionId } });
    if (session?.status === 'RUNNING' || session?.status === 'FAILED') break;
    await sleep(250);
  }
  ok('VM em execução', session?.status === 'RUNNING', session);
  const mac = mockMac(session!.vmid!);
  const capture = await prisma.networkCapture.findUnique({ where: { sessionId } });
  ok(
    'captura aberta com o MAC da VM (net0)',
    capture?.status === 'CAPTURING' && capture.mac === mac,
    capture,
  );
  ok(
    'sniffer do RouterOS: o MAC, o destino do TZSP e ligado',
    router.state.running &&
      router.state.macs === mac &&
      router.state.streaming === env.NETCAP_STREAM_TARGET &&
      router.state.calls.join() ===
        'POST /rest/tool/sniffer/stop,POST /rest/tool/sniffer/set,POST /rest/tool/sniffer/start',
    router.state,
  );
  const sessions = await fetch(`${env.NETCAP_URL}/sessions`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<{ sessions: { id: string; mac: string }[] }>);
  ok(
    'sessão aberta no netcap',
    sessions.sessions.some((s) => s.id === sessionId && s.mac === mac),
  );

  // ---- 2. O trafego da VM chega por TZSP (e o de outra VM e ignorado).
  const net = { vmMac: mac, gwMac: '4C:5E:0C:00:00:01', vmIp: '10.10.0.2' };
  const frames = [
    dnsQueryFrame({ ...net, dnsIp: '10.10.0.1', name: 'deeplook-teste.invalid' }),
    dnsQueryFrame({ ...net, dnsIp: '10.10.0.1', name: 'c2.evil.example', id: 0x4321 }),
    ...httpFrames({ ...net, serverIp: '203.0.113.7', host: 'evil.example', path: '/stage2.bin' }),
  ];
  const other = dnsQueryFrame({
    vmMac: 'BC:24:11:FF:FF:FF',
    gwMac: net.gwMac,
    vmIp: '10.10.0.9',
    dnsIp: '10.10.0.1',
    name: 'outra.example',
  });
  const sock = dgram.createSocket('udp4');
  for (const f of [...frames, other]) {
    await new Promise<void>((r) => sock.send(tzspDatagram(f), udpPort, '127.0.0.1', () => r()));
  }
  sock.close();
  await sleep(300);

  const running = (await get(`/api/sandbox/${sessionId}/artifacts`)).json();
  ok(
    'tela: capturando',
    running.captureEnabled === true && running.network?.status === 'CAPTURING',
    running.network,
  );

  // ---- 3. Encerrar: o MAC sai do sniffer, o pcap vai para o MinIO e o Suricata le.
  await dispose(sessionId);
  const stored = await prisma.networkCapture.findUnique({ where: { sessionId } });
  ok(
    'pcap guardado com os pacotes da VM (só os dela)',
    stored?.status === 'STORED' && stored.packets === frames.length && Boolean(stored.storageKey),
    stored,
  );
  ok(
    'sniffer parado e sem MAC (nenhum ambiente ativo)',
    !router.state.running && router.state.macs === '',
    router.state,
  );
  const left = await fetch(`${env.NETCAP_URL}/sessions`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<{ sessions: unknown[] }>);
  ok('sessão fechada no netcap', left.sessions.length === 0, left);
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: stored!.storageKey! }),
  );
  ok('pcap no bucket', head.ContentLength === stored?.bytes, head.ContentLength);
  ok(
    'chave do pcap na lixeira da amostra',
    (await captureKeysOf(entry.id)).includes(stored!.storageKey!),
  );

  await suricataIdle();
  for (let i = 0; i < 120; i++) {
    const c = await prisma.networkCapture.findUnique({ where: { sessionId } });
    if (c?.idsStatus === 'DONE' || c?.idsStatus === 'FAILED') break;
    await sleep(1000);
    await suricataIdle();
  }
  const done = (await get(`/api/sandbox/${sessionId}/artifacts`)).json();
  const ids = done.network?.ids;
  ok('Suricata: análise concluída', ids?.status === 'DONE', ids);
  const result = ids?.result ?? {};
  ok(
    'Suricata: o alerta da regra de teste',
    result.alerts?.some((a: { sid: number }) => a.sid === 9900001),
    result.alerts,
  );
  ok(
    'Suricata: DNS e HTTP',
    result.dns?.some((d: { name: string }) => d.name === 'c2.evil.example') &&
      result.http?.some(
        (h: { host: string; url: string }) => h.host === 'evil.example' && h.url === '/stage2.bin',
      ),
    { dns: result.dns, http: result.http },
  );
  const indicators = (await get(`/api/entries/${entry.id}/sandbox`)).json().networkIndicators;
  ok(
    'IOCs sugeridos: domínio e host HTTP, sem o .invalid da regra de teste',
    indicators.includes('c2.evil.example') &&
      indicators.includes('evil.example') &&
      !indicators.includes('deeplook-teste.invalid'),
    indicators,
  );

  // ---- 4. Risco: a regra de teste nao conta; um alerta de verdade conta.
  const before = await riskOf(entry.id);
  ok(
    'risco: a regra de teste não soma',
    !before?.reasons.some((r) => r.source === 'Suricata'),
    before?.reasons,
  );
  await prisma.networkCapture.update({
    where: { sessionId },
    data: {
      idsResult: {
        ...result,
        alerts: [
          ...result.alerts,
          { sid: 2000001, signature: 'ET MALWARE Teste', severity: 1, count: 1 },
        ],
      },
    },
  });
  const after = await riskOf(entry.id);
  const reason = after?.reasons.find((r) => r.source === 'Suricata');
  ok(
    'risco: alerta de severidade 1 soma 40, com a assinatura',
    reason?.weight === 40 && reason.text.includes('ET MALWARE Teste'),
    after?.reasons,
  );

  // ---- 5. Download do pcap: anexo, com auditoria.
  const pcap = await get(`/api/sandbox/${sessionId}/pcap`);
  ok(
    'download do pcap (anexo, tipo pcap)',
    pcap.statusCode === 200 &&
      pcap.headers['content-type'] === 'application/vnd.tcpdump.pcap' &&
      String(pcap.headers['content-disposition']).startsWith('attachment;') &&
      pcap.rawPayload.readUInt32LE(0) === 0xa1b2c3d4,
    pcap.headers,
  );
  const audited = await prisma.auditEvent.count({ where: { action: 'SANDBOX_PCAP_DOWNLOADED' } });
  ok('download na auditoria', audited === 1, audited);

  // ---- 6. Status do sistema: os dois componentes.
  const status = await systemStatus();
  const netcapCheck = status.checks.find((c) => c.id === 'netcap');
  const suricataCheck = status.checks.find((c) => c.id === 'suricata');
  ok('status: captura ok (RouterOS respondendo)', netcapCheck?.level === 'ok', netcapCheck);
  ok(
    'status: Suricata em aviso sem as regras ET Open',
    suricataCheck?.level === 'warn' && suricataCheck.summary.includes('sem as regras'),
    suricataCheck,
  );

  // ---- 7. RouterOS recusando: a captura falha com o motivo, a VM segue.
  router.state.refuse = true;
  const { pve } = await import('../../src/lib/proxmox');
  await pve('/nodes/pve/qemu/100/clone', { method: 'POST', body: { newid: 9500, name: 'x' } });
  const refused = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9500,
      name: 'x',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await startCapture(refused.id, 'pve', 9500);
  const failed = (await get(`/api/sandbox/${refused.id}/artifacts`, 'en')).json().network;
  ok(
    'RouterOS recusou: captura com falha e o motivo (traduzido)',
    failed?.status === 'FAILED' &&
      String(failed.error).includes('RouterOS refused the user or the password'),
    failed,
  );
  ok(
    'a sessão do netcap não fica aberta',
    (
      (await fetch(`${env.NETCAP_URL}/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((r) => r.json())) as { sessions: unknown[] }
    ).sessions.length === 0,
  );
  router.state.refuse = false;

  // ---- 8. Subida da API: sessao esquecida no netcap e captura de ambiente encerrado.
  await fetch(`${env.NETCAP_URL}/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'esquecida', mac: '02:00:00:00:00:01' }),
  });
  await prisma.networkCapture.update({
    where: { sessionId: refused.id },
    data: { status: 'CAPTURING', error: null },
  });
  await prisma.sandboxSession.update({ where: { id: refused.id }, data: { status: 'STOPPED' } });
  await reconcileCaptures();
  const after8 = await prisma.networkCapture.findUnique({ where: { sessionId: refused.id } });
  const left8 = (await fetch(`${env.NETCAP_URL}/sessions`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json())) as { sessions: unknown[] };
  ok(
    'subida: captura de ambiente encerrado fechada e sessão esquecida apagada do netcap',
    after8?.status !== 'CAPTURING' && left8.sessions.length === 0 && !router.state.running,
    { after8, left8, router: router.state },
  );

  // ---- 9. Dialogo de inicio (plans/ajustes-usabilidade, item 5): o painel sabe do teto e da
  // captura; o analista escolhe a duracao e desliga a captura daquele ambiente.
  // A rota de abrir espera a limpeza inicial (aqui as sessoes foram criadas direto).
  const { initSandbox } = await import('../../src/lib/sandbox');
  await initSandbox({ info: () => undefined, warn: () => undefined, error: () => undefined });
  const info = (await get(`/api/entries/${entry.id}/sandbox`)).json();
  ok(
    'painel: teto da duração e captura configurada',
    info.ttlMinutes === env.SANDBOX_TTL_MINUTES && info.captureEnabled === true,
    { ttlMinutes: info.ttlMinutes, captureEnabled: info.captureEnabled },
  );
  const launch = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${entry.id}/sandbox`,
      headers: { cookie },
      payload: payload as object,
    });
  const badLaunch = await Promise.all([
    launch({ minutes: env.SANDBOX_TTL_MINUTES + 1 }),
    launch({ minutes: 2 }),
    launch({ minutes: 'muito' }),
    launch({ capture: 'sim' }),
  ]);
  ok(
    'opções inválidas: 400, sem ambiente novo (acima do teto, abaixo de 5, texto)',
    badLaunch.every((r) => r.statusCode === 400) &&
      (await prisma.sandboxSession.count({ where: { entryId: entry.id, status: 'REQUESTED' } })) ===
        0,
    badLaunch.map((r) => r.statusCode),
  );
  const before9 = Date.now();
  const opened = await launch({ minutes: 15, capture: false });
  const openedId = opened.json().session?.id as string;
  let quiet9 = null;
  for (let i = 0; i < 60; i++) {
    quiet9 = await prisma.sandboxSession.findUnique({ where: { id: openedId } });
    if (quiet9?.status === 'RUNNING' || quiet9?.status === 'FAILED') break;
    await sleep(250);
  }
  const minutes9 = (quiet9!.expiresAt.getTime() - before9) / 60_000;
  ok(
    'sem captura e com 15 min: no ar, sem captura nenhuma e o prazo pedido',
    opened.statusCode === 201 &&
      quiet9?.status === 'RUNNING' &&
      quiet9.captureOff &&
      minutes9 > 14.9 &&
      minutes9 < 15.1 &&
      (await prisma.networkCapture.count({ where: { sessionId: openedId } })) === 0,
    { status: opened.statusCode, session: quiet9, minutes9 },
  );
  await dispose(openedId);

  stopSuricataQueue();
  netcap.kill();
  router.server.close();
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
