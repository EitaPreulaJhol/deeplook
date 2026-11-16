// Modulo (os outros testes de integracao tambem declaram fails/ok no topo).
export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const RULE = (level = 'high', extra = '') => `title: Equipe - vssadmin apaga cópias
id: 6f1c2d3e-0000-4000-8000-000000000001
status: experimental
description: Regra de teste da equipe.
level: ${level}
logsource:
  product: windows
  category: process_creation
detection:
  sel:
    Image|endswith: '\\vssadmin.exe'
    CommandLine|contains|all: ['delete', 'shadows']${extra}
  condition: sel
tags: [attack.impact, attack.t1490]
`;

// Regras Sigma da equipe e o catalogo das vendorizadas (plans/caca-e-formatos, item 1), contra o
// Proxmox simulado: validar, testar numa execucao sem gravar, criar (refaz sobre os eventos ja
// guardados), a coleta seguinte sem contar duas vezes, editar, desligar e religar, desligar uma
// vendorizada, excluir, a auditoria e as mensagens em ingles.
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
  const { sigmaRetroIdle, startSigma } = await import('../../src/lib/sigma-store');
  await ensureBucket(3, 500);
  pveMockReset();

  const { buildApp } = await import('../../src/app');
  const app = await buildApp();
  await app.ready();
  await startSigma();

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
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: cAna }, ...(payload && { payload }) });

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
  const FATURA = '{a0000000-0000-0000-0000-000000004410}';
  const vssadmin = (rec: number, guid: string) => ({
    id: 1,
    rec,
    time: `2026-11-13T12:00:${String(rec - 195).padStart(2, '0')}.0000000Z`,
    data: {
      ProcessId: String(4000 + rec),
      ProcessGuid: guid,
      ParentProcessGuid: FATURA,
      Image: 'C:\\Windows\\System32\\vssadmin.exe',
      OriginalFileName: 'VSSADMIN.EXE',
      CommandLine: 'vssadmin.exe delete shadows /all /quiet',
      ParentImage: 'D:\\fatura.exe',
    },
  });
  mockSysmon.extra = [
    vssadmin(201, '{c0000000-0000-0000-0000-000000004600}'),
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
  await collectArtifacts(session.id);
  const sandboxHits = async () =>
    (await call('GET', `/api/sandbox/${session.id}/sigma`)).json().hits as {
      ruleId: string;
      title: string;
      level: string;
      count: number;
      sample: boolean;
      url: string | null;
      teamRuleId: string | null;
    }[];
  const before = await sandboxHits();
  const whoamiHit = before.find((h) => /whoami/i.test(h.title));
  ok(
    'vendorizada do whoami detectada antes de tudo',
    Boolean(whoamiHit),
    before.map((h) => h.title),
  );

  // ---- 1. Permissão e validação.
  ok(
    'usuário comum não vê as regras',
    (await app.inject({ method: 'GET', url: '/api/sigma/rules', headers: { cookie: cUser } }))
      .statusCode === 403,
  );
  const valid = (await call('POST', '/api/sigma/validate', { source: RULE() })).json();
  ok(
    'validar: o que o compilador entendeu',
    valid.ok &&
      valid.rule.level === 'high' &&
      JSON.stringify(valid.rule.eventIds) === '[1]' &&
      valid.rule.techniques.includes('T1490'),
    valid,
  );
  const keywords = (
    await call('POST', '/api/sigma/validate', {
      source: RULE().replace('  condition: sel', '  kw:\n    - texto\n  condition: sel or kw'),
    })
  ).json();
  ok('validar: keywords não', !keywords.ok && keywords.errors[0] === 'keywords em kw', keywords);
  const broken = (await call('POST', '/api/sigma/validate', { source: 'title: [' })).json();
  ok('validar: YAML quebrado', !broken.ok && /^YAML inválido/.test(broken.errors[0]), broken);
  const en = await app.inject({
    method: 'POST',
    url: '/api/sigma/rules',
    headers: { cookie: cAna, 'accept-language': 'en' },
    payload: { source: 'correlation:\n  type: event_count\ntitle: x\nid: y\n' },
  });
  ok(
    'erro de compilação em inglês',
    en.statusCode === 400 && en.json().error === 'The rule does not compile: correlation rule',
    en.body,
  );

  // ---- 2. Testar numa execução, sem gravar.
  const test = (
    await call('POST', '/api/sigma/test', { source: RULE(), sessionId: session.id })
  ).json();
  ok(
    'testar: casa com o vssadmin da amostra, sem gravar',
    test.matched === 1 &&
      test.events[0]?.sample === true &&
      test.events[0]?.event?.CommandLine?.includes('delete shadows') &&
      (await prisma.sandboxSigmaHit.count({ where: { ruleId: { startsWith: 'team:' } } })) === 0,
    test,
  );
  ok(
    'testar: execução que não existe',
    (await call('POST', '/api/sigma/test', { source: RULE(), sessionId: 'nao' })).statusCode ===
      404,
  );
  const runs = (await call('GET', '/api/sigma/runs?q=fatura')).json().runs;
  ok('execuções para testar', runs?.[0]?.id === session.id && runs[0].events > 0, runs);

  // ---- 3. Criar: refaz sobre os eventos já guardados.
  const created = await call('POST', '/api/sigma/rules', { source: RULE() });
  const rule = created.json().rule;
  await sigmaRetroIdle();
  let hits = (await sandboxHits()).filter((h) => h.teamRuleId === rule?.id);
  ok(
    'criada e avaliada nos eventos guardados',
    created.statusCode === 201 &&
      hits.length === 1 &&
      hits[0].sample &&
      hits[0].count === 1 &&
      hits[0].url === null &&
      hits[0].ruleId === `team:${rule.id}`,
    { body: created.body, hits },
  );
  const listed = (await call('GET', '/api/sigma/rules')).json().rules[0];
  ok(
    'lista: avaliada, com as execuções que disparou',
    listed?.firedRuns === 1 && listed.evaluating === false && listed.evaluatedAt,
    listed,
  );
  ok(
    'título repetido',
    (await call('POST', '/api/sigma/rules', { source: RULE() })).statusCode === 409,
  );

  // ---- 4. Coleta seguinte: o evento novo entra uma vez; os antigos não contam de novo.
  mockSysmon.extra.push(vssadmin(204, '{c0000000-0000-0000-0000-000000004700}'));
  await collectArtifacts(session.id);
  hits = (await sandboxHits()).filter((h) => h.teamRuleId === rule.id);
  ok(
    'coleta nova: um processo novo, nada em dobro',
    hits.length === 2 && hits.every((h) => h.count === 1),
    hits,
  );

  // ---- 5. Editar refaz com o nível novo, sem somar.
  const edited = await call('PATCH', `/api/sigma/rules/${rule.id}`, {
    source: RULE('critical'),
  });
  await sigmaRetroIdle();
  hits = (await sandboxHits()).filter((h) => h.teamRuleId === rule.id);
  ok(
    'editada: nível novo, mesmas contagens',
    edited.statusCode === 200 &&
      hits.length === 2 &&
      hits.every((h) => h.level === 'critical' && h.count === 1),
    hits,
  );
  const narrowed = await call('PATCH', `/api/sigma/rules/${rule.id}`, {
    source: RULE('critical', "\n    ProcessId: '4201'"),
  });
  await sigmaRetroIdle();
  hits = (await sandboxHits()).filter((h) => h.teamRuleId === rule.id);
  ok(
    'editada mais estreita: sai o que não casa mais',
    narrowed.statusCode === 200 && hits.length === 1,
    hits,
  );

  // ---- 6. Desligar e religar.
  await call('PATCH', `/api/sigma/rules/${rule.id}`, { enabled: false });
  ok(
    'desligada: sem detecções',
    (await prisma.sandboxSigmaHit.count({ where: { ruleId: `team:${rule.id}` } })) === 0,
  );
  await call('PATCH', `/api/sigma/rules/${rule.id}`, { enabled: true });
  await sigmaRetroIdle();
  ok(
    'religada: de volta',
    (await prisma.sandboxSigmaHit.count({ where: { ruleId: `team:${rule.id}` } })) === 1,
  );

  // ---- 7. Desligar uma vendorizada (a do whoami) e religar.
  const vendorId = whoamiHit!.ruleId;
  const off = await call('PATCH', `/api/sigma/catalog/${vendorId}`, { enabled: false });
  const offList = (await call('GET', '/api/sigma/catalog?state=off')).json();
  ok(
    'vendorizada desligada: some das detecções e aparece no filtro',
    off.statusCode === 200 &&
      !(await sandboxHits()).some((h) => h.ruleId === vendorId) &&
      offList.total === 1 &&
      offList.rules[0].ruleId === vendorId &&
      offList.rules[0].enabled === false,
    offList,
  );
  await collectArtifacts(session.id);
  ok(
    'desligada: a coleta seguinte também não a usa',
    !(await sandboxHits()).some((h) => h.ruleId === vendorId),
  );
  await call('PATCH', `/api/sigma/catalog/${vendorId}`, { enabled: true });
  await sigmaRetroIdle();
  const back = (await sandboxHits()).find((h) => h.ruleId === vendorId);
  ok('religada: volta com a contagem certa', back?.count === 1, back);
  const search = (await call('GET', '/api/sigma/catalog?q=whoami')).json();
  ok(
    'catálogo: busca, com as execuções que disparou e o link',
    search.rules.some(
      (r: { ruleId: string; firedRuns: number; url: string }) =>
        r.ruleId === vendorId && r.firedRuns === 1 && r.url.startsWith('https://github.com/'),
    ) && search.total < 20,
    search.rules.map((r: { title: string }) => r.title),
  );

  // ---- 8. Excluir e a auditoria.
  ok('excluir', (await call('DELETE', `/api/sigma/rules/${rule.id}`)).statusCode === 200);
  ok(
    'excluída: sem detecções',
    (await prisma.sandboxSigmaHit.count({ where: { ruleId: `team:${rule.id}` } })) === 0,
  );
  const actions = (
    await prisma.auditEvent.findMany({
      where: {
        action: { in: ['SIGMA_RULE_CREATED', 'SIGMA_RULE_UPDATED', 'SIGMA_RULE_DELETED'] },
      },
      select: { action: true, detail: true },
    })
  ).map((a) => `${a.action}:${a.detail ?? ''}`);
  ok(
    'auditoria: criar, editar, ligar, a vendorizada e excluir',
    actions.includes('SIGMA_RULE_CREATED:') &&
      actions.includes('SIGMA_RULE_UPDATED:desativada') &&
      actions.includes('SIGMA_RULE_UPDATED:SigmaHQ: desativada') &&
      actions.includes('SIGMA_RULE_DELETED:'),
    actions,
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
