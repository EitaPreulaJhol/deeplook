export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Execucao automatica da amostra no ambiente isolado, contra o Proxmox simulado: o pedido ao
// abrir, a espera pelo agente e pelo Sysmon, a execucao na sessao do usuario (uma vez so), o
// historico, o agente que nunca responde e a API que reinicia no meio.
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { pve } = await import('../../src/lib/proxmox');
  const { mockAgentBusy, mockAutoRuns, pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { autoRunTick, autoRunTiming, CONHOST, startAutoRun } =
    await import('../../src/lib/sandbox-autorun');
  const { buildApp } = await import('../../src/app');
  const { initSandbox } = await import('../../src/lib/sandbox');
  pveMockReset();
  // A rota so abre ambiente depois da limpeza inicial do sandbox.
  await initSandbox({ info: () => undefined, warn: () => undefined, error: () => undefined });
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

  const mkEntry = (name: string) =>
    prisma.entry.create({
      data: {
        type: 'FILE',
        title: name,
        ownerId: ana.id,
        originalFilename: name,
        storageKey: `samples/${name}`,
      },
    });
  const mkSession = (entryId: string, vmid: number, startedAt = new Date()) =>
    prisma.sandboxSession.create({
      data: {
        entryId,
        analystId: ana.id,
        node: 'pve',
        vmid,
        name: `vm-${vmid}`,
        status: 'RUNNING',
        startedAt,
        expiresAt: new Date(Date.now() + 3600_000),
        autoRun: 'PENDING',
      },
    });
  for (const newid of [9000, 9998]) {
    await pve('/nodes/pve/qemu/100/clone', { method: 'POST', body: { newid, name: 'x' } });
  }

  // ---- 1. O pedido ao abrir o ambiente.
  const e0 = await mkEntry('pedido.exe');
  const asked = await app.inject({
    method: 'POST',
    url: `/api/entries/${e0.id}/sandbox`,
    headers: { cookie },
    payload: { autoRun: true },
  });
  ok(
    'abrir com a caixa marcada: execução automática pendente',
    asked.statusCode === 201 && asked.json().session.autoRun === 'PENDING',
    asked.json(),
  );
  const e0b = await mkEntry('sem-pedido.exe');
  const plain = await app.inject({
    method: 'POST',
    url: `/api/entries/${e0b.id}/sandbox`,
    headers: { cookie },
    payload: {},
  });
  ok('sem a caixa: nada pedido', plain.json().session?.autoRun === null, plain.json());
  // Os dois ambientes acima provisionam em segundo plano (e falham sem o genisoimage): fora do
  // resto do teste.
  await prisma.sandboxSession.updateMany({
    where: { entryId: { in: [e0.id, e0b.id] } },
    data: { status: 'STOPPED', autoRun: null },
  });

  // ---- 2. Windows com o Sysmon: roda na primeira rodada, na sessao do usuario, uma vez so.
  const e1 = await mkEntry('fatura.exe');
  const s1 = await mkSession(e1.id, 9000);
  await autoRunTick();
  const r1 = await prisma.sandboxSession.findUnique({ where: { id: s1.id } });
  ok(
    'executada com o Sysmon no ar, na sessão do usuário',
    r1?.autoRun === 'DONE' && r1.autoRunUser === 'SANDBOX\\analista' && r1.autoRunSysmon === true,
    r1,
  );
  const baseline = await prisma.sandboxArtifact.findFirst({
    where: { sessionId: s1.id, kind: 'PROCESSES' },
    orderBy: { createdAt: 'asc' },
  });
  ok(
    'lista de processos de referência tirada antes da amostra (o que ela abrir "surge")',
    Boolean(baseline && r1?.autoRunAt && baseline.createdAt <= r1.autoRunAt),
    { baseline: baseline?.createdAt, autoRunAt: r1?.autoRunAt },
  );
  const sent = mockAutoRuns.find((r) => r.vmid === 9000)?.script ?? '';
  const launcher = /-EncodedCommand ([A-Za-z0-9+/=]+)/.exec(sent)?.[1] ?? '';
  const launcherText = Buffer.from(launcher, 'base64').toString('utf16le');
  ok(
    'comando: tarefa interativa para o usuário do console; o lançador copia para o %TEMP% e abre',
    sent.includes('-LogonType Interactive') &&
      launcherText.includes("$name = 'fatura.exe'") &&
      launcherText.includes('$env:TEMP') &&
      launcherText.includes('Start-Process -FilePath $dst'),
    { sent: sent.slice(0, 200), launcherText: launcherText.slice(0, 200) },
  );
  ok(
    'console clássico para o usuário antes da tarefa (sem a entrega ao Windows Terminal)',
    sent.includes('Console\\%%Startup') &&
      sent.includes('DelegationConsole') &&
      sent.includes('DelegationTerminal') &&
      sent.includes(CONHOST) &&
      sent.indexOf('DelegationTerminal') < sent.indexOf('Register-ScheduledTask'),
  );
  await autoRunTick();
  ok(
    'não roda de novo na rodada seguinte',
    mockAutoRuns.filter((r) => r.vmid === 9000).length === 1,
  );
  const event = await prisma.entryEvent.findFirst({
    where: { entryId: e1.id, type: 'SANDBOX_AUTORUN' },
  });
  ok(
    'no histórico: quem pediu, a conta e o Sysmon',
    event?.actorId === ana.id && event.detail === 'SANDBOX\\analista' && event.toValue === 'sysmon',
    event,
  );

  // ---- 3. Sem o Sysmon no template (VM 9998): espera e depois roda assim mesmo.
  const e2 = await mkEntry('sem-sysmon.ps1');
  const s2 = await mkSession(e2.id, 9998);
  await autoRunTick();
  ok(
    'sem o Sysmon: espera',
    (await prisma.sandboxSession.findUnique({ where: { id: s2.id } }))?.autoRun === 'PENDING',
  );
  await autoRunTick(Date.now() + autoRunTiming.sysmonWaitMs + 1000);
  const r2 = await prisma.sandboxSession.findUnique({ where: { id: s2.id } });
  ok(
    'passada a espera, roda sem o Sysmon (e avisa)',
    r2?.autoRun === 'DONE' && r2.autoRunSysmon === false,
    r2,
  );
  const ps1 = mockAutoRuns.find((r) => r.vmid === 9998)?.script ?? '';
  const ps1Launcher = Buffer.from(
    /-EncodedCommand ([A-Za-z0-9+/=]+)/.exec(ps1)?.[1] ?? '',
    'base64',
  ).toString('utf16le');
  ok('.ps1 roda pelo PowerShell (não abre no editor)', ps1Launcher.includes("'.ps1' {"));
  ok(
    'histórico sem o Sysmon',
    (await prisma.entryEvent.findFirst({ where: { entryId: e2.id, type: 'SANDBOX_AUTORUN' } }))
      ?.toValue === 'no-sysmon',
  );

  // ---- 4. Agente que nunca responde (VM 9999): desiste no limite, com o motivo traduzido.
  const e3 = await mkEntry('mudo.exe');
  const s3 = await mkSession(e3.id, 9999);
  await autoRunTick();
  ok(
    'agente sem resposta: ainda espera (boot)',
    (await prisma.sandboxSession.findUnique({ where: { id: s3.id } }))?.autoRun === 'PENDING',
  );
  await autoRunTick(Date.now() + autoRunTiming.agentWaitMs + 1000);
  const en = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${e3.id}/sandbox`,
      headers: { cookie, 'accept-language': 'en' },
    })
  ).json().session;
  ok(
    'passado o limite: falha, com o motivo em inglês na tela',
    en?.autoRun === 'FAILED' &&
      en.autoRunError === 'the VM agent did not answer in time; the sample was not run',
    en,
  );
  ok('nada executado na VM sem agente', !mockAutoRuns.some((r) => r.vmid === 9999));

  // ---- 4b. Agente ocupado no pedido da amostra: nao repete (rodaria duas vezes) e manda conferir.
  const e4 = await mkEntry('pesada.exe');
  const s4 = await mkSession(e4.id, 9100);
  mockAgentBusy.autorunStart = true;
  await autoRunTick();
  mockAgentBusy.autorunStart = false;
  const r4 = await prisma.sandboxSession.findUnique({ where: { id: s4.id } });
  ok(
    'agente ocupado na execução: uma tentativa só, e a falha manda conferir no console',
    mockAgentBusy.autorunTries === 1 &&
      r4?.autoRun === 'FAILED' &&
      String(r4.autoRunError).includes('confira no console se a amostra rodou'),
    { tries: mockAgentBusy.autorunTries, r4 },
  );

  // ---- 5. API que reinicia no meio de uma execucao: vira falha (nao se sabe se rodou).
  await prisma.sandboxSession.update({ where: { id: s3.id }, data: { autoRun: 'RUNNING' } });
  await startAutoRun();
  const r5 = await prisma.sandboxSession.findUnique({ where: { id: s3.id } });
  ok(
    'execução interrompida pela reinicialização: falha com o aviso',
    r5?.autoRun === 'FAILED' && String(r5.autoRunError).includes('a API reiniciou'),
    r5,
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
