import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import {
  capaEligible,
  capaIdle,
  capaTechniques,
  capaTiming,
  flossIocs,
  startCapaQueue,
  stopCapaQueue,
} from '../../src/lib/capa';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

// Analise de funcoes (item 7.2) contra o servico capa de verdade (tests/run.mjs o sobe com o
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
const restarts = () => Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-capa'));
const REAL = 'http://localhost:53200';
const log = { info: () => undefined, error: () => undefined };

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${REAL}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return;
    await sleep(1000);
  }
  throw new Error('capa não voltou');
}

/** Servico falso: o /health diz "livre" e a funcao decide o que fazer com cada analise. */
async function fakeService(handle: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"state":"livre"}');
      return;
    }
    // Derrubar a conexao e no meio do corpo; o resto, depois de le-lo.
    if (handle.length === 1) {
      handle(req, res);
      return;
    }
    req.resume();
    req.on('end', () => handle(req, res));
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

const VALID = {
  ok: true,
  kind: 'pe',
  versions: { capa: '10.0.0', floss: '3.2.0', rules: '10.0.0' },
  capa: {
    format: 'pe',
    arch: 'amd64',
    os: 'windows',
    functions: 3,
    libraryFunctions: 0,
    rules: [
      {
        name: 'inject thread',
        namespace: 'host-interaction/process/inject',
        attack: ['T1055.003', 'T9999', 'nada'],
        mbc: [],
        matches: 1,
        addresses: ['0x401000'],
      },
    ],
    truncated: false,
  },
  capaError: null,
  floss: { stack: [], tight: [], decoded: [], truncated: false },
  flossError: null,
  ms: 10,
};

