import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import {
  ghidraIdle,
  ghidraIneligible,
  ghidraProjectKey,
  ghidraTiming,
  startGhidraQueue,
  stopGhidraQueue,
} from '../../src/lib/ghidra';
import { prisma } from '../../src/lib/prisma';
import { purgeExpiredFiles } from '../../src/lib/retention';
import { ensureBucket, s3 } from '../../src/lib/s3';

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
  for (let i = 0; i < 30 && restarts() < restartsBefore + 2; i++) await sleep(1000);
  ok('um container novo a cada análise', restarts() >= restartsBefore + 2, {
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
  env.RETENTION_DAYS = 0;

  // Lixeira: excluir de vez apaga o .gzf.
  const elfKey = ghidraProjectKey(elf);
  const hadProject = await exists(elfKey);
  await prisma.entry.update({ where: { id: elf }, data: { deletedAt: new Date() } });
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/admin/trash/${elf}`,
    headers: { cookie: root },
  });
  ok(
    'excluir da lixeira apaga o .gzf e a análise',
    hadProject && del.statusCode === 200 && !(await exists(elfKey)) && !(await row(elf)),
    { hadProject, status: del.statusCode },
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
