// Modulo (os outros testes de integracao tambem declaram fails/ok no topo).
export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Dump de memoria dos processos da amostra (plans/novas-analises, item 3): o Proxmox simulado faz o
// papel da VM (o MiniDump e a leitura em pedacos), e o servico extract de verdade le o minidump
// sintetico. Confere: os processos vem da arvore do Sysmon e so os vivos; o dump chega inteiro
// (SHA-256) no MinIO; sai da VM; a analise acha o PE injetado e o shellcode; o PE vira amostra
// filha; o download fica na auditoria; e o agendamento depois da execucao automatica.
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { join } = await import('node:path');
  const { gunzipSync } = await import('node:zlib');
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { env } = await import('../../src/env');
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket, s3 } = await import('../../src/lib/s3');
  const { pve } = await import('../../src/lib/proxmox');
  const { mockMemory, pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { collectArtifacts } = await import('../../src/lib/sandbox-artifacts');
  const { captureMemory, memdumpIdle, memdumpTick, memdumpTiming } =
    await import('../../src/lib/sandbox-memdump');
  const { syntheticMinidump } = await import('./minidump-fixture');
  await ensureBucket(3, 500);
  pveMockReset();
  env.EXTRACT_URL = 'http://localhost:53900';
  env.EXTRACT_TOKEN = '0123456789abcdef01';
  env.EMULATE_URL = '';
  env.ANDROID_URL = '';
  Object.assign(memdumpTiming, { serviceWaitMs: 30_000, retryEveryMs: 300 });

  const { buildApp } = await import('../../src/app');
  const app = await buildApp();
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, role: 'USER' | 'ANALYST') =>
    prisma.user.create({ data: { email, displayName: email, role, passwordHash } });
  const ana = await mk('ana@x.io', 'ANALYST');
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
  const [cAna, cUser] = [await login('ana@x.io'), await login('u@x.io')];
  const get = (url: string, c = cAna) => app.inject({ method: 'GET', url, headers: { cookie: c } });
  const post = (url: string, c = cAna) =>
    app.inject({ method: 'POST', url, headers: { cookie: c } });

  const entry = await prisma.entry.create({
    data: { type: 'FILE', title: 'fatura.exe', originalFilename: 'fatura.exe', ownerId: ana.id },
  });
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
  // Duas coletas: a segunda lista de processos ja tem a fatura.exe (4410) e o powershell (4512),
  // e o Sysmon do simulador tem a arvore dos dois.
  await collectArtifacts(session.id);
  await collectArtifacts(session.id);

  // ---- 1. Permissoes e recusas.
  ok(
    'usuário comum não captura',
    (await post(`/api/sandbox/${session.id}/memory`, cUser)).statusCode === 403,
  );
  ok(
    'usuário comum não vê',
    (await get(`/api/sandbox/${session.id}/memory`, cUser)).statusCode === 403,
  );

  // ---- 2. VM que nao consegue o dump: a falha fica na linha de cada processo.
  const failed = await captureMemory(session.id);
  const rows = await prisma.sandboxMemoryDump.findMany({ where: { sessionId: session.id } });
  ok(
    'dois processos da árvore da amostra, cada falha com o motivo',
    failed.started === 2 &&
      rows.length === 2 &&
      rows.every((r) => r.status === 'FAILED' && /MiniDumpWriteDump falhou/.test(r.error ?? '')),
    rows,
  );
  await prisma.sandboxMemoryDump.deleteMany({ where: { sessionId: session.id } });

  // ---- 3. Captura de verdade (pela rota), com o minidump sintetico.
  const dump = syntheticMinidump(join(__dirname, '..', '.tmp', 'pe', 'emulado32.exe'));
  mockMemory.dump = dump;
  const res = await post(`/api/sandbox/${session.id}/memory`);
  ok('pedido aceito', res.statusCode === 202, res.body);
  for (let i = 0; i < 100; i++) {
    const busy = await prisma.sandboxMemoryDump.count({
      where: { sessionId: session.id, status: { in: ['CAPTURING'] } },
    });
    const any = await prisma.sandboxMemoryDump.count({ where: { sessionId: session.id } });
    if (any && !busy) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await memdumpIdle();
  const view = (await get(`/api/sandbox/${session.id}/memory`)).json();
  const first = view.dumps?.[0];
  ok(
    'os dois PIDs da amostra despejados',
    JSON.stringify([...mockMemory.dumped].sort()) === JSON.stringify([4410, 4512]),
    mockMemory.dumped,
  );
  ok(
    'dump guardado e analisado',
    view.dumps?.length === 2 &&
      view.dumps.every((d: { status: string }) => d.status === 'DONE') &&
      first.size === dump.length &&
      /^[0-9a-f]{64}$/.test(first.sha256),
    view.dumps,
  );
  const stored = await prisma.sandboxMemoryDump.findFirst({ where: { sessionId: session.id } });
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: stored!.storageKey! }),
  );
  ok(
    'o MinIO tem o dump inteiro (gzip)',
    gunzipSync(Buffer.from(await obj.Body!.transformToByteArray())).equals(dump),
  );
  ok('o .gz sai da VM depois', mockMemory.cleaned.length === 2, mockMemory.cleaned.length);
  const regions = first?.result?.regions ?? [];
  ok(
    'regiões: o PE injetado (RWX) e o shellcode (RX); a imagem fica de fora',
    regions.length === 2 &&
      regions.some(
        (r: { kind: string; protect: string; carved?: string }) =>
          r.kind === 'pe' && r.protect === 'RWX' && r.carved,
      ) &&
      regions.some(
        (r: { kind: string; head: string }) => r.kind === 'code' && r.head.startsWith('fce889'),
      ),
    regions,
  );
  ok(
    'URLs da memória',
    first?.result?.urls?.includes('http://deeplook-memoria.top/beacon'),
    first?.result?.urls,
  );
  ok(
    'os bytes do PE não ficam no resultado',
    !JSON.stringify(first?.result ?? {}).includes('"data"'),
  );
  const children = (first?.children ?? []) as { entryId: string }[];
  const child = children[0]
    ? await prisma.entry.findUnique({
        where: { id: children[0].entryId },
        select: { parentEntryId: true, title: true, staticInfo: true },
      })
    : null;
  ok(
    'o PE achado vira amostra filha, um executável de verdade',
    child?.parentEntryId === entry.id &&
      /\(memória, 0x10000\)$/.test(child.title) &&
      (child.staticInfo as { detectedType?: { id?: string } } | null)?.detectedType?.id === 'pe',
    child,
  );

  // ---- 4. Download, com auditoria.
  const dl = await get(`/api/sandbox/${session.id}/memory/${first.id}/download`);
  ok('download do .gz', dl.statusCode === 200 && dl.headers['content-type'] === 'application/gzip');
  const audited = await prisma.auditEvent.count({
    where: { action: 'SANDBOX_MEMDUMP_DOWNLOADED' },
  });
  ok('download na auditoria', audited === 1, audited);
  ok(
    'dump de outro ambiente não',
    (await get(`/api/sandbox/${session.id}/memory/nao-existe/download`)).statusCode === 404,
  );

  // ---- 5. Agendada depois da execucao automatica: o tique captura uma vez so.
  await prisma.sandboxMemoryDump.deleteMany({ where: { sessionId: session.id } });
  mockMemory.dumped = [];
  await prisma.sandboxSession.update({
    where: { id: session.id },
    data: { memoryDump: true, memoryDumpAt: new Date(Date.now() - 1000) },
  });
  await memdumpTick();
  await memdumpIdle();
  await memdumpTick();
  const again = await prisma.sandboxSession.findUnique({ where: { id: session.id } });
  ok(
    'agendada: capturou uma vez e limpou a data',
    mockMemory.dumped.length === 2 && again?.memoryDumpAt === null,
    { dumped: mockMemory.dumped, at: again?.memoryDumpAt },
  );

  // ---- 6. Ambiente encerrado: a rota recusa.
  await prisma.sandboxSession.update({ where: { id: session.id }, data: { status: 'STOPPED' } });
  ok('ambiente encerrado', (await post(`/api/sandbox/${session.id}/memory`)).statusCode === 409);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