async function main() {
  // ------------------------------------------------------------ 1. regras puras
  ok('PE e ELF dentro do teto vão para o capa', capaEligible('pe', 1000) && capaEligible('elf', 1));
  ok(
    'outros tipos, vazio e acima do teto não',
    !capaEligible('pdf', 1000) &&
      !capaEligible('pe', 0) &&
      !capaEligible('pe', env.CAPA_MAX_MB * 1024 * 1024 + 1) &&
      !capaEligible(null, 1000),
  );
  ok(
    'técnicas: só as que existem no ATT&CK embutido, sem repetir',
    JSON.stringify(capaTechniques(VALID.capa as any)) === JSON.stringify(['T1055.003']),
    capaTechniques(VALID.capa as any),
  );
  ok(
    'IOCs das strings do FLOSS',
    flossIocs({
      stack: [{ string: 'stack.evil.test', function: null }],
      tight: [],
      decoded: [{ string: 'http://xor.evil.test/painel', function: '0x1' }],
      truncated: false,
    }).some((i) => i.kind === 'URL' && i.value === 'http://xor.evil.test/painel'),
  );

  // ------------------------------------------------------------ 2. pela API, com o servico real
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.CAPA_URL = REAL;
  env.CAPA_TOKEN = '0123456789abcdef01';
  capaTiming.serviceWaitMs = 90_000;
  capaTiming.retryEveryMs = 500;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
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
  const ana = await login('ana@x.io');
  const bob = await login('bob@x.io');
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
  const get = async (c: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/entries/${id}/capa`, headers: { cookie: c } });
  const ask = async (c: string, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${id}/capa`,
      headers: { cookie: c },
      payload: {},
    });
  const row = (entryId: string) => prisma.capaAnalysis.findUnique({ where: { entryId } });

  const before = restarts();
  const obf = await upload(ana, 'fatura.exe', file('ofuscado64.exe'));
  ok('envio de PE entra na fila sozinho', Boolean(await row(obf)));
  const busy = await ask(ana, obf);
  ok('pedir de novo com a análise na fila: 409', busy.statusCode === 409, busy.statusCode);
  await capaIdle();
  const o = (await row(obf)) as any;
  const names = (o?.capa?.rules ?? []).map((r: any) => r.name);
  ok(
    'capa: pilha ofuscada e XOR',
    o?.status === 'DONE' &&
      names.includes('contain obfuscated stackstrings') &&
      names.includes('encode data using XOR'),
    { status: o?.status, error: o?.error, names },
  );
  ok(
    'FLOSS: a string decifrada e a montada na pilha, com a função',
    o?.floss?.decoded.some((s: any) => s.string === 'http://xor.evil.test/painel' && s.function) &&
      o?.floss?.stack.some((s: any) => s.string === 'stack.evil.test'),
    o?.floss,
  );
  const iocs = (o?.iocCandidates ?? []).map((i: any) => `${i.kind}:${i.value}`);
  ok(
    'IOCs das strings escondidas viram sugestão',
    iocs.includes('URL:http://xor.evil.test/painel') && iocs.includes('DOMAIN:stack.evil.test'),
    iocs,
  );
  ok(
    'versões gravadas',
    o?.versions?.capa === '10.0.0' &&
      o?.versions?.rules === '10.0.0' &&
      o?.versions?.floss === '3.2.0',
    o?.versions,
  );

  const inj = await upload(ana, 'injetor.exe', file('prog64.exe'));
  await capaIdle();
  const p = (await row(inj)) as any;
  ok(
    'injeção: regra e técnica T1055.003',
    p?.status === 'DONE' &&
      p.capa.rules.some((r: any) => r.name === 'inject thread') &&
      p.attack.includes('T1055.003'),
    { status: p?.status, error: p?.error, attack: p?.attack },
  );
  // O container sai alguns segundos depois de responder (vive ao menos 10,5 s): espera a troca.
  for (let i = 0; i < 30 && restarts() < before + 2; i++) await sleep(1000);
  ok('um container novo a cada análise (restart do Docker)', restarts() >= before + 2, {
    before,
    after: restarts(),
  });

  const net = await upload(ana, 'carregador.exe', file('dotnet.exe'));
  const elf = await upload(ana, 'linux', file('linux.elf'));
  await capaIdle();
  const n = (await row(net)) as any;
  ok(
    '.NET: carga de assembly',
    n?.status === 'DONE' && n.capa.rules.some((r: any) => r.name === 'load .NET assembly'),
    { status: n?.status, error: n?.error },
  );
  const e = (await row(elf)) as any;
  ok(
    'ELF: capa sim, FLOSS não (só decifra Windows)',
    e?.status === 'DONE' && e.capa.format === 'elf' && e.floss === null,
    { status: e?.status, error: e?.error, format: e?.capa?.format },
  );

  // Rotas: quem ve, quem pede, o que nao se aplica.
  const mine = await upload(bob, 'meu.exe', file('prog32.exe'));
  await capaIdle();
  const seen = await get(bob, mine);
  ok(
    'usuário comum vê a análise da própria amostra',
    seen.statusCode === 200 && seen.json().analysis.status === 'DONE' && seen.json().eligible,
    seen.json(),
  );
  ok('usuário comum não pede análise', (await ask(bob, mine)).statusCode === 403);
  const text = await upload(ana, 'leia.txt', Buffer.from('só texto, nada de executável aqui'));
  const textState = (await get(ana, text)).json();
  ok(
    'texto: fora da fila e recusado',
    !(await row(text)) && !textState.eligible && (await ask(ana, text)).statusCode === 400,
    textState,
  );

  // Desligado.
  env.CAPA_URL = '';
  const off = await upload(ana, 'desligado.exe', file('teste.dll'));
  ok(
    'desligado: envio não enfileira e o pedido dá 503',
    !(await row(off)) &&
      (await ask(ana, off)).statusCode === 503 &&
      !(await get(ana, off)).json().enabled,
  );
  env.CAPA_URL = REAL;

  // Servico fora do ar: tenta de novo mais tarde e, gastas as tentativas, falha.
  docker('stop', 'dl-capa');
  capaTiming.serviceWaitMs = 3000;
  capaTiming.retryAfterMs = 60_000;
  ok(
    'analista pede a análise de uma amostra fora da fila',
    (await ask(ana, off)).statusCode === 202,
  );
  await capaIdle();
  const down = await row(off);
  ok(
    'fora do ar: volta para a fila com o motivo e a próxima tentativa adiante',
    down?.status === 'PENDING' &&
      down.attempts === 1 &&
      down.error === 'o serviço capa não respondeu' &&
      down.nextAttemptAt.getTime() > Date.now() + 30_000,
    down,
  );
  await prisma.capaAnalysis.update({
    where: { entryId: off },
    data: { attempts: 3, nextAttemptAt: new Date() },
  });
  await startCapaQueue(log);
  await capaIdle();
  const gaveUp = await row(off);
  ok(
    'gastas as tentativas: falha com o motivo',
    gaveUp?.status === 'FAILED' && gaveUp.attempts === 4,
    gaveUp,
  );
  docker('start', 'dl-capa');
  await waitHealthy();
  capaTiming.serviceWaitMs = 90_000;

  // ------------------------------------------------------------ 3. respostas hostis
  const hostile = async (
    label: string,
    handle: (req: http.IncomingMessage, res: http.ServerResponse) => void,
    check: (r: any) => boolean,
  ) => {
    const fake = await fakeService(handle);
    env.CAPA_URL = fake.url;
    await prisma.capaAnalysis.deleteMany({ where: { entryId: inj } });
    await ask(ana, inj);
    await capaIdle();
    const r = await row(inj);
    ok(label, check(r), r);
    await fake.close();
    env.CAPA_URL = REAL;
  };
  const reply = (res: http.ServerResponse, status: number, body: unknown) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  await hostile(
    'nome de regra gigante: formato inesperado',
    (_q, res) =>
      reply(res, 200, {
        ...VALID,
        capa: { ...VALID.capa, rules: [{ ...VALID.capa.rules[0], name: 'x'.repeat(5000) }] },
      }),
    (r) => r?.status === 'FAILED' && r.error === 'resposta do serviço em formato inesperado',
  );
  await hostile(
    'NUL nas strings é removido (o Postgres recusaria)',
    (_q, res) =>
      reply(res, 200, {
        ...VALID,
        floss: { ...VALID.floss, decoded: [{ string: 'a\u0000b.evil.test', function: null }] },
      }),
    (r) => r?.status === 'DONE' && r.floss.decoded[0].string === 'ab.evil.test',
  );
  await hostile(
    'técnica inexistente não entra',
    (_q, res) => reply(res, 200, VALID),
    (r) => r?.status === 'DONE' && JSON.stringify(r.attack) === JSON.stringify(['T1055.003']),
  );
  await hostile(
    'recusa do serviço vira falha com o motivo',
    (_q, res) => reply(res, 413, { error: 'arquivo acima de 32 MB' }),
    (r) => r?.status === 'FAILED' && r.error === 'arquivo acima de 32 MB',
  );
  env.CAPA_REQUEST_TIMEOUT_S = 1;
  await hostile(
    'serviço travado: tempo esgotado e nova tentativa',
    () => undefined,
    (r) => r?.status === 'PENDING' && r.error === 'sem resposta em 1 s' && r.attempts === 1,
  );
  env.CAPA_REQUEST_TIMEOUT_S = 1000;
  await hostile(
    'conexão derrubada no meio: conta como tentativa',
    (req) => req.socket.destroy(),
    (r) =>
      r?.status === 'PENDING' &&
      r.error === 'a conexão com o serviço caiu durante a análise' &&
      r.attempts === 1,
  );

  // ------------------------------------------------------------ 4. reinicio da API e exclusao
  await prisma.capaAnalysis.update({
    where: { entryId: inj },
    data: { status: 'RUNNING', attempts: 1 },
  });
  await prisma.capaAnalysis.update({
    where: { entryId: obf },
    data: { status: 'RUNNING', attempts: 3 },
  });
  env.CAPA_URL = '';
  await startCapaQueue(log);
  const resumed = await row(inj);
  const interrupted = await row(obf);
  ok(
    'reinício: em andamento volta para a fila; sem tentativas, falha',
    resumed?.status === 'PENDING' &&
      interrupted?.status === 'FAILED' &&
      interrupted.error === 'interrompida (a API reiniciou)',
    { resumed: resumed?.status, interrupted },
  );
  await prisma.entry.delete({ where: { id: inj } });
  ok('excluir a amostra apaga a análise', !(await row(inj)));

  stopCapaQueue();
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
