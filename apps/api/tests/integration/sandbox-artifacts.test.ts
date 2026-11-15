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
  const { mockAgentBusy, mockSysmon, pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { artifactKeysOf, collectArtifacts, collectRunning } =
    await import('../../src/lib/sandbox-artifacts');
  const { dispose } = await import('../../src/lib/sandbox');
  await ensureBucket(3, 500);
  pveMockReset();

  const { buildApp } = await import('../../src/app');

  const app = await buildApp();

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
    JSON.stringify(await collectArtifacts(session.id)) ===
      '{"shot":true,"processes":true,"sysmon":true}',
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

  // ---- 1b. Sysmon (plano pos-revisao, item 5.3): so a leitura mais recente, com as listas.
  ok(
    'Sysmon: uma leitura guardada (a mais recente)',
    (await prisma.sandboxArtifact.count({ where: { sessionId: session.id, kind: 'SYSMON' } })) ===
      1,
  );
  const sm = a.sysmon;
  ok(
    'Sysmon: processos, rede, arquivos, registro e DNS',
    sm?.available === true &&
      sm.processes.length === 2 &&
      sm.processes[1].ppid === 4410 &&
      sm.network[0].dstIp === '203.0.113.7' &&
      sm.files[0].path === 'C:\\Users\\Public\\stage2.dll' &&
      sm.registry.length === 1 &&
      sm.dns[0].query === 'c2.evil.example',
    sm,
  );
  // Agente ocupado (a amostra tomando a VM): o PVE da "got timeout" e a coleta repete, sem aviso.
  mockAgentBusy.calls = 3;
  const busy = await collectArtifacts(session.id);
  const busyNote = (await prisma.sandboxSession.findUnique({ where: { id: session.id } }))
    ?.artifactsNote;
  ok(
    'agente ocupado ("got timeout"): a coleta repete e sai inteira, sem aviso',
    busy.processes && busy.sysmon && mockAgentBusy.calls === 0 && busyNote === null,
    { busy, busyNote },
  );
  // A ultima coleta (VM ja desligando) com a leitura falhando nao apaga a boa.
  mockSysmon.broken = true;
  const lastTry = await collectArtifacts(session.id, { final: true });
  mockSysmon.broken = false;
  const keptSysmon = (await get(`/api/sandbox/${session.id}/artifacts`, cAna)).json().sysmon;
  ok(
    'Sysmon: leitura que falha não apaga a anterior',
    lastTry.sysmon === false && keptSysmon?.available === true && keptSysmon.events === sm.events,
    { lastTry, kept: keptSysmon?.available },
  );
  const indicators = (await get(`/api/entries/${entry.id}/sandbox`, cAna)).json().sysmonIndicators;
  ok(
    'Sysmon: domínio e IP vão para os IOCs sugeridos da amostra',
    JSON.stringify(indicators) === '["c2.evil.example","203.0.113.7"]',
    indicators,
  );
  ok(
    'usuário comum não recebe os indicadores',
    JSON.stringify(
      (await get(`/api/entries/${entry.id}/sandbox`, cUser)).json().sysmonIndicators,
    ) === '[]',
  );
  // Windows sem o Sysmon no template (VM 9998): o motivo, e os processos de sempre.
  await pve('/nodes/pve/qemu/100/clone', { method: 'POST', body: { newid: 9998, name: 'x' } });
  const bare = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9998,
      name: 'x',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const b = await collectArtifacts(bare.id);
  const ba = (await get(`/api/sandbox/${bare.id}/artifacts`, cAna)).json();
  ok(
    'sem Sysmon: processos sim, Sysmon indisponível com o motivo',
    b.processes &&
      !b.sysmon &&
      ba.sysmon?.available === false &&
      String(ba.sysmon.reason).includes('Sysmon não instalado'),
    ba.sysmon,
  );
  const baEn = (
    await app.inject({
      method: 'GET',
      url: `/api/sandbox/${bare.id}/artifacts`,
      headers: { cookie: cAna, 'accept-language': 'en' },
    })
  ).json();
  ok(
    'em inglês: o motivo traduzido',
    String(baEn.sysmon?.reason).startsWith('Sysmon not installed'),
    baEn.sysmon,
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
    q.shot &&
      !q.processes &&
      qa.processes === null &&
      qa.sysmon === null &&
      String(qa.note).includes('qemu-guest-agent'),
    { q, note: qa.note },
  );

  // ---- 4b. Coleta final (ao encerrar) sem o agente: com processos ja coletados, nao vira aviso.
  const ended9999 = await prisma.sandboxSession.create({
    data: {
      entryId: entry.id,
      analystId: ana.id,
      node: 'pve',
      vmid: 9999,
      name: 'y',
      status: 'RUNNING',
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await prisma.sandboxArtifact.create({
    data: { sessionId: ended9999.id, kind: 'PROCESSES', processes: [] },
  });
  await collectArtifacts(ended9999.id, { final: true });
  const finalNote = (await prisma.sandboxSession.findUnique({ where: { id: ended9999.id } }))
    ?.artifactsNote;
  ok(
    'coleta final sem o agente não vira aviso (já havia processos)',
    finalNote === null,
    finalNote,
  );
  await collectArtifacts(ended9999.id);
  const midNote = (await prisma.sandboxSession.findUnique({ where: { id: ended9999.id } }))
    ?.artifactsNote;
  ok('coleta comum sem o agente continua avisando', Boolean(midNote), midNote);

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
  // O painel da amostra recebe a sessao mais recente mesmo encerrada (era so a ativa: os artefatos
  // sumiam da tela quando o ambiente acabava). O teste abriu outras na mesma amostra: todas acabam.
  await prisma.sandboxSession.updateMany({
    where: { entryId: entry.id },
    data: { status: 'STOPPED' },
  });
  const latest = await prisma.sandboxSession.findFirst({
    where: { entryId: entry.id },
    orderBy: { createdAt: 'desc' },
  });
  const panel = (await get(`/api/entries/${entry.id}/sandbox`, cAna)).json();
  ok(
    'painel da amostra: a sessão encerrada vem (os artefatos têm onde aparecer); usuário comum não',
    panel.session?.id === latest?.id &&
      panel.session.status === 'STOPPED' &&
      ended.sysmon?.available === true &&
      (await get(`/api/entries/${entry.id}/sandbox`, cUser)).json().session === null,
    { session: panel.session?.status, sysmon: ended.sysmon?.available },
  );

  // ---- 6. A lixeira leva os prints junto.
  const keys = await artifactKeysOf(entry.id);
  ok(
    'chaves dos prints da amostra (os dois ambientes)',
    keys.length === 7 && keys.every((k: string) => k.startsWith(`sandbox/${entry.id}/`)),
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
