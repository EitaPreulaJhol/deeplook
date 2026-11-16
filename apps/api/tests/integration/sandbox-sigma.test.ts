// Modulo (os outros testes de integracao tambem declaram fails/ok no topo).
export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Regras Sigma sobre o Sysmon do sandbox (plans/novas-analises, item 1), contra o Proxmox simulado:
// a coleta avalia os eventos novos, a deteccao guarda a regra e o processo, a amostra e separada do
// resto do Windows, nada conta duas vezes, "avaliar de novo" refaz, e a pontuacao de risco soma so
// o que a amostra fez.
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket } = await import('../../src/lib/s3');
  const { pve } = await import('../../src/lib/proxmox');
  const { mockSysmon, pveMockReset } = await import('../../src/lib/proxmox-mock');
  const { collectArtifacts } = await import('../../src/lib/sandbox-artifacts');
  const { startSigma } = await import('../../src/lib/sigma-store');
  await ensureBucket(3, 500);
  pveMockReset();

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
  const get = (url: string, c: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: c } });
  const post = (url: string, c: string) =>
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

  // Alem dos eventos de sempre do simulador (fatura.exe -> powershell -enc), a amostra apaga as
  // copias de sombra e grava na chave Run; um processo do Windows, fora da amostra, roda whoami /all.
  const FATURA = '{a0000000-0000-0000-0000-000000004410}';
  mockSysmon.extra = [
    {
      id: 1,
      rec: 201,
      time: '2026-11-13T12:00:05.0000000Z',
      data: {
        ProcessId: '4600',
        ProcessGuid: '{c0000000-0000-0000-0000-000000004600}',
        ParentProcessGuid: FATURA,
        Image: 'C:\\Windows\\System32\\vssadmin.exe',
        OriginalFileName: 'VSSADMIN.EXE',
        CommandLine: 'vssadmin.exe delete shadows /all /quiet',
        ParentImage: 'D:\\fatura.exe',
      },
    },
    {
      id: 13,
      rec: 202,
      time: '2026-11-13T12:00:06.0000000Z',
      data: {
        EventType: 'SetValue',
        ProcessId: '4410',
        ProcessGuid: FATURA,
        Image: 'D:\\fatura.exe',
        TargetObject: 'HKU\\S-1-5-21-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater',
        Details: 'C:\\Users\\a\\AppData\\Roaming\\upd.exe',
      },
    },
    {
      id: 1,
      rec: 203,
      time: '2026-11-13T12:00:07.0000000Z',
      data: {
        ProcessId: '5000',
        ProcessGuid: '{d0000000-0000-0000-0000-000000005000}',
        ParentProcessGuid: '{e0000000-0000-0000-0000-000000003020}',
        Image: 'C:\\Windows\\System32\\whoami.exe',
        OriginalFileName: 'whoami.exe',
        CommandLine: 'whoami /all',
        ParentImage: 'C:\\Windows\\explorer.exe',
      },
    },
  ];

  // ---- 1. A coleta avalia os eventos novos.
  await collectArtifacts(session.id);
  const res = await get(`/api/sandbox/${session.id}/sigma`, cAna);
  const body = res.json();
  const titles = (body.hits ?? []).map((h: { title: string }) => h.title);
  const hit = (re: RegExp) =>
    (body.hits ?? []).find((h: { title: string }) => re.test(h.title)) as
      | { sample: boolean; techniques: string[]; count: number; url: string | null; event: object }
      | undefined;
  ok('rota responde para o analista', res.statusCode === 200, res.body);
  ok(
    'regras carregadas, com a licença',
    body.rules?.count > 1000 && body.rules.license === 'DRL 1.1',
  );
  ok('cópias de sombra (filho da amostra)', hit(/shadow cop/i)?.sample === true, titles);
  ok('chave Run (a própria amostra)', hit(/autorun/i)?.sample === true, titles);
  ok('PowerShell codificado (filho da amostra)', hit(/encoded|base64/i)?.sample === true, titles);
  ok('whoami /all fora da amostra', hit(/whoami/i)?.sample === false, titles);
  ok(
    'técnica ATT&CK, link da regra e o evento',
    (hit(/shadow cop/i)?.techniques.length ?? 0) > 0 &&
      Boolean(hit(/shadow cop/i)?.url?.startsWith('https://github.com/SigmaHQ/sigma/blob/')) &&
      JSON.stringify(hit(/shadow cop/i)?.event).includes('vssadmin'),
    hit(/shadow cop/i),
  );
  ok('nada pendente depois da coleta', body.pending === 0, body.pending);
  ok(
    'amostra primeiro na lista',
    body.hits.findIndex((h: { sample: boolean }) => !h.sample) >
      body.hits.findLastIndex((h: { sample: boolean }) => h.sample),
  );

  // ---- 2. Outra coleta (o simulador devolve os mesmos eventos): nada conta duas vezes.
  await collectArtifacts(session.id);
  const again = (await get(`/api/sandbox/${session.id}/sigma`, cAna)).json();
  ok(
    'segunda coleta não duplica nem soma',
    again.hits.length === body.hits.length &&
      again.hits.every((h: { count: number }) => h.count === 1),
    again.hits.map((h: { title: string; count: number }) => [h.title, h.count]),
  );

  // ---- 3. Avaliar de novo refaz do zero, com o mesmo resultado.
  const re = await post(`/api/sandbox/${session.id}/sigma/reevaluate`, cAna);
  const after = (await get(`/api/sandbox/${session.id}/sigma`, cAna)).json();
  ok(
    'avaliar de novo',
    re.statusCode === 200 &&
      re.json().hits === body.hits.length &&
      after.hits.length === body.hits.length,
    re.body,
  );

  // ---- 4. Permissões.
  ok(
    'usuário comum não vê',
    (await get(`/api/sandbox/${session.id}/sigma`, cUser)).statusCode === 403,
  );
  ok(
    'usuário comum não reavalia',
    (await post(`/api/sandbox/${session.id}/sigma/reevaluate`, cUser)).statusCode === 403,
  );
  ok('ambiente inexistente', (await get('/api/sandbox/nao-existe/sigma', cAna)).statusCode === 404);

  // ---- 5. Pontuação de risco: só o que a amostra fez.
  const risk = (await get(`/api/entries/${entry.id}/risk`, cAna)).json().risk;
  const sigmaReason = risk.reasons?.find((r: { source: string }) => r.source === 'Sigma');
  ok(
    'risco soma o Sigma da amostra, sem o whoami',
    sigmaReason && sigmaReason.weight >= 30 && !/whoami/i.test(sigmaReason.text),
    risk.reasons,
  );
  const riskEn = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${entry.id}/risk`,
      headers: { cookie: cAna, 'accept-language': 'en' },
    })
  ).json().risk;
  ok(
    'motivo em inglês',
    /rule\(s\) matched the sample's behavior/.test(
      riskEn.reasons?.find((r: { source: string }) => r.source === 'Sigma')?.text ?? '',
    ),
    riskEn.reasons,
  );

  // ---- 6. Regras novas (outra versão): a subida apaga e avalia tudo de novo.
  await prisma.systemSetting.upsert({
    where: { key: 'sigmaRulesVersion' },
    create: { key: 'sigmaRulesVersion', value: { version: 'antiga' } },
    update: { value: { version: 'antiga' } },
  });
  await startSigma();
  for (let i = 0; i < 100; i++) {
    const pending = await prisma.sandboxSysmonEvent.count({ where: { sigmaChecked: false } });
    if (!pending) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const reloaded = await prisma.sandboxSigmaHit.count({ where: { sessionId: session.id } });
  ok('versão nova reavalia na subida', reloaded === body.hits.length, reloaded);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
