import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import {
  ghidraIdle,
  ghidraIneligible,
  ghidraProjectKey,
  ghidraPseudoKey,
  ghidraTiming,
  queueBsimDeletion,
  startGhidraQueue,
  stopGhidraQueue,
} from '../../src/lib/ghidra';
import { prisma } from '../../src/lib/prisma';
import { purgeExpiredFiles } from '../../src/lib/retention';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { setOwnSamplesOnly } from '../../src/lib/settings';

// Analise com o Ghidra (item 7.3) contra o servico de verdade (tests/run.mjs o sobe com o
// endurecimento do compose e o restart que troca o container a cada analise), e contra um
// servico falso para as respostas hostis.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const restarts = () => Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-ghidra'));
const REAL = 'http://localhost:53300';
const log = { info: () => undefined, error: () => undefined };
const exists = (key: string) =>
  s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).then(
    () => true,
    () => false,
  );

async function fakeService(handle: (res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"state":"livre"}');
      return;
    }
    req.resume();
    req.on('end', () => handle(res));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}

const SUMMARY = {
  format: 'Portable Executable (PE)',
  language: 'x86:LE:64:default',
  compiler: 'windows',
  imageBase: '0x140000000',
  entryPoint: '0x1400013f0',
  functions: 2,
  thunks: 1,
  sensitiveFunctions: 1,
  largest: [],
  decompiled: [
    {
      name: 'FUN_1',
      entry: '0x1',
      isEntryPoint: false,
      sensitive: ['CreateRemoteThread'],
      callers: [],
      c: 'void FUN_1(void) {}',
    },
  ],
};

