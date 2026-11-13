import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Artefatos do sandbox (revisao de novembro, 3.7) contra o Proxmox simulado: prints periodicos da
// tela e a lista de processos pelo agente do guest, o que surgiu desde o inicio, o teto de prints,
// o motivo quando o agente nao responde, a coleta final ao encerrar e a lixeira.
async function main() {
  // O sandbox e o modo simulado sao lidos ao importar o env.
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { env } = await import('../../src/env');
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket, s3 } = await import('../../src/lib/s3');
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const { pve } = await import('../../src/lib/proxmox');
  const { pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { artifactKeysOf, collectArtifacts, collectRunning } =
    await import('../../src/lib/sandbox-artifacts');
  const { dispose } = await import('../../src/lib/sandbox');
  const { authRoutes } = await import('../../src/routes/auth');
  const { sandboxRoutes } = await import('../../src/routes/sandbox');
  await ensureBucket(3, 500);
  pveMockReset();

  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  await app.register(authRoutes);
  await app.register(sandboxRoutes);
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, role: 'USER' | 'ANALYST') =>
    prisma.user.create({ data: { email, displayName: email, role, passwordHash } });
  const ana = await mk('ana@x.io', 'ANALYST');
  await mk('bia@x.io', 'ANALYST');
  await mk('u@x.io', 'USER');
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
  const [cAna, cBia, cUser] = [
    await login('ana@x.io'),
    await login('bia@x.io'),
    await login('u@x.io'),
  ];
  const get = (url: string, c: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: c } });

  const entry = await prisma.entry.create({
    data: { type: 'FILE', title: 'fatura.exe', ownerId: ana.id },
  });
  // A VM existe no Proxmox simulado (clonada do template e ligada).
  await pve('/nodes/pve/qemu/100/clone', {
    method: 'POST',
    body: { newid: 9000, name: 'dl-sandbox' },
  });
  await pve('/nodes/pve/qemu/9000/status/start', { method: 'POST' });
  const session = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9000,
      name: 'dl-sandbox',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
      startedAt: new Date(),
    },
  });

  // ---- 1. Duas coletas: o que surgiu entre elas.
  ok(
    'coleta: print e processos',
    JSON.stringify(await collectArtifacts(session.id)) === '{"shot":true,"processes":true}',
  );
  ok('rodada dos ambientes em execução', (await collectRunning()) === 1);
  const res = await get(`/api/sandbox/${session.id}/artifacts`, cAna);
  const a = res.json();
  ok(
    'dois prints e duas listagens',
    res.statusCode === 200 && a.screenshots.length === 2 && a.processes.lists === 2,
    a,
  );
  ok(
    'surgiram a amostra e o PowerShell que ela abriu, com a linha de comando',
    a.processes.appeared.map((p: { name: string }) => p.name).join() ===
      'fatura.exe,powershell.exe' && a.processes.appeared[0].cmd === '"D:\\fatura.exe" /silent',
    a.processes.appeared,
  );
  ok(
    'lista atual completa',
    a.processes.current.length === 5 && a.note === null,
    a.processes.current.length,
  );

  // ---- 2. O print, por quem pode ver.
  const shot = await get(`/api/sandbox/${session.id}/artifacts/${a.screenshots[0].id}`, cBia);
  ok(
    'outro analista vê o print (PNG, isolado)',
    shot.statusCode === 200 &&
      shot.headers['content-type'] === 'image/png' &&
      shot.rawPayload.subarray(1, 4).toString() === 'PNG' &&
      String(shot.headers['content-security-policy']).includes('sandbox'),
    shot.headers,
  );
  ok(
    'usuário comum não vê',
    (await get(`/api/sandbox/${session.id}/artifacts`, cUser)).statusCode === 403,
  );
  ok(
    'print de outro ambiente: 404',
    (await get(`/api/sandbox/${session.id}/artifacts/nao-existe`, cAna)).statusCode === 404,
  );
  ok(
    'ambiente que não existe: 404',
    (await get('/api/sandbox/nao-existe/artifacts', cAna)).statusCode === 404,
  );

  // ---- 3. Teto de prints: ficam o primeiro e os mais recentes.
  env.SANDBOX_ARTIFACT_MAX_SHOTS = 3;
  const firstShot = a.screenshots[0].id as string;
  const firstKey = (await prisma.sandboxArtifact.findUnique({
    where: { id: a.screenshots[1].id },
  }))!.storageKey!;
  for (let i = 0; i < 3; i++) await collectArtifacts(session.id);
  const kept = await prisma.sandboxArtifact.findMany({
    where: { sessionId: session.id, kind: 'SCREENSHOT' },
    orderBy: { createdAt: 'asc' },
  });
  ok(
    'no teto: 3 prints, o primeiro entre eles',
    kept.length === 3 && kept[0].id === firstShot,
    kept.map((k) => k.id),
  );
  const gone = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: firstKey })).then(
    () => false,
    () => true,
  );
  ok('o print apagado sai também do MinIO', gone);

  // ---- 4. Agente que nao responde: fica so o print, com o motivo.
  const quiet = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9999,
      name: 'x',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const q = await collectArtifacts(quiet.id);
  const qa = (await get(`/api/sandbox/${quiet.id}/artifacts`, cAna)).json();
  ok(
    'sem agente: print sim, processos não, e o motivo na tela',
    q.shot && !q.processes && qa.processes === null && String(qa.note).includes('qemu-guest-agent'),
    { q, note: qa.note },
  );

  // ---- 5. Ao encerrar: uma ultima coleta antes de desligar.
  const before = await prisma.sandboxArtifact.count({
    where: { sessionId: session.id, kind: 'PROCESSES' },
  });
  await dispose(session.id);
  const after = await prisma.sandboxArtifact.count({
    where: { sessionId: session.id, kind: 'PROCESSES' },
  });
  const ended = (await get(`/api/sandbox/${session.id}/artifacts`, cAna)).json();
  ok(
    'encerrar faz a última coleta e os artefatos ficam',
    after === before + 1 && ended.status === 'STOPPED' && ended.screenshots.length === 3,
    { before, after, status: ended.status },
  );

  // ---- 6. A lixeira leva os prints junto.
  const keys = await artifactKeysOf(entry.id);
  ok(
    'chaves dos prints da amostra (os dois ambientes)',
    keys.length === 4 && keys.every((k: string) => k.startsWith(`sandbox/${entry.id}/`)),
    keys,
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
