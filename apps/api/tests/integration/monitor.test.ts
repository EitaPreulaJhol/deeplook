import http from 'node:http';
import type { AddressInfo } from 'node:net';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a condicao (ate `ms`); devolve se chegou. */
async function until(cond: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(50);
  }
  return false;
}

/**
 * Servico de analise falso que segura a resposta (como o Ghidra num executavel grande) e conta as
 * conexoes que o cliente fechou antes da resposta: o cancelamento tem de chegar ate ele.
 */
async function slowService() {
  let closedEarly = 0;
  let received = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"state":"livre"}');
      return;
    }
    received += 1;
    req.resume();
    res.on('close', () => {
      if (!res.writableEnded) closedEarly += 1;
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received: () => received,
    closedEarly: () => closedEarly,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}

// Monitoramento (plans/monitoramento) contra o Proxmox simulado e um servico de analise falso: a
// foto, a pausa da fila, cancelar o pendente e o em andamento (a conexao com o servico fecha),
// refazer, encerrar ambientes de outro analista, o historico e a auditoria.
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { env } = await import('../../src/env');
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket, s3 } = await import('../../src/lib/s3');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { pve } = await import('../../src/lib/proxmox');
  const { pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { ghidraIdle, ghidraTiming, startGhidraQueue, stopGhidraQueue } =
    await import('../../src/lib/ghidra');
  const { CANCELLED_REASON, QUEUE_IDS, isQueuePaused, resetQueueControlForTests } =
    await import('../../src/lib/job-control');
  const { sampleMetrics } = await import('../../src/lib/monitor');
  await ensureBucket(3, 500);
  pveMockReset();
  resetQueueControlForTests();
  const { buildApp } = await import('../../src/app');
  const app = await buildApp();
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, role: 'ADMIN' | 'ANALYST') =>
    prisma.user.create({ data: { email, displayName: email, role, passwordHash } });
  const adm = await mk('adm@x.io', 'ADMIN');
  const ana = await mk('ana@x.io', 'ANALYST');
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const cAdm = await login('adm@x.io');
  const cAna = await login('ana@x.io');
  const call = (method: string, url: string, c = cAdm, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  // ---- 1. A foto: so admin, as onze filas, o sandbox e a plataforma.
  ok(
    'analista não vê o monitoramento',
    (await call('GET', '/api/admin/monitor', cAna)).statusCode === 403,
  );
  const snap = (await call('GET', '/api/admin/monitor')).json();
  ok(
    'foto: as filas na ordem, o sandbox e a plataforma',
    snap.queues.map((q: { id: string }) => q.id).join() === QUEUE_IDS.join() &&
      snap.sandbox.enabled === true &&
      snap.sandbox.limit === env.SANDBOX_MAX_ACTIVE &&
      snap.platform.dbBytes > 0 &&
      snap.platform.rss > 0,
    { queues: snap.queues?.length, sandbox: snap.sandbox, platform: snap.platform },
  );
  ok(
    'fila inexistente: 404',
    (await call('PATCH', '/api/admin/monitor/queues/nada', cAdm, { paused: true })).statusCode ===
      404,
  );

  // Amostras com arquivo no armazenamento, para a fila do Ghidra ter o que mandar.
  const entry = async (title: string) => {
    const e = await prisma.entry.create({
      data: {
        type: 'FILE',
        title,
        originalFilename: title,
        ownerId: ana.id,
        storageKey: `t/${title}`,
      },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: `t/${title}`,
        Body: Buffer.from('MZ teste'),
      }),
    );
    return e;
  };
  const [e1, e2, e3] = [await entry('um.exe'), await entry('dois.exe'), await entry('tres.exe')];
  const job = (id: string) => prisma.ghidraAnalysis.findUniqueOrThrow({ where: { id } });

  // ---- 2. Pausar: a fila nao pega trabalho novo, e o Status fica laranja.
  const fake = await slowService();
  env.GHIDRA_URL = fake.url;
  env.GHIDRA_TOKEN = '0123456789abcdef01';
  ghidraTiming.serviceWaitMs = 5000;
  ghidraTiming.retryEveryMs = 100;
  const pause = await call('PATCH', '/api/admin/monitor/queues/ghidra', cAdm, { paused: true });
  ok('pausar a fila do Ghidra', pause.statusCode === 200 && isQueuePaused('ghidra'));
  const j1 = await prisma.ghidraAnalysis.create({ data: { entryId: e1.id } });
  await startGhidraQueue({ info: () => undefined, error: () => undefined } as never);
  await sleep(300);
  ok('pausada: o trabalho continua pendente', (await job(j1.id)).status === 'PENDING');
  const status = (await call('GET', '/api/admin/status')).json();
  const queuesCheck = status.checks.find((c: { id: string }) => c.id === 'queues');
  ok(
    'Status: fila pausada em laranja',
    queuesCheck?.level === 'warn' && queuesCheck.summary.includes('ghidra'),
    queuesCheck,
  );
  const paused = (await call('GET', '/api/admin/monitor')).json();
  const ghidra = paused.queues.find((q: { id: string }) => q.id === 'ghidra');
  ok('foto: pausada, com um pendente', ghidra.paused === true && ghidra.ready === 1, ghidra);

  // ---- 3. Retomar acorda a fila; cancelar o em andamento fecha a conexao com o servico.
  await call('PATCH', '/api/admin/monitor/queues/ghidra', cAdm, { paused: false });
  ok(
    'retomada: o trabalho vai para o serviço na hora',
    await until(async () => (await job(j1.id)).status === 'RUNNING' && fake.received() === 1),
    { status: (await job(j1.id)).status, received: fake.received() },
  );
  const running = (await call('GET', '/api/admin/monitor/queues/ghidra/jobs?state=running')).json();
  ok(
    'lista dos em andamento, com a amostra',
    running.total === 1 && running.jobs[0].id === j1.id && running.jobs[0].entryTitle === 'um.exe',
    running,
  );
  const started = Date.now();
  const cancel = (
    await call('POST', '/api/admin/monitor/queues/ghidra/cancel', cAdm, { ids: [j1.id] })
  ).json();
  await ghidraIdle();
  const cancelled = await job(j1.id);
  ok(
    'cancelar o em andamento: falha com o motivo em menos de 2 s',
    cancel.running === 1 &&
      cancelled.status === 'FAILED' &&
      cancelled.error === CANCELLED_REASON &&
      Date.now() - started < 2000,
    { cancel, cancelled },
  );
  ok(
    'a conexão com o serviço fecha (o serviço mata a ferramenta)',
    await until(async () => fake.closedEarly() === 1, 2000),
    fake.closedEarly(),
  );

  // ---- 4. Cancelar os pendentes (fila pausada de novo, para nada sair da fila no meio).
  await call('PATCH', '/api/admin/monitor/queues/ghidra', cAdm, { paused: true });
  const j2 = await prisma.ghidraAnalysis.create({ data: { entryId: e2.id } });
  const j3 = await prisma.ghidraAnalysis.create({ data: { entryId: e3.id } });
  const all = (
    await call('POST', '/api/admin/monitor/queues/ghidra/cancel', cAdm, { allPending: true })
  ).json();
  ok(
    'cancelar todos os pendentes',
    all.pending === 2 &&
      (await job(j2.id)).status === 'FAILED' &&
      (await job(j3.id)).error === CANCELLED_REASON,
    all,
  );
  const failed = (await call('GET', '/api/admin/monitor/queues/ghidra/jobs?state=failed')).json();
  ok(
    'lista dos falhos, com o motivo',
    failed.total === 3 && failed.jobs.every((j: { error: string }) => j.error === CANCELLED_REASON),
    failed,
  );
  const failedEn = (
    await app.inject({
      method: 'GET',
      url: '/api/admin/monitor/queues/ghidra/jobs?state=failed',
      headers: { cookie: cAdm, 'accept-language': 'en' },
    })
  ).json();
  ok(
    'motivo em inglês',
    failedEn.jobs[0]?.error === 'cancelled by administration',
    failedEn.jobs[0],
  );

  // ---- 5. Refazer: os falhos da ultima hora voltam para a fila, do zero.
  const retry = (
    await call('POST', '/api/admin/monitor/queues/ghidra/retry', cAdm, { failedSinceHours: 1 })
  ).json();
  const back = await job(j2.id);
  ok(
    'refazer as falhas da última hora',
    retry.retried === 3 && back.status === 'PENDING' && back.attempts === 0 && back.error === null,
    { retry, back },
  );
  await call('POST', '/api/admin/monitor/queues/ghidra/cancel', cAdm, { allPending: true });
  ok(
    'validação: sem ids nem "todos" dá 400',
    (await call('POST', '/api/admin/monitor/queues/ghidra/cancel', cAdm, {})).statusCode === 400 &&
      (
        await call('POST', '/api/admin/monitor/queues/ghidra/retry', cAdm, {
          ids: ['x'],
          failedSinceHours: 2,
        })
      ).statusCode === 400,
  );
  ok(
    'analista não cancela',
    (await call('POST', '/api/admin/monitor/queues/ghidra/cancel', cAna, { allPending: true }))
      .statusCode === 403,
  );
  await call('PATCH', '/api/admin/monitor/queues/ghidra', cAdm, { paused: false });
  stopGhidraQueue();
  await fake.close();

  // ---- 6. Encerrar o ambiente de outro analista: a VM some, a dona e avisada, a ficha registra.
  await pve('/nodes/pve/qemu/100/clone', { method: 'POST', body: { newid: 9100, name: 'dl-mon' } });
  await pve('/nodes/pve/qemu/9100/status/start', { method: 'POST' });
  const session = await prisma.sandboxSession.create({
    data: {
      entryId: e1.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9100,
      name: 'dl-mon',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
      startedAt: new Date(),
    },
  });
  const live = (await call('GET', '/api/admin/monitor')).json();
  const row = live.sandbox.sessions.find((s: { id: string }) => s.id === session.id);
  ok(
    'foto: o ambiente ativo, com a dona e a VM',
    row?.analyst.id === ana.id && row.entry.title === 'um.exe' && row.vm !== undefined,
    row,
  );
  ok(
    'validação do encerrar: ids e "todos" juntos dão 400',
    (await call('POST', '/api/admin/monitor/sandbox/stop', cAdm, { ids: [session.id], all: true }))
      .statusCode === 400,
  );
  const stop = (
    await call('POST', '/api/admin/monitor/sandbox/stop', cAdm, {
      ids: [session.id],
      reason: 'manutenção do Proxmox',
    })
  ).json();
  const after = await prisma.sandboxSession.findUniqueOrThrow({ where: { id: session.id } });
  const note = await prisma.notification.findFirst({
    where: { userId: ana.id, type: 'SANDBOX_STOPPED_BY_ADMIN' },
  });
  const event = await prisma.entryEvent.findFirst({
    where: { entryId: e1.id, type: 'SANDBOX_CLOSED' },
  });
  ok(
    'encerrar: ambiente parado, dona avisada com o motivo, ficha com o evento',
    stop.stopped === 1 &&
      after.status === 'STOPPED' &&
      note?.detail === 'manutenção do Proxmox' &&
      note.actorId === adm.id &&
      event?.detail === 'administracao',
    { stop, status: after.status, note, event },
  );

  // ---- 7. Historico: amostras por minuto e as series.
  await sampleMetrics(new Date(Date.now() - 120_000));
  await sampleMetrics();
  const hist = (await call('GET', '/api/admin/monitor/history?range=24h')).json();
  ok(
    'histórico: séries das filas, dos ambientes e da API',
    Array.isArray(hist.series['queue.ghidra']) &&
      Array.isArray(hist.series['sandbox.active']) &&
      hist.series['api.rss']?.[0]?.[1] > 0 &&
      hist.bucketMs === 15 * 60_000,
    Object.keys(hist.series ?? {}),
  );
  ok(
    'histórico: período inválido dá 400',
    (await call('GET', '/api/admin/monitor/history?range=1y')).statusCode === 400,
  );

  // ---- 8. Auditoria.
  const actions = new Set(
    (await prisma.auditEvent.findMany({ select: { action: true } })).map((a) => a.action),
  );
  ok(
    'auditoria: pausar, retomar, cancelar, refazer e encerrar',
    ['WORKER_PAUSED', 'WORKER_RESUMED', 'JOB_CANCELLED', 'JOB_RETRIED', 'SANDBOX_STOPPED'].every(
      (a) => actions.has(a as never),
    ),
    [...actions],
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
