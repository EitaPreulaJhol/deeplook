import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

type Ev = { id: number; data: Record<string, string>; guid?: string; parent?: string };

// Busca nos eventos do sandbox (plans/caca-e-formatos, item 2): campos, operadores, o escopo da
// amostra, o tipo de evento, o periodo, a paginacao das execucoes e dos eventos, a regex invalida,
// o CSV nos dois idiomas, a permissao e o indice de trigramas.
async function main() {
  const app = await buildApp();
  await app.ready();
  const passwordHash = await hashPassword('senha-123!');
  const ana = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  await prisma.user.create({
    data: { email: 'u@x.io', displayName: 'U', role: 'USER', passwordHash },
  });
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
  const hunt = (query: Record<string, string>, cookie = cAna, lang?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/sandbox/hunt?${new URLSearchParams(query)}`,
      headers: { cookie, ...(lang && { 'accept-language': lang }) },
    });

  let vmid = 9000;
  let rec = 1;
  /** Uma execucao de `file` com os eventos dados (o primeiro e o processo da amostra). */
  const run = async (file: string, createdAt: Date, events: Ev[]) => {
    const entry = await prisma.entry.create({
      data: { type: 'FILE', title: file, originalFilename: file, ownerId: ana.id },
    });
    const session = await prisma.sandboxSession.create({
      data: {
        entryId: entry.id,
        analystId: ana.id,
        node: 'pve',
        vmid: vmid++,
        name: 'dl-sandbox',
        status: 'STOPPED',
        expiresAt: new Date(createdAt.getTime() + 3600_000),
        createdAt,
        startedAt: createdAt,
      },
    });
    await prisma.sandboxSysmonEvent.createMany({
      data: events.map((e, i) => ({
        sessionId: session.id,
        recordId: BigInt(rec++),
        eventId: e.id,
        time: new Date(createdAt.getTime() + i * 1000),
        image: e.data.Image ?? null,
        processGuid: e.guid ?? null,
        parentGuid: e.parent ?? null,
        data: e.data,
      })),
    });
    return session.id;
  };
  const SAMPLE = '{a0000000-0000-0000-0000-000000000001}';
  const CHILD = '{a0000000-0000-0000-0000-000000000002}';
  const OTHER = '{b0000000-0000-0000-0000-000000000003}';
  const common = (file: string): Ev[] => [
    {
      id: 1,
      guid: SAMPLE,
      data: {
        ProcessId: '100',
        ProcessGuid: SAMPLE,
        Image: `C:\\Users\\a\\AppData\\Local\\Temp\\deeplook\\${file}`,
        CommandLine: `"C:\\Users\\a\\AppData\\Local\\Temp\\deeplook\\${file}"`,
      },
    },
    {
      id: 1,
      guid: CHILD,
      parent: SAMPLE,
      data: {
        ProcessId: '200',
        ProcessGuid: CHILD,
        ParentProcessGuid: SAMPLE,
        Image: 'C:\\Windows\\System32\\vssadmin.exe',
        OriginalFileName: 'VSSADMIN.EXE',
        CommandLine: 'vssadmin.exe Delete Shadows /all /quiet',
      },
    },
    {
      id: 22,
      guid: SAMPLE,
      data: {
        ProcessId: '100',
        ProcessGuid: SAMPLE,
        Image: `C:\\Users\\a\\AppData\\Local\\Temp\\deeplook\\${file}`,
        QueryName: 'c2-77.evil.top',
        QueryResults: '203.0.113.7;',
      },
    },
    {
      id: 1,
      guid: OTHER,
      data: {
        ProcessId: '300',
        ProcessGuid: OTHER,
        Image: 'C:\\Windows\\System32\\whoami.exe',
        CommandLine: 'whoami /all',
      },
    },
  ];
  const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
  const a = await run('fatura.exe', day(10), common('fatura.exe'));
  const b = await run('boleto.exe', day(12), [
    ...common('boleto.exe'),
    {
      id: 11,
      guid: SAMPLE,
      data: {
        ProcessId: '100',
        ProcessGuid: SAMPLE,
        Image: 'C:\\Users\\a\\AppData\\Local\\Temp\\deeplook\\boleto.exe',
        TargetFilename: 'C:\\Users\\a\\AppData\\Roaming\\desconto 50%.txt',
      },
    },
  ]);
  // Uma terceira execucao, sem o vssadmin, so com o processo do Windows.
  await run('planilha.xls', day(14), [common('x')[3]]);

  // ---- 1. Permissão e validação.
  ok('usuário comum não busca', (await hunt({ value: 'whoami' }, cUser)).statusCode === 403);
  ok('valor curto demais', (await hunt({ value: 'a' })).statusCode === 400);

  // ---- 2. Campos e operadores.
  const cmd = (await hunt({ field: 'commandline', value: 'delete shadows' })).json();
  ok(
    'linha de comando (contém, sem diferenciar maiúsculas): as duas execuções, a mais nova primeiro',
    cmd.total === 2 &&
      cmd.runs[0].sessionId === b &&
      cmd.runs[1].sessionId === a &&
      cmd.runs[0].matched === 1 &&
      cmd.runs[0].first[0].summary === 'vssadmin.exe Delete Shadows /all /quiet' &&
      cmd.runs[0].entryTitle === 'boleto.exe',
    cmd,
  );
  const anyPath = (await hunt({ value: 'C:\\Windows\\System32\\vssadmin' })).json();
  ok('qualquer campo, com barras invertidas', anyPath.total === 2, anyPath);
  const eq = (
    await hunt({ field: 'process', op: 'equals', value: 'c:\\windows\\system32\\WHOAMI.EXE' })
  ).json();
  ok('igual (processo), sem diferenciar maiúsculas', eq.total === 3, eq.total);
  const starts = (await hunt({ field: 'dns', op: 'starts', value: 'c2-77.' })).json();
  const ends = (await hunt({ field: 'dns', op: 'ends', value: '.evil.top' })).json();
  ok('começa e termina com', starts.total === 2 && ends.total === 2, [starts.total, ends.total]);
  const regex = (await hunt({ field: 'dns', op: 'regex', value: '^c2-[0-9]+\\.evil' })).json();
  ok('expressão regular', regex.total === 2, regex);
  const badRegex = await hunt({ field: 'dns', op: 'regex', value: 'c2-(' });
  ok(
    'regex inválida: erro legível',
    badRegex.statusCode === 400 && /^Expressão regular inválida/.test(badRegex.json().error),
    badRegex.body,
  );
  const badEn = await hunt({ field: 'dns', op: 'regex', value: 'c2-(' }, cAna, 'en');
  ok(
    'regex inválida em inglês',
    /^Invalid regular expression/.test(badEn.json().error),
    badEn.body,
  );
  const pct = (await hunt({ value: '50%' })).json();
  ok('% é literal, não curinga', pct.total === 1 && pct.runs[0].sessionId === b, pct.total);
  const anyRegex = (await hunt({ op: 'regex', value: 'desconto [0-9]+%' })).json();
  ok('regex em qualquer campo', anyRegex.total === 1, anyRegex.total);

  // ---- 3. Escopo, tipo e período.
  const who = (await hunt({ value: 'whoami' })).json();
  const whoSample = (await hunt({ value: 'whoami', scope: 'sample' })).json();
  ok(
    'escopo da amostra: o whoami é do Windows, não da amostra',
    who.total === 3 && whoSample.runs.length === 0 && whoSample.nextOffset === null,
    { who: who.total, sample: whoSample },
  );
  const vssSample = (await hunt({ value: 'vssadmin', scope: 'sample' })).json();
  ok(
    'escopo da amostra: o filho da amostra entra',
    vssSample.runs.length === 2 && vssSample.total === null && vssSample.runs[0].first[0].sample,
    vssSample,
  );
  const dnsOnly = (await hunt({ value: 'deeplook', kind: 'dns' })).json();
  ok(
    'tipo de evento: só DNS',
    dnsOnly.total === 2 && dnsOnly.runs.every((r: { matched: number }) => r.matched === 1),
    dnsOnly,
  );
  const period = (
    await hunt({ value: 'whoami', from: day(11).toISOString(), to: day(13).toISOString() })
  ).json();
  ok('período', period.total === 1 && period.runs[0].sessionId === b, period.total);

  // ---- 4. Paginação das execuções.
  for (let i = 0; i < 27; i++) {
    await run(`pagina-${i}.exe`, new Date(day(20).getTime() + i * 60_000), [
      { id: 1, guid: OTHER, data: { Image: 'C:\\x.exe', CommandLine: 'marcador-paginacao' } },
    ]);
  }
  const p1 = (await hunt({ value: 'marcador-paginacao' })).json();
  const p2 = (await hunt({ value: 'marcador-paginacao', offset: String(p1.nextOffset) })).json();
  ok(
    'paginação: 25 e o resto',
    p1.runs.length === 25 &&
      p1.total === 27 &&
      p1.nextOffset === 25 &&
      p2.runs.length === 2 &&
      p2.nextOffset === null &&
      !p1.capped,
    { p1: [p1.runs.length, p1.total, p1.nextOffset], p2: [p2.runs.length, p2.nextOffset] },
  );

  // ---- 5. Os eventos de uma execução.
  const evs = (
    await app.inject({
      method: 'GET',
      url: `/api/sandbox/hunt/${b}?value=deeplook`,
      headers: { cookie: cAna },
    })
  ).json();
  ok(
    'eventos da execução: os que casam, com a amostra marcada',
    evs.total === 3 &&
      evs.events.length === 3 &&
      evs.events.every((e: { sample: boolean }) => e.sample) &&
      evs.events[0].data.ProcessId === '100',
    evs,
  );
  ok(
    'execução que não existe',
    (
      await app.inject({
        method: 'GET',
        url: '/api/sandbox/hunt/nao-existe?value=deeplook',
        headers: { cookie: cAna },
      })
    ).statusCode === 404,
  );

  // ---- 6. CSV.
  const csv = await app.inject({
    method: 'GET',
    url: '/api/sandbox/hunt/export?field=commandline&value=shadows',
    headers: { cookie: cAna },
  });
  const lines = csv.body
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  ok(
    'CSV: cabeçalho em português, uma linha por evento',
    csv.headers['content-type']?.toString().startsWith('text/csv') &&
      lines[0].startsWith('Execução;Amostra;') &&
      lines.length === 3 &&
      lines[1].includes('vssadmin.exe Delete Shadows'),
    lines,
  );
  const csvEn = await app.inject({
    method: 'GET',
    url: '/api/sandbox/hunt/export?field=commandline&value=shadows',
    headers: { cookie: cAna, 'accept-language': 'en' },
  });
  ok('CSV em inglês', csvEn.body.replace(/^\uFEFF/, '').startsWith('Run,Sample,'), csvEn.body);

  // ---- 7. O índice de trigramas (a migração cria quando o pg_trgm existe).
  const idx = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'SandboxSysmonEvent_data_trgm_idx'`;
  ok('índice de trigramas criado', idx[0].n === 1, idx);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