async function main() {
  // ------------------------------------------------------------ 1. quem vai para o Ghidra
  const base = { type: 'FILE', fileSize: 1000, filePurgedAt: null };
  const pe = { detectedType: { id: 'pe' }, pe: { dotnet: null } };
  ok(
    'PE e ELF vão',
    !ghidraIneligible({ ...base, staticInfo: pe }) &&
      !ghidraIneligible({ ...base, staticInfo: { detectedType: { id: 'elf' } } }),
  );
  ok(
    '.NET não (o Ghidra não descompila IL)',
    /\.NET/.test(ghidraIneligible({ ...base, staticInfo: { ...pe, pe: { dotnet: {} } } }) ?? ''),
  );
  ok(
    'PDF não',
    /Só executáveis/.test(
      ghidraIneligible({ ...base, staticInfo: { detectedType: { id: 'pdf' } } }) ?? '',
    ),
  );
  ok(
    'acima do teto não',
    /até/.test(
      ghidraIneligible({
        ...base,
        fileSize: env.GHIDRA_MAX_MB * 1024 * 1024 + 1,
        staticInfo: pe,
      }) ?? '',
    ),
  );
  ok(
    'expurgado não',
    /expurgado/.test(
      ghidraIneligible({ ...base, filePurgedAt: new Date(), staticInfo: pe } as never) ?? '',
    ),
  );

  // ------------------------------------------------------------ 2. pela API, com o servico real
  env.CLAMAV_HOST = '';
  env.CAPA_URL = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.GHIDRA_URL = REAL;
  env.GHIDRA_TOKEN = '0123456789abcdef01';
  ghidraTiming.serviceWaitMs = 120_000;
  ghidraTiming.retryEveryMs = 500;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
    ['carol@x.io', 'USER'],
    ['root@x.io', 'ADMIN'],
  ] as const) {
    await prisma.user.create({
      data: { email, displayName: email, role, passwordHash: await hashPassword('senha-123!') },
    });
  }
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
  const [ana, bob, carol, root] = await Promise.all(
    ['ana@x.io', 'bob@x.io', 'carol@x.io', 'root@x.io'].map(login),
  );
  const upload = async (c: string, name: string, data: Buffer): Promise<string> => {
    const boundary = '----dl' + Math.random();
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST',
      url: '/api/entries/file',
      payload: body,
      headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const get = (c: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/entries/${id}/ghidra`, headers: { cookie: c } });
  const ask = (c: string, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${id}/ghidra`,
      headers: { cookie: c },
      payload: {},
    });
  const project = (c: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/entries/${id}/ghidra/project`, headers: { cookie: c } });
  const row = (entryId: string) => prisma.ghidraAnalysis.findUnique({ where: { entryId } });
  // Pseudo-C de todas as funcoes (plans/ghidra-pseudo-c).
  const fnList = (c: string, id: string, qs = '') =>
    app.inject({
      method: 'GET',
      url: `/api/entries/${id}/ghidra/functions${qs}`,
      headers: { cookie: c },
    });
  const fnGet = (c: string, id: string, entry: string) =>
    app.inject({
      method: 'GET',
      url: `/api/entries/${id}/ghidra/functions/${entry}`,
      headers: { cookie: c },
    });
  const pseudoDl = (c: string, id: string) =>
    app.inject({
      method: 'GET',
      url: `/api/entries/${id}/ghidra/pseudo-c`,
      headers: { cookie: c },
    });
  const fnSearch = (c: string, id: string, params: Record<string, string>) =>
    app.inject({
      method: 'GET',
      url: `/api/entries/${id}/ghidra/search?${new URLSearchParams(params)}`,
      headers: { cookie: c },
    });
  const fnCount = (analysisId: string) => prisma.ghidraFunction.count({ where: { analysisId } });

  const inj = await upload(bob, 'fatura.exe', file('prog64.exe'));
  const before = (await get(bob, inj)).json();
  ok(
    'executável: aplicável e sem análise até alguém pedir (nada sozinho no envio)',
    before.applicable && before.eligible && before.analysis === null && !(await row(inj)),
    before,
  );
  ok('usuário comum não pede', (await ask(bob, inj)).statusCode === 403);
  const restartsBefore = restarts();
  ok('analista pede', (await ask(ana, inj)).statusCode === 202);
  ok('pedir de novo com a análise na fila: 409', (await ask(ana, inj)).statusCode === 409);
  await ghidraIdle();
  const r = (await row(inj)) as any;
  const s = r?.summary;
  const main = s?.decompiled?.find((f: any) => f.sensitive.includes('CreateRemoteThread'));
  ok(
    'resumo: PE x64, funções e quem chama APIs sensíveis',
    r?.status === 'DONE' &&
      s.format === 'Portable Executable (PE)' &&
      s.language === 'x86:LE:64:default' &&
      s.functions > 10 &&
      s.sensitiveFunctions >= 1,
    { status: r?.status, error: r?.error },
  );
  // Item 23: BSim. O mesmo programa assinado acha as funcoes do original, e as Relacionadas ligam
  // os dois nos dois sentidos.
  const signedId = await upload(ana, 'assinado.exe', file('assinado.exe'));
  await ask(ana, signedId);
  await ghidraIdle();
  const signed = ((await row(signedId)) as any)?.summary?.bsim;
  const prog64Sha = createHash('sha256').update(file('prog64.exe')).digest('hex');
  const sharedFromSigned = (signed?.shared ?? []).find(
    (x: { sha256: string }) => x.sha256 === prog64Sha,
  );
  ok(
    'BSim: o assinado acha as funções do original, com similaridade 1',
    s?.bsim?.inserted > 0 &&
      (sharedFromSigned?.functions ?? 0) >= 3 &&
      signed.matches.some((m: { matches: { similarity: number }[] }) =>
        m.matches.some((o) => o.similarity >= 0.99),
      ),
    { first: s?.bsim && { ...s.bsim, matches: undefined }, signed },
  );
  const relatedOf = async (id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/related`,
        headers: { cookie: ana },
      })
    ).json().items as { entry: { id: string }; reasons: { kind: string; detail: unknown }[] }[];
  const sharedCode = (items: Awaited<ReturnType<typeof relatedOf>>, id: string) =>
    items.find((i) => i.entry.id === id)?.reasons.find((r) => r.kind === 'SHARED_CODE')?.detail;
  ok(
    'Relacionadas: código em comum nos dois sentidos',
    Number(sharedCode(await relatedOf(signedId), inj)) >= 3 &&
      Number(sharedCode(await relatedOf(inj), signedId)) >= 3,
  );

  // Item 24: BinDiff. O mesmo programa assinado: tudo casa, quase tudo igual; sem a analise de um
  // dos lados, 409.
  const diff = await app.inject({
    method: 'GET',
    url: `/api/entries/compare/functions?a=${inj}&b=${signedId}`,
    headers: { cookie: ana },
  });
  const dj = diff.json();
  ok(
    'BinDiff: as funções do original e do assinado casam, iguais, com o pseudo-C dos dois lados',
    diff.statusCode === 200 &&
      dj.matched > 10 &&
      dj.equal >= dj.matched - 2 &&
      (dj.similarity ?? 0) > 0.95 &&
      dj.functions.some(
        (f: { entry1: string | null; entry2: string | null }) => f.entry1 && f.entry2,
      ),
    { status: diff.statusCode, dj: { ...dj, functions: dj.functions?.slice(0, 3) } },
  );
  // O mesmo fonte em 32 bits: funcoes alteradas e funcoes so de um lado, com o nome.
  // Item 23: o assinado sai da lixeira de vez; a proxima analise do Ghidra o tira da base do BSim.
  const signedSha = createHash('sha256').update(file('assinado.exe')).digest('hex');
  await prisma.entry.update({ where: { id: signedId }, data: { deletedAt: new Date() } });
  await queueBsimDeletion(signedId);
  const queued = await prisma.bsimDeletion.count({ where: { sha256: signedSha } });
  const v32 = await upload(ana, 'versao32.exe', file('prog32.exe'));
  await ask(ana, v32);
  await ghidraIdle();
  const v32Bsim = ((await row(v32)) as any)?.summary?.bsim;
  ok(
    'BSim: a amostra apagada sai da base na análise seguinte, e a fila esvazia',
    queued === 1 &&
      (v32Bsim?.deleted ?? []).includes(signedSha) &&
      (await prisma.bsimDeletion.count()) === 0 &&
      !(v32Bsim?.shared ?? []).some((x: { sha256: string }) => x.sha256 === signedSha) &&
      (v32Bsim?.shared ?? []).some((x: { sha256: string }) => x.sha256 === prog64Sha),
    { queued, bsim: v32Bsim && { ...v32Bsim, matches: undefined } },
  );
  const d32 = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/compare/functions?a=${inj}&b=${v32}`,
      headers: { cookie: ana },
    })
  ).json();
  ok(
    'BinDiff 64 × 32 bits: alteradas e as listas de um lado só, sem as de biblioteca',
    d32.matched > 0 &&
      d32.changed > 0 &&
      d32.onlyAList.length + d32.onlyBList.length > 0 &&
      [...d32.onlyAList, ...d32.onlyBList].every(
        (f: { entry: string; name: string }) => f.entry && f.name,
      ),
    { ...d32, functions: undefined },
  );
  const noAnalysis = await upload(ana, 'sem-analise.exe', file('prog32.exe'));
  ok(
    'BinDiff sem a análise de um lado: 409 com o motivo',
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/compare/functions?a=${inj}&b=${noAnalysis}`,
        headers: { cookie: ana },
      })
    ).statusCode === 409,
  );

  // Item 25: o runtime do MinGW-w64 reconhecido pelas bases do Function ID montadas no build.
  ok(
    'Function ID: funções do runtime do MinGW-w64 reconhecidas, com a biblioteca',
    (s?.libraryFunctions ?? 0) >= 5 &&
      (s.libraries ?? []).some((l: { name: string }) => /^lib(mingwex|mingw32|gcc)\b/.test(l.name)),
    { libraryFunctions: s?.libraryFunctions, libraries: s?.libraries },
  );
  ok(
    'pseudo-C da função de injeção, com as chamadas e a URL',
    Boolean(main) &&
      ['OpenProcess(', 'VirtualAllocEx(', 'WriteProcessMemory(', 'CreateRemoteThread('].every((c) =>
        main.c.includes(c),
      ) &&
      main.c.includes('http://evil.test/stage2.bin'),
    main?.c?.slice(0, 400),
  );
  ok(
    'importação do ws2_32 por ordinal vira nome (a tabela do pefile)',
    main?.sensitive.includes('WSAStartup'),
    main?.sensitive,
  );
  ok(
    'ponto de entrada descompilado',
    s?.decompiled?.some((f: any) => f.isEntryPoint && f.c),
  );
  ok(
    'projeto .gzf gravado sob samples/ (o backup sem amostras o deixa de fora)',
    r?.gzfKey === ghidraProjectKey(inj) &&
      r.gzfKey.startsWith('samples/') &&
      (r.gzfSize ?? 0) > 10_000 &&
      (await exists(r.gzfKey)),
    { gzfKey: r?.gzfKey, gzfSize: r?.gzfSize, gzfError: r?.gzfError },
  );
  ok(
    'quem pediu e a versão',
    (await get(bob, inj)).json().analysis.requestedBy?.displayName === 'ana@x.io' &&
      r?.version === '12.2',
  );

  // ------------------------------------------------ pseudo-C de todas as funcoes (servico real)
  const info = (await get(bob, inj)).json().analysis;
  ok(
    'pseudo-C completo: todas as funções, num texto fora de samples/',
    info.hasPseudo &&
      info.pseudoFunctions === s.functions &&
      r?.pseudoTotal === s.functions &&
      r.pseudoKey === ghidraPseudoKey(inj) &&
      !r.pseudoKey.startsWith('samples/') &&
      (await exists(r.pseudoKey)) &&
      !r.pseudoDeadlineHit &&
      !r.pseudoCapHit &&
      info.pseudoError === null,
    { info, pseudoKey: r?.pseudoKey, pseudoError: r?.pseudoError },
  );
  const all = (await fnList(bob, inj, '?pageSize=500')).json();
  ok(
    'lista: ponto de entrada e as do resumo primeiro, todas com código',
    all.listed === s.functions &&
      all.matching === s.functions &&
      all.total === s.functions &&
      all.functions[0].isEntryPoint &&
      all.functions
        .slice(0, s.decompiled.length)
        .map((f: any) => f.entry)
        .join() === s.decompiled.map((d: any) => d.entry).join() &&
      all.functions.every((f: any) => f.hasCode && f.skipped === null && f.error === null),
    all.functions?.slice(0, 5),
  );
  // Cada funcao por Range, e o download inteiro tem de ser exatamente elas, na ordem.
  const each: any[] = [];
  for (const f of all.functions) each.push((await fnGet(bob, inj, f.entry)).json());
  const fromSummary = s.decompiled.filter((d: any) => {
    const one = each.find((e) => e.entry === d.entry);
    return one && one.c === d.c;
  });
  ok(
    'cada função lida por Range: as do resumo idênticas ao resumo',
    fromSummary.length === s.decompiled.length,
    { iguais: fromSummary.length, resumo: s.decompiled.length },
  );
  const injection = each.find((e) => e.entry === main?.entry);
  ok(
    'função de injeção: APIs sensíveis, chamadores e chamadas com nome',
    injection?.sensitive.includes('CreateRemoteThread') &&
      injection.apis.includes('CreateRemoteThread') &&
      injection.callerCount === injection.callers.length &&
      [...injection.callers, ...injection.callees].every((l: any) => typeof l.name === 'string') &&
      injection.callers.length + injection.callees.length > 0,
    injection && { callers: injection.callers, callees: injection.callees },
  );
  const sensitiveOnly = (await fnList(bob, inj, '?sensitive=true')).json();
  const byName = (await fnList(bob, inj, `?q=${main?.name.toUpperCase()}`)).json();
  const byAddress = (await fnList(bob, inj, `?q=${main?.entry.slice(-5)}`)).json();
  const bySize = (await fnList(bob, inj, '?sort=size&pageSize=500')).json();
  const page2 = (await fnList(bob, inj, '?pageSize=5&page=2')).json();
  ok(
    'filtros: sensíveis, nome sem caixa, endereço, ordem por tamanho e páginas',
    sensitiveOnly.matching === s.sensitiveFunctions &&
      sensitiveOnly.functions.every((f: any) => f.sensitive.length > 0) &&
      byName.functions.some((f: any) => f.entry === main?.entry) &&
      byAddress.functions.some((f: any) => f.entry === main?.entry) &&
      bySize.functions.every((f: any, i: number, a: any[]) => i === 0 || a[i - 1].size >= f.size) &&
      page2.functions.map((f: any) => f.entry).join() ===
        all.functions
          .slice(5, 10)
          .map((f: any) => f.entry)
          .join(),
    { sensitive: sensitiveOnly.matching, byName: byName.matching, byAddress: byAddress.matching },
  );
  ok(
    'parâmetros inválidos: 400; endereço desconhecido: 404',
    (await fnList(bob, inj, '?sort=tamanho')).statusCode === 400 &&
      (await fnList(bob, inj, '?pageSize=0')).statusCode === 400 &&
      (await fnGet(bob, inj, '0xdeadbeef')).statusCode === 404,
  );
  // Busca no pseudo-C (fase 5): o objeto lido em fluxo, linha a linha.
  const found = (await fnSearch(bob, inj, { q: 'createremotethread' })).json();
  const hit = found.results?.find((h: any) => h.entry === main?.entry);
  const code = each.find((e) => e.entry === main?.entry)?.c ?? '';
  ok(
    'busca sem caixa: acha a chamada na função de injeção, na linha certa e marcada',
    found.scanned === s.functions &&
      found.partial === false &&
      found.matchedFunctions === found.results.length &&
      hit?.lines.length === hit?.lineCount &&
      hit.lines.every(
        (l: any) =>
          code.split('\n')[l.line - 1].trim() === l.text &&
          l.marks.every(([a, b]: number[]) => l.text.slice(a, b) === 'CreateRemoteThread'),
      ),
    { found: { ...found, results: found.results?.length }, hit },
  );
  const exact = (
    await fnSearch(bob, inj, { q: 'createremotethread', caseSensitive: 'true' })
  ).json();
  const url = (await fnSearch(bob, inj, { q: 'http://evil.test/stage2.bin' })).json();
  const withCall = each.filter((e) => e.c.includes('()')).length;
  const paren = (await fnSearch(bob, inj, { q: '()' })).json();
  ok(
    'busca: com caixa não acha; . / ( ) são literais; conta todas as funções',
    exact.matchedFunctions === 0 &&
      url.results.some((h: any) => h.entry === main?.entry) &&
      paren.matchedFunctions === withCall &&
      paren.results.length === Math.min(paren.matchedFunctions, 200),
    { exact: exact.matchedFunctions, url: url.matchedFunctions, paren: paren.matchedFunctions },
  );
  ok(
    'busca: texto curto, só espaços ou com quebra de linha: 400',
    (await fnSearch(bob, inj, { q: 'a' })).statusCode === 400 &&
      (await fnSearch(bob, inj, { q: '   ' })).statusCode === 400 &&
      (await fnSearch(bob, inj, { q: 'a\nb' })).statusCode === 400 &&
      (await fnSearch(bob, inj, { q: 'x'.repeat(201) })).statusCode === 400,
  );
  // Quem ve a amostra ve a lista, como o resumo: por padrao todos; com "so as proprias", nao.
  const openList = await fnList(carol, inj);
  const openSearch = await fnSearch(carol, inj, { q: 'return' });
  await setOwnSamplesOnly(true);
  const closedList = await fnList(carol, inj);
  const closedFn = await fnGet(carol, inj, all.functions[0].entry);
  const closedSearch = await fnSearch(carol, inj, { q: 'return' });
  await setOwnSamplesOnly(false);
  ok(
    'lista, função e busca: quem vê a amostra; com "só as próprias", o outro usuário não',
    openList.statusCode === 200 &&
      openSearch.statusCode === 200 &&
      closedList.statusCode === 404 &&
      closedFn.statusCode === 404 &&
      closedSearch.statusCode === 404,
    [
      openList.statusCode,
      openSearch.statusCode,
      closedList.statusCode,
      closedFn.statusCode,
      closedSearch.statusCode,
    ],
  );
  const ownerC = await pseudoDl(bob, inj);
  const expected = each.map((e) => `/* ${e.name} @ ${e.entry} */\n${e.c}\n\n`).join('');
  ok(
    'quem enviou baixa o .c: texto, anexo, e exatamente as funções lidas por Range',
    ownerC.statusCode === 200 &&
      String(ownerC.headers['content-type']).startsWith('text/plain') &&
      String(ownerC.headers['content-disposition']).includes('fatura.exe.c') &&
      ownerC.body === expected &&
      Buffer.byteLength(expected) === r?.pseudoSize,
    { status: ownerC.statusCode, size: ownerC.body.length, expected: expected.length },
  );
  ok('analista baixa o .c', (await pseudoDl(ana, inj)).statusCode === 200);
  const otherC = await pseudoDl(carol, inj);
  ok(
    'outro usuário comum não baixa o .c',
    otherC.statusCode === 403 || otherC.statusCode === 404,
    otherC.statusCode,
  );
  const auditsC = await prisma.auditEvent.count({
    where: { action: 'ENTRY_DOWNLOADED', detail: 'pseudo-C do Ghidra (.c)' },
  });
  ok('downloads do .c na Auditoria (2, a recusa não)', auditsC === 2, auditsC);

  // Baixar o projeto: como a amostra (quem enviou e os analistas), na Auditoria.
  const ownerDl = await project(bob, inj);
  ok(
    'quem enviou baixa o .gzf, como octet-stream e anexo',
    ownerDl.statusCode === 200 &&
      ownerDl.headers['content-type'] === 'application/octet-stream' &&
      String(ownerDl.headers['content-disposition']).includes('fatura.exe.gzf') &&
      ownerDl.rawPayload.length === r?.gzfSize,
    ownerDl.statusCode,
  );
  ok('analista baixa', (await project(ana, inj)).statusCode === 200);
  const other = await project(carol, inj);
  ok(
    'outro usuário comum não baixa',
    other.statusCode === 403 || other.statusCode === 404,
    other.statusCode,
  );
  const audits = await prisma.auditEvent.count({
    where: { action: 'ENTRY_DOWNLOADED', detail: 'projeto do Ghidra (.gzf)' },
  });
  ok('downloads na Auditoria (2, a recusa não)', audits === 2, audits);

  const elf = await upload(ana, 'linux', file('linux.elf'));
  await ask(ana, elf);
  await ghidraIdle();
  const e = (await row(elf)) as any;
  ok(
    'ELF analisado',
    e?.status === 'DONE' && /ELF/.test(e.summary.format) && e.summary.functions > 5,
    { status: e?.status, error: e?.error },
  );
  // Analisar de novo: o pseudo-C anterior sai na hora do pedido, e o novo entra no lugar.
  const elfRow = (await row(elf))!;
  const elfKey0 = elfRow.pseudoKey;
  const elfFns = await fnCount(elfRow.id);
  ok('analisar de novo: pedido aceito', (await ask(ana, elf)).statusCode === 202);
  const cleared = (await row(elf))!;
  const clearedOk =
    cleared.pseudoKey === null &&
    !(elfKey0 && (await exists(elfKey0))) &&
    (await fnCount(cleared.id)) === 0;
  await ghidraIdle();
  const again = (await row(elf))!;
  ok(
    'analisar de novo: apaga o pseudo-C antigo e grava o novo',
    Boolean(elfKey0) &&
      elfFns > 0 &&
      clearedOk &&
      again.status === 'DONE' &&
      again.pseudoKey === elfKey0 &&
      (await fnCount(again.id)) === elfFns,
    { elfKey0, elfFns, clearedOk, status: again.status },
  );
  for (let i = 0; i < 30 && restarts() < restartsBefore + 3; i++) await sleep(1000);
  ok('um container novo a cada análise', restarts() >= restartsBefore + 3, {
    before: restartsBefore,
    after: restarts(),
  });

  const net = await upload(ana, 'carregador.exe', file('dotnet.exe'));
  const netState = (await get(ana, net)).json();
  const netAsk = await ask(ana, net);
  ok(
    '.NET: aparece com o motivo e o pedido é recusado',
    netState.applicable &&
      !netState.eligible &&
      /\.NET/.test(netState.reason) &&
      netAsk.statusCode === 400,
    netState,
  );
  const text = await upload(ana, 'leia.txt', Buffer.from('nada de executável'));
  const textState = (await get(ana, text)).json();
  ok(
    'texto: seção não se aplica',
    !textState.applicable && (await ask(ana, text)).statusCode === 400,
  );

  // Retencao: o .gzf sai junto com o arquivo.
  env.RETENTION_DAYS = 1;
  await prisma.entry.update({
    where: { id: inj },
    data: { status: 'COMPLETED' },
  });
  // A data vai numa segunda atualizacao: mudar o status regrava o statusChangedAt.
  await prisma.entry.update({
    where: { id: inj },
    data: { statusChangedAt: new Date(Date.now() - 3 * 86_400_000) },
  });
  await purgeExpiredFiles();
  const purged = await row(inj);
  ok(
    'retenção apaga o .gzf junto com a amostra e o download dá 410',
    purged?.gzfKey === null &&
      !(await exists(ghidraProjectKey(inj))) &&
      (await project(bob, inj)).statusCode === 410 &&
      purged.summary !== null,
    purged?.gzfKey,
  );
  ok(
    'retenção mantém o pseudo-C completo: lista, função e download seguem',
    purged?.pseudoKey === ghidraPseudoKey(inj) &&
      (await exists(ghidraPseudoKey(inj))) &&
      (await fnList(bob, inj)).json().listed === s.functions &&
      (await fnGet(bob, inj, main.entry)).json().c === main.c &&
      (await pseudoDl(bob, inj)).statusCode === 200,
    purged?.pseudoKey,
  );
  env.RETENTION_DAYS = 0;

  // Lixeira: excluir de vez apaga o .gzf.
  const elfKey = ghidraProjectKey(elf);
  const hadProject = await exists(elfKey);
  const hadPseudo = await exists(ghidraPseudoKey(elf));
  await prisma.entry.update({ where: { id: elf }, data: { deletedAt: new Date() } });
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/admin/trash/${elf}`,
    headers: { cookie: root },
  });
  ok(
    'excluir da lixeira apaga o .gzf, o pseudo-C completo e a análise',
    hadProject &&
      hadPseudo &&
      del.statusCode === 200 &&
      !(await exists(elfKey)) &&
      !(await exists(ghidraPseudoKey(elf))) &&
      !(await row(elf)),
    { hadProject, hadPseudo, status: del.statusCode },
  );

  // Desligado.
  env.GHIDRA_URL = '';
  ok(
    'desligado: 503 e enabled falso',
    (await ask(ana, net)).statusCode === 503 && !(await get(ana, net)).json().enabled,
  );
  env.GHIDRA_URL = REAL;

  // ------------------------------------------------------------ 3. respostas hostis
  const target = await upload(ana, 'alvo.exe', file('prog32.exe'));
  const hostile = async (
    label: string,
    handle: (res: http.ServerResponse) => void,
    check: (r: any) => boolean,
  ) => {
    const fake = await fakeService(handle);
    env.GHIDRA_URL = fake.url;
    await prisma.ghidraAnalysis.deleteMany({ where: { entryId: target } });
    await ask(ana, target);
    await ghidraIdle();
    const result = await row(target);
    ok(label, check(result), result);
    await fake.close();
    env.GHIDRA_URL = REAL;
  };
  const reply = (res: http.ServerResponse, body: unknown) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  await hostile(
    'falha do Ghidra vira FAILED com o motivo',
    (res) =>
      reply(res, { ok: false, error: 'tempo esgotado (900 s)', version: '12.2', ms: 900000 }),
    (x) => x?.status === 'FAILED' && x.error === 'tempo esgotado (900 s)',
  );
  await hostile(
    'pseudo-C acima do teto: formato inesperado',
    (res) =>
      reply(res, {
        ok: true,
        kind: 'pe',
        version: '12.2',
        summary: { ...SUMMARY, decompiled: [{ ...SUMMARY.decompiled[0], c: 'x'.repeat(30_000) }] },
        gzf: null,
        gzfError: null,
        ms: 1,
      }),
    (x) => x?.status === 'FAILED' && x.error === 'resposta do serviço em formato inesperado',
  );
  await hostile(
    'sem projeto: concluída, com o motivo, e sem link',
    (res) =>
      reply(res, {
        ok: true,
        kind: 'pe',
        version: '12.2',
        summary: { ...SUMMARY, decompiled: [{ ...SUMMARY.decompiled[0], name: 'a\u0000b' }] },
        gzf: null,
        gzfError: 'projeto acima de 64 MB',
        ms: 1,
      }),
    (x) =>
      x?.status === 'DONE' &&
      x.gzfKey === null &&
      x.gzfError === 'projeto acima de 64 MB' &&
      x.summary.decompiled[0].name === 'ab',
  );

  // Analise mais leve (plans/ajustes-usabilidade, item 2): a marca fica no resumo; motivo fora da
  // lista recusa a resposta.
  const lightReply = (reason: string) => (res: http.ServerResponse) =>
    reply(res, {
      ok: true,
      kind: 'elf',
      version: '12.2',
      summary: { ...SUMMARY, light: { reason, analyzers: ['Decompiler Switch Analysis'] } },
      gzf: null,
      gzfError: null,
      ms: 1,
    });
  await hostile(
    'análise leve: concluída, com o motivo e o analisador que ficou de fora',
    lightReply('size'),
    (x) =>
      x?.status === 'DONE' &&
      x.summary.light?.reason === 'size' &&
      x.summary.light.analyzers.join() === 'Decompiler Switch Analysis',
  );
  await hostile(
    'análise leve com motivo desconhecido: formato inesperado',
    lightReply('outro'),
    (x) => x?.status === 'FAILED' && x.error === 'resposta do serviço em formato inesperado',
  );

  // Pseudo-C completo hostil: o resumo vale sempre; o pseudo-C sai com o motivo.
  const pseudoFn = (entry: string, extra: object = {}) => ({
    name: `FUN_${entry}`,
    entry,
    size: 10,
    complexity: 1,
    isEntryPoint: false,
    library: false,
    sensitive: [],
    apis: [],
    callers: [],
    callerCount: 0,
    callees: [],
    calleeCount: 0,
    ...extra,
  });
  const withPseudo =
    (pseudo: unknown, raw = false) =>
    (res: http.ServerResponse) =>
      reply(res, {
        ok: true,
        kind: 'pe',
        version: '12.2',
        summary: SUMMARY,
        gzf: null,
        gzfError: null,
        pseudo: raw ? pseudo : gzipSync(Buffer.from(JSON.stringify(pseudo))).toString('base64'),
        pseudoError: null,
        ms: 1,
      });
  const lost = (x: any) =>
    x?.status === 'DONE' && x.summary?.decompiled?.length === 1 && x.pseudoKey === null;
  // Caracteres de varios bytes e NUL antes da funcao lida: o deslocamento e em bytes.
  const tricky = 'int f(void) { /* ação 🎯 ünïcödé */ return 0; }\u0000';
  const plain = 'int g(void)\n{\n  return f();\n}\n';
  await hostile(
    'pseudo-C com acentos, emoji, NUL, função pulada e erro: concluída',
    withPseudo({
      total: 5,
      deadlineHit: true,
      capHit: false,
      functions: [
        pseudoFn('0x10', { name: 'f\u0000ação', c: tricky, callers: ['0x20'], callerCount: 1 }),
        pseudoFn('0x20', { c: plain, callees: ['0x10', '0x99'], calleeCount: 2 }),
        pseudoFn('0x30', { skipped: 'deadline' }),
        pseudoFn('0x40', { error: 'Decompiler process died' }),
      ],
    }),
    (x) =>
      x?.status === 'DONE' && x.pseudoKey !== null && x.pseudoDeadlineHit && x.pseudoTotal === 5,
  );
  const g = (await fnGet(ana, target, '0x20')).json();
  const f = (await fnGet(ana, target, '0x10')).json();
  const skipped = (await fnGet(ana, target, '0x30')).json();
  const failed = (await fnGet(ana, target, '0x40')).json();
  ok(
    'Range em bytes: a função depois dos acentos sai exata; NUL some',
    g.c === plain && f.c === tricky.replace('\u0000', '') && f.name === 'fação',
    { g: g.c, f: f.c },
  );
  ok(
    'chamadas com nome, e a que está fora da lista só com o endereço',
    JSON.stringify(g.callees) ===
      JSON.stringify([
        { entry: '0x10', name: 'fação' },
        { entry: '0x99', name: null },
      ]),
    g.callees,
  );
  // A busca le o mesmo objeto em fluxo: as faixas em bytes valem tambem para ela.
  const uni = (await fnSearch(ana, target, { q: 'ÜNÏCÖDÉ' })).json();
  const ret = (await fnSearch(ana, target, { q: 'return', caseSensitive: 'true' })).json();
  ok(
    'busca depois dos acentos: função e linha certas, só nas que têm código',
    uni.results.length === 1 &&
      uni.results[0].entry === '0x10' &&
      uni.results[0].lines[0].text.slice(...uni.results[0].lines[0].marks[0]) === 'ünïcödé' &&
      ret.scanned === 2 &&
      JSON.stringify(ret.results.map((h: any) => [h.entry, h.lines.map((l: any) => l.line)])) ===
        JSON.stringify([
          ['0x10', [1]],
          ['0x20', [3]],
        ]),
    { uni, ret },
  );
  const listed = (await fnList(ana, target)).json();
  ok(
    'pulada pelo prazo e falha do descompilador: sem código, com o motivo',
    skipped.c === null &&
      skipped.skipped === 'deadline' &&
      failed.c === null &&
      failed.error === 'Decompiler process died' &&
      listed.deadlineHit &&
      listed.functions.filter((x: any) => !x.hasCode).length === 2,
    { skipped, failed },
  );
  env.GHIDRA_MAX_PSEUDO_MB = 1;
  await hostile(
    'bomba de gzip: o resumo vale, o pseudo-C sai acima do limite',
    (res) =>
      reply(res, {
        ok: true,
        kind: 'pe',
        version: '12.2',
        summary: SUMMARY,
        gzf: null,
        gzfError: null,
        pseudo: gzipSync(Buffer.alloc(70 * 1024 * 1024, 32)).toString('base64'),
        pseudoError: null,
        ms: 1,
      }),
    (x) => lost(x) && x.pseudoError === 'pseudo-C completo acima do limite',
  );
  env.GHIDRA_MAX_PSEUDO_MB = 32;
  const unexpected = (x: any) =>
    lost(x) && x.pseudoError === 'pseudo-C completo em formato inesperado';
  await hostile(
    'endereço repetido: formato inesperado',
    withPseudo({
      total: 2,
      deadlineHit: false,
      capHit: false,
      functions: [pseudoFn('0x10', { c: 'a' }), pseudoFn('0x10', { c: 'b' })],
    }),
    unexpected,
  );
  await hostile(
    'pseudo-C que não é gzip: formato inesperado',
    withPseudo('bm8gZ3ppcA==', true),
    unexpected,
  );
  await hostile(
    'pseudo-C acima do teto por função: formato inesperado',
    withPseudo({
      total: 1,
      deadlineHit: false,
      capHit: false,
      functions: [pseudoFn('0x10', { c: 'x'.repeat(256_001) })],
    }),
    unexpected,
  );
  await hostile(
    'serviço sem o pseudo-C: concluída, com o motivo do serviço',
    (res) =>
      reply(res, {
        ok: true,
        kind: 'pe',
        version: '12.2',
        summary: SUMMARY,
        gzf: null,
        gzfError: null,
        pseudo: null,
        pseudoError: 'o pseudo-C completo não foi gerado',
        ms: 1,
      }),
    (x) => lost(x) && x.pseudoError === 'o pseudo-C completo não foi gerado',
  );
  const noPseudo = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${target}/ghidra`,
      headers: { cookie: ana, 'accept-language': 'en' },
    })
  ).json().analysis;
  ok(
    'sem o pseudo-C: a lista dá 404 e o motivo sai no idioma do pedido',
    (await fnList(ana, target)).statusCode === 404 &&
      (await pseudoDl(ana, target)).statusCode === 404 &&
      !noPseudo.hasPseudo &&
      noPseudo.pseudoError === 'the full pseudo-C was not generated',
    noPseudo,
  );

  env.GHIDRA_REQUEST_TIMEOUT_S = 1;
  await hostile(
    'serviço travado: nova tentativa',
    () => undefined,
    (x) => x?.status === 'PENDING' && x.error === 'sem resposta em 1 s' && x.attempts === 1,
  );
  env.GHIDRA_REQUEST_TIMEOUT_S = 1300;

  // Reinicio da API no meio.
  await prisma.ghidraAnalysis.update({
    where: { entryId: target },
    data: { status: 'RUNNING', attempts: 3 },
  });
  env.GHIDRA_URL = '';
  await startGhidraQueue(log);
  const interrupted = await row(target);
  ok(
    'reinício: sem tentativas, falha como interrompida',
    interrupted?.status === 'FAILED' && interrupted.error === 'interrompida (a API reiniciou)',
    interrupted,
  );

  stopGhidraQueue();
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
