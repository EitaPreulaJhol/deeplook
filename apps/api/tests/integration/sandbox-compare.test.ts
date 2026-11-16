// Modulo (os outros testes de integracao tambem declaram fails/ok no topo).
export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Diff entre duas execucoes da mesma amostra (plans/novas-analises, item 8): o que so uma fez, o
// que as duas fizeram, sem acusar diferenca por PID, perfil ou nome temporario; Sigma e Suricata
// entram; a amostra e separada do Windows; execucoes de amostras diferentes sao recusadas.
async function main() {
  process.env.SANDBOX_ENABLED = 'true';
  process.env.PROXMOX_MOCK = 'true';
  process.env.PROXMOX_TEMPLATE_VMID = '100';
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
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

  const entry = await prisma.entry.create({
    data: { type: 'FILE', title: 'fatura.exe', originalFilename: 'fatura.exe', ownerId: ana.id },
  });
  const other = await prisma.entry.create({
    data: { type: 'FILE', title: 'outra.exe', originalFilename: 'outra.exe', ownerId: ana.id },
  });
  const mkSession = (entryId: string, vmid: number) =>
    prisma.sandboxSession.create({
      data: {
        entryId,
        analystId: ana.id,
        node: 'pve',
        vmid,
        name: `dl-${vmid}`,
        status: 'STOPPED',
        expiresAt: new Date(),
        startedAt: new Date(),
        stoppedAt: new Date(),
      },
    });
  const [a, b, c] = [
    await mkSession(entry.id, 9001),
    await mkSession(entry.id, 9002),
    await mkSession(other.id, 9003),
  ];

  let rec = 1;
  const at = (s: number) => new Date(Date.UTC(2026, 10, 13, 12, 0, s));
  const ev = (
    sessionId: string,
    eventId: number,
    guid: string,
    data: Record<string, string>,
    parent?: string,
  ) =>
    prisma.sandboxSysmonEvent.create({
      data: {
        sessionId,
        recordId: BigInt(rec++),
        eventId,
        time: at(rec),
        image: data.Image ?? null,
        processGuid: guid,
        parentGuid: parent ?? null,
        data: { ProcessGuid: guid, ...data },
      },
    });
  // As duas execucoes: a amostra (PID e usuario diferentes) grava na chave Run e larga um .tmp de
  // nome aleatorio. So a A consulta o C2; so a B abre o cmd. O Windows (explorer) roda nas duas.
  for (const [s, user, pid, tmp] of [
    [a.id, 'ana', '4410', 'tmp1A2B.tmp'],
    [b.id, 'bia', '5120', 'tmp9C.tmp'],
  ] as const) {
    const g = `{${s}-fatura}`;
    await ev(s, 1, g, {
      Image: 'D:\\fatura.exe',
      CommandLine: `"D:\\fatura.exe" /pid ${pid}`,
      ProcessId: pid,
    });
    await ev(s, 13, g, {
      Image: 'D:\\fatura.exe',
      EventType: 'SetValue',
      TargetObject: `HKU\\S-1-5-21-1-2-3-${pid}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Upd`,
      Details: 'x',
    });
    await ev(s, 11, g, {
      Image: 'D:\\fatura.exe',
      TargetFilename: `C:\\Users\\${user}\\AppData\\Local\\Temp\\${tmp}`,
    });
    await ev(s, 1, `{${s}-explorer}`, {
      Image: 'C:\\Windows\\explorer.exe',
      CommandLine: 'C:\\Windows\\explorer.exe',
    });
  }
  await ev(a.id, 22, `{${a.id}-fatura}`, { Image: 'D:\\fatura.exe', QueryName: 'c2.evil.test' });
  await ev(
    b.id,
    1,
    `{${b.id}-cmd}`,
    { Image: 'C:\\Windows\\System32\\cmd.exe', CommandLine: 'cmd /c whoami' },
    `{${b.id}-fatura}`,
  );
  await ev(b.id, 22, `{${b.id}-explorer}`, {
    Image: 'C:\\Windows\\explorer.exe',
    QueryName: 'msn.com',
  });
  await prisma.sandboxSigmaHit.create({
    data: {
      sessionId: b.id,
      ruleId: 'r1',
      title: 'Regra de teste',
      level: 'high',
      processGuid: `{${b.id}-cmd}`,
      eventId: 1,
      event: {},
      firstAt: at(1),
      lastAt: at(1),
    },
  });
  await prisma.networkCapture.create({
    data: {
      sessionId: a.id,
      mac: '00:11:22:33:44:55',
      status: 'STORED',
      idsStatus: 'DONE',
      idsResult: { alerts: [{ sid: 1, signature: 'ET MALWARE Teste', severity: 1 }] },
    },
  });

  // ---- 1. So a amostra (padrao).
  const res = await get(`/api/sandbox/${a.id}/compare/${b.id}`);
  const body = res.json();
  const cat = (name: string) => body.categories?.[name];
  ok('rota responde', res.statusCode === 200, res.body);
  ok(
    'escopo padrão: a amostra',
    body.scope === 'sample' && body.sample?.foundA && body.sample?.foundB,
  );
  ok(
    'processo da amostra com PID diferente conta como o mesmo',
    cat('process')?.counts.both === 1 && /fatura\.exe/.test(cat('process').both[0].exampleA),
    cat('process'),
  );
  ok(
    'cmd só na B (filho da amostra)',
    cat('process')?.onlyB.length === 1 && /whoami/.test(cat('process').onlyB[0].example),
    cat('process'),
  );
  ok(
    'chave Run com SIDs diferentes: a mesma',
    cat('registry')?.counts.both === 1 && cat('registry').counts.onlyA === 0,
    cat('registry'),
  );
  ok(
    'arquivo temporário de nome aleatório: o mesmo',
    cat('file')?.counts.both === 1 && cat('file').counts.onlyA === 0,
    cat('file'),
  );
  ok(
    'DNS do C2 só na A; o do Windows não entra',
    cat('dns')?.onlyA[0]?.example === 'c2.evil.test' && cat('dns').counts.onlyB === 0,
    cat('dns'),
  );
  ok('Sigma só na B', cat('sigma')?.onlyB[0]?.example === 'Regra de teste (high)', cat('sigma'));
  ok('Suricata só na A', cat('ids')?.onlyA[0]?.example === 'ET MALWARE Teste', cat('ids'));
  ok('explorer fora (não é da amostra)', !JSON.stringify(cat('process')).includes('explorer'));

  // ---- 2. Tudo: o Windows entra.
  const all = (await get(`/api/sandbox/${a.id}/compare/${b.id}?scope=all`)).json();
  ok(
    'escopo tudo: explorer nas duas e o DNS do Windows só na B',
    all.categories.process.both.some((x: { exampleA: string }) => /explorer/.test(x.exampleA)) &&
      all.categories.dns.onlyB.some((x: { example: string }) => x.example === 'msn.com'),
    all.categories,
  );

  // ---- 3. Recusas.
  ok('mesma execução', (await get(`/api/sandbox/${a.id}/compare/${a.id}`)).statusCode === 400);
  ok('amostras diferentes', (await get(`/api/sandbox/${a.id}/compare/${c.id}`)).statusCode === 400);
  ok('execução inexistente', (await get(`/api/sandbox/${a.id}/compare/nada`)).statusCode === 404);
  ok(
    'escopo inválido',
    (await get(`/api/sandbox/${a.id}/compare/${b.id}?scope=x`)).statusCode === 400,
  );
  ok(
    'usuário comum',
    (await get(`/api/sandbox/${a.id}/compare/${b.id}`, cUser)).statusCode === 403,
  );
  const en = await app.inject({
    method: 'GET',
    url: `/api/sandbox/${a.id}/compare/${c.id}`,
    headers: { cookie: cAna, 'accept-language': 'en' },
  });
  ok(
    'erro em inglês',
    en.json().error === 'Compare two different runs of the same sample.',
    en.body,
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
