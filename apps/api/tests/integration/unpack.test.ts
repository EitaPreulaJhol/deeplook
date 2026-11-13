import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { unpackChildCreator } from '../../src/lib/entry-create';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import {
  enqueueIdentify,
  identifiable,
  startUnpackQueue,
  stopUnpackQueue,
  unpackIdle,
  unpackTiming,
} from '../../src/lib/unpack';

// Desempacotar e extrair (item 7.8) contra o servico de verdade (tests/run.mjs o sobe com o
// endurecimento do compose, o restart que troca o container a cada trabalho e o teto de 10
// arquivos), e contra um servico falso para as respostas hostis.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const restarts = () => Number(docker('inspect', '-f', '{{.RestartCount}}', 'dl-unpack'));
const REAL = 'http://localhost:53400';
const log = { info: () => undefined, error: () => undefined };
/** DLLs e quantas funcoes de cada, sem a ordem (o upx a muda). */
const importSet = (imports?: { dll: string; functions: number }[]) =>
  JSON.stringify((imports ?? []).map((i) => `${i.dll}:${i.functions}`).sort());

/** ZIP sem compressao, como o servico responde: manifest.json e os arquivos. */
function storedZip(items: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of items) {
    const nm = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nm.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nm, data);
    central.push(cen, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

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

async function main() {
  // ------------------------------------------------------------ 1. quem vai para a fila
  const identifies = (name: string) => {
    const b = file(name);
    return identifiable(analyzeBuffer(b, name) as never, b.length);
  };
  ok(
    'todo executável vai (o Detect It Easy identifica; o desempacotador age se reconhecer)',
    ['upx64.exe', 'prog64.exe', 'dotnet.exe', 'linux.elf', 'pyinst.bin', 'nsis.exe'].every(
      identifies,
    ),
  );
  ok(
    'texto e acima do teto não',
    !identifiable(analyzeBuffer(Buffer.from('nada'), 'a.txt') as never, 4) &&
      !identifiable({ detectedType: { id: 'pe' } }, env.UNPACK_MAX_MB * 1024 * 1024 + 1),
  );

  // ------------------------------------------------------------ 2. pela API, com o servico real
  env.CLAMAV_HOST = '';
  env.CAPA_URL = '';
  env.GHIDRA_URL = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.UNPACK_URL = REAL;
  env.UNPACK_TOKEN = '0123456789abcdef01';
  unpackTiming.serviceWaitMs = 90_000;
  unpackTiming.retryEveryMs = 500;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  await startUnpackQueue(app.log, unpackChildCreator(app.log));
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
  // Regras de triagem pelo Detect It Easy (item 7.9).
  await prisma.triageRule.createMany({
    data: [
      { name: 'Instalador NSIS', condition: 'DIE_DETECTION', value: 'Nullsoft', tags: ['nsis'] },
      {
        name: 'Empacotador (DIE)',
        condition: 'DIE_DETECTION',
        value: null,
        tags: ['empacotado-die'],
      },
    ],
  });
  const ana = await login('ana@x.io');
  const bob = await login('bob@x.io');
  const upload = async (c: string, name: string, data: Buffer, tags = ''): Promise<string> => {
    const boundary = '----dl' + Math.random();
    const body = Buffer.concat([
      Buffer.from(
        tags
          ? `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}\r\n`
          : '',
      ),
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
  const job = (entryId: string) => prisma.unpackJob.findUnique({ where: { entryId } });
  const children = (entryId: string) =>
    prisma.entry.findMany({
      where: { parentEntryId: entryId },
      select: {
        id: true,
        title: true,
        sha256: true,
        originalFilename: true,
        ownerId: true,
        staticInfo: true,
        tags: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  const get = (c: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/entries/${id}/unpack`, headers: { cookie: c } });
  const ask = (c: string, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${id}/unpack`,
      headers: { cookie: c },
      payload: {},
    });

  const before = restarts();
  const upx = await upload(bob, 'setup.exe', file('upx64.exe'), 'campanha-x');
  await unpackIdle();
  const upxJob = await job(upx);
  const [unpacked] = await children(upx);
  ok(
    // O upx -d devolve o programa funcionalmente igual, nao byte a byte (zera o checksum e nao
    // restaura alguns diretorios do cabecalho; medido: 107 bytes diferentes em 31 KB). E refaz a
    // tabela de importacao em outra ordem de DLLs: o conjunto e o mesmo, o imphash nao.
    'UPX sozinho na chegada: o desempacotado é o prog64.exe (mesmo tamanho e mesmas importações)',
    upxJob?.status === 'DONE' &&
      upxJob.unpacker === 'upx' &&
      (unpacked?.staticInfo as any)?.size === file('prog64.exe').length &&
      importSet((unpacked?.staticInfo as any)?.pe?.imports) ===
        importSet(analyzeBuffer(file('prog64.exe')).pe?.imports) &&
      unpacked?.originalFilename === 'setup.desempacotado.exe' &&
      unpacked.title.endsWith('(desempacotado)'),
    { job: upxJob, child: unpacked?.originalFilename },
  );
  ok(
    'a filha é do mesmo dono, com as tags da mãe, passou pela análise estática e já não está empacotada',
    unpacked?.tags.some((t) => t.name === 'campanha-x') &&
      unpacked?.ownerId === (await prisma.entry.findUnique({ where: { id: upx } }))?.ownerId &&
      (unpacked.staticInfo as any)?.pe?.packer === null &&
      (unpacked.staticInfo as any)?.pe?.suspiciousImports?.includes('CreateRemoteThread'),
  );
  const childJob = unpacked ? await job(unpacked.id) : null;
  ok(
    'a filha também é identificada (MinGW, sem empacotador) e não há o que desempacotar',
    childJob?.status === 'DONE' &&
      childJob.note === 'nada a desempacotar' &&
      ((childJob.detections ?? []) as { name: string; type: string }[]).some(
        (d) => d.name === 'MinGW',
      ) &&
      !((childJob.detections ?? []) as { type: string }[]).some((d) => d.type === 'packer'),
    childJob,
  );
  ok(
    'Detect It Easy na mãe: o UPX com a versão e o método',
    ((upxJob?.detections ?? []) as { string: string }[]).some(
      (d) => d.string === 'Packer: UPX(4.24)[NRV, brute]',
    ) && upxJob?.dieVersion === '3.21',
    upxJob?.detections,
  );
  const upxTags = (
    await prisma.entry.findUnique({ where: { id: upx }, select: { tags: true } })
  )?.tags.map((t) => t.name);
  ok(
    'regra de triagem pelo Detect It Easy (vazio = empacotador) na mãe, não na filha',
    upxTags?.includes('empacotado-die') && !unpacked?.tags.some((t) => t.name === 'empacotado-die'),
    upxTags,
  );
  const extracted = await prisma.entryEvent.findFirst({
    where: { entryId: upx, type: 'FILES_EXTRACTED' },
  });
  ok(
    'evento na amostra mãe',
    extracted?.detail === '1 arquivo(s) pelo desempacotador UPX',
    extracted,
  );

  const nsis = await upload(ana, 'instalador.exe', file('nsis.exe'));
  await unpackIdle();
  const nsisKids = await children(nsis);
  const nsisEntry = await prisma.entry.findUnique({ where: { id: nsis }, select: { tags: true } });
  const payload = nsisKids.find((k) => k.originalFilename === 'carga.exe');
  const payloadJob = payload ? await job(payload.id) : null;
  ok(
    'a filha sai identificada da mesma rodada, sem voltar para a fila (attempts 0)',
    payloadJob?.status === 'DONE' &&
      payloadJob.attempts === 0 &&
      payloadJob.note === 'nada a desempacotar' &&
      ((payloadJob.detections ?? []) as { name: string }[]).some((d) => d.name === 'MinGW'),
    payloadJob,
  );
  ok(
    'Detect It Easy reconhece o NSIS e a regra pelo trecho "Nullsoft" marca a amostra',
    ((await job(nsis))?.detections as { string: string }[]).some((d) =>
      d.string.startsWith('Installer: Nullsoft Scriptable Install System'),
    ) && nsisEntry?.tags.some((t) => t.name === 'nsis'),
  );
  ok(
    'NSIS: a carga (prog64.exe) e o texto',
    (await job(nsis))?.unpacker === 'nsis' &&
      nsisKids.some(
        (k) => k.originalFilename === 'carga.exe' && k.sha256 === sha(file('prog64.exe')),
      ) &&
      nsisKids.some((k) => k.originalFilename === 'leia.txt'),
    nsisKids.map((k) => k.originalFilename),
  );

  const pyi = await upload(ana, 'painel', file('pyinst.bin'));
  await unpackIdle();
  const [pyc] = await children(pyi);
  ok(
    'PyInstaller: só o script do autor, com a URL que ele traz nas sugestões de IOC',
    (await job(pyi))?.note === 'Python 3.13' &&
      pyc?.originalFilename === 'painel.pyc' &&
      ((pyc.staticInfo as any)?.iocCandidates ?? []).some(
        (i: { value: string }) => i.value === 'http://pyinst.evil.test/c2',
      ),
    { name: pyc?.originalFilename, iocs: (pyc?.staticInfo as any)?.iocCandidates },
  );

  const inno = await upload(ana, 'setup-inno.exe', file('inno-6.2.2.exe'));
  await unpackIdle();
  const innoJob = await job(inno);
  const innoFiles = (innoJob?.files ?? []) as { entryId?: string; skipped?: string }[];
  ok(
    'Inno Setup 6.2: extraído até o teto de 10 arquivos, o resto registrado como pulado',
    innoJob?.status === 'DONE' &&
      innoFiles.filter((f) => f.entryId).length === 10 &&
      innoFiles.some((f) => f.skipped === 'limite de 10 arquivos') &&
      (await children(inno)).length >= 10,
    {
      status: innoJob?.status,
      error: innoJob?.error,
      created: innoFiles.filter((f) => f.entryId).length,
    },
  );
  const inno64 = await upload(ana, 'setup-novo.exe', file('inno-6.4.3.exe'));
  await unpackIdle();
  const inno64Job = await job(inno64);
  ok(
    'Inno Setup 6.4: falha com o motivo honesto',
    inno64Job?.status === 'FAILED' &&
      inno64Job.error === 'formato do Inno Setup 6.4.3: o innoextract 1.9 só lê até o 6.2',
    inno64Job,
  );

  const disguised = await upload(ana, 'disfarcado.exe', file('upx-disfarcado.exe'));
  await unpackIdle();
  const disguisedJob = await job(disguised);
  ok(
    'UPX disfarçado: reconhecido pelo 7.1, mas o upx não desempacota sem a marca',
    disguisedJob?.status === 'FAILED' && /sem a marca UPX!/.test(disguisedJob.error ?? ''),
    disguisedJob,
  );

  const overlay = await upload(ana, 'dropper.exe', file('overlay.exe'));
  await unpackIdle();
  ok(
    'ZIP anexado ao executável: o arquivo de dentro',
    (await job(overlay))?.unpacker === 'archive' &&
      (await children(overlay)).some((k) => k.originalFilename === 'leia.txt'),
  );
  for (let i = 0; i < 30 && restarts() < before + 2; i++) await sleep(1000);
  ok('um container novo a cada trabalho', restarts() >= before + 2, {
    before,
    after: restarts(),
  });

  // Rotas.
  const plain = await upload(bob, 'comum.exe', file('prog64.exe'));
  await unpackIdle();
  const plainState = (await get(bob, plain)).json();
  ok(
    'executável comum: identificado na chegada, nada a desempacotar, sem a tag de empacotador',
    plainState.applicable &&
      plainState.job?.status === 'DONE' &&
      plainState.job.note === 'nada a desempacotar' &&
      plainState.job.detections.some((d: { string: string }) =>
        d.string.startsWith('Compiler: MinGW'),
      ) &&
      !(await prisma.entry.findUnique({ where: { id: plain }, select: { tags: true } }))?.tags.some(
        (t) => t.name === 'empacotado-die',
      ),
    plainState,
  );
  ok('usuário comum não pede', (await ask(bob, plain)).statusCode === 403);
  ok('analista pede de novo (sem filhas)', (await ask(ana, plain)).statusCode === 202);
  await unpackIdle();
  const net = await upload(ana, 'carregador.exe', file('dotnet.exe'));
  await unpackIdle();
  const netJob = await job(net);
  ok(
    '.NET: identificado (.NET Framework) e nada a desempacotar',
    netJob?.note === 'nada a desempacotar' &&
      ((netJob.detections ?? []) as { name: string }[]).some((d) => d.name === '.NET Framework'),
    netJob,
  );
  const shown = (await get(bob, upx)).json();
  ok(
    'a ficha lista a filha com o título',
    shown.job.status === 'DONE' &&
      shown.children.some((c: { id: string }) => c.id === unpacked?.id),
    shown,
  );
  ok('pedir de novo com filhas extraídas: 409', (await ask(ana, upx)).statusCode === 409);
  const textId = await upload(ana, 'leia.txt', Buffer.from('só texto'));
  ok(
    'texto: não se aplica e é recusado',
    !(await get(ana, textId)).json().applicable && (await ask(ana, textId)).statusCode === 400,
  );
  env.UNPACK_URL = '';
  ok('desligado: 503', (await ask(ana, inno64)).statusCode === 503);

  // Geracoes: com dois desempacotamentos acima, so identifica; com um, desempacota.
  const a = await upload(ana, 'g1.exe', file('upx32.exe'));
  const b = await upload(ana, 'g2.exe', file('upx-dll.dll'));
  const c2 = await upload(ana, 'g3.exe', file('upx64.exe'));
  const d = await upload(ana, 'g4.exe', file('upx64.exe'));
  await prisma.unpackJob.createMany({
    data: [
      { entryId: a, status: 'DONE' },
      { entryId: b, status: 'DONE' },
    ],
  });
  await prisma.entry.update({ where: { id: b }, data: { parentEntryId: a } });
  await prisma.entry.update({ where: { id: c2 }, data: { parentEntryId: b } });
  await prisma.entry.update({ where: { id: d }, data: { parentEntryId: a } });
  env.UNPACK_URL = REAL;
  stopUnpackQueue();
  const upxBuf = file('upx64.exe');
  const upxInfo = analyzeBuffer(upxBuf, 'x.exe');
  await enqueueIdentify(c2, upxBuf.length, upxInfo as never, log);
  await enqueueIdentify(d, upxBuf.length, upxInfo as never, log);
  await unpackIdle();
  const neta = await job(c2);
  ok(
    'limite de gerações: a neta de dois desempacotamentos só é identificada; a filha desempacota',
    neta?.status === 'DONE' &&
      neta.note === 'só identificado: já há duas gerações desempacotadas acima' &&
      ((neta.detections ?? []) as { type: string }[]).some((x) => x.type === 'packer') &&
      (await children(c2)).length === 0 &&
      (await job(d))?.unpacker === 'upx' &&
      (await children(d)).length === 1,
    { neta, d: await job(d) },
  );

  // ------------------------------------------------------------ 3. respostas hostis
  let target = await upload(ana, 'alvo.exe', file('upx32.exe'));
  await unpackIdle();
  const hostile = async (
    label: string,
    handle: (res: http.ServerResponse) => void,
    check: (r: any) => boolean,
  ) => {
    const fake = await fakeService(handle);
    env.UNPACK_URL = fake.url;
    await prisma.unpackJob.deleteMany({ where: { entryId: target } });
    await prisma.entry.updateMany({
      where: { parentEntryId: target },
      data: { parentEntryId: null },
    });
    await ask(ana, target);
    await unpackIdle();
    const r = await job(target);
    ok(label, check(r), r);
    await fake.close();
    env.UNPACK_URL = REAL;
  };
  await hostile(
    'resposta que não é ZIP: formato inesperado',
    (res) => res.writeHead(200, { 'content-type': 'application/zip' }).end('não é zip'),
    (r) => r?.status === 'FAILED' && r.error === 'resposta do serviço em formato inesperado',
  );
  await hostile(
    'recusa do serviço vira falha com o motivo',
    (res) =>
      res
        .writeHead(413, { 'content-type': 'application/json' })
        .end('{"error":"arquivo acima de 64 MB"}'),
    (r) => r?.status === 'FAILED' && r.error === 'arquivo acima de 64 MB',
  );

  const noUnpacker = (detections: object[]) => (res: http.ServerResponse) =>
    res.writeHead(200, { 'content-type': 'application/zip' }).end(
      storedZip([
        {
          name: 'manifest.json',
          data: Buffer.from(
            JSON.stringify({
              ok: true,
              unpacker: null,
              files: [],
              skipped: [],
              note: null,
              detections,
              dieVersion: '3.21',
              dieError: null,
            }),
          ),
        },
      ]),
    );
  const die = (type: string, name: string) => ({
    filetype: 'PE32',
    type,
    name,
    version: '',
    info: '',
    string: `${type}: ${name}`,
  });
  // Alvo sem empacotador pelo 7.1 (num UPX, a regra do UPX disfarcado vem antes, como deve).
  const plainTarget = target;
  target = await upload(ana, 'comum2.exe', file('prog32.exe'));
  await unpackIdle();
  await hostile(
    'protegido (Themida, pelo DIE): nota de que precisa executar a amostra',
    noUnpacker([die('Protector', 'Themida')]),
    (r) =>
      r?.status === 'DONE' &&
      r.note ===
        'protegido com Themida (Detect It Easy): precisa de um desempacotador que execute a amostra',
  );
  await hostile(
    'empacotador sem desempacotador estático: nota',
    noUnpacker([die('Packer', 'MPRESS')]),
    (r) =>
      r?.status === 'DONE' &&
      r.note === 'empacotado com MPRESS (Detect It Easy): nenhum desempacotador estático para ele',
  );
  target = plainTarget;
  const same = file('upx32.exe');
  const other = Buffer.from('MZ outro arquivo');
  await hostile(
    'arquivo igual à própria amostra é pulado; o outro vira filha; nome com ../ fica só o nome',
    (res) =>
      res.writeHead(200, { 'content-type': 'application/zip' }).end(
        storedZip([
          {
            name: 'manifest.json',
            data: Buffer.from(
              JSON.stringify({
                ok: true,
                unpacker: 'upx',
                label: 'UPX',
                note: null,
                files: [
                  { name: 'desempacotado', entry: 'f0001', size: same.length },
                  { name: '../../etc/outro.bin', entry: 'f0002', size: other.length },
                ],
                skipped: [],
                ms: 1,
              }),
            ),
          },
          { name: 'f0001', data: same },
          { name: 'f0002', data: other },
        ]),
      ),
    (r) => {
      const files = (r?.files ?? []) as { skipped?: string; entryId?: string }[];
      return (
        r?.status === 'DONE' &&
        files[0]?.skipped === 'igual à própria amostra' &&
        Boolean(files[1]?.entryId)
      );
    },
  );
  const sneaky = await prisma.entry.findFirst({
    where: { parentEntryId: target, originalFilename: 'outro.bin' },
  });
  ok('o nome da filha não carrega o caminho', Boolean(sneaky), sneaky?.originalFilename);
  // O servico falso ignora o ?unpack=0 e devolve os dois arquivos a cada rodada (alternando qual
  // e igual a amostra): a API para sozinha na segunda geracao abaixo do alvo.
  let level = [target];
  const deepest: string[][] = [];
  while (level.length && deepest.length < 6) {
    const next = (
      await prisma.entry.findMany({ where: { parentEntryId: { in: level } }, select: { id: true } })
    ).map((e) => e.id);
    if (next.length) deepest.push(next);
    level = next;
  }
  const lastJobs = await Promise.all((deepest.at(-1) ?? []).map((id) => job(id)));
  ok(
    'serviço que ignora o ?unpack=0: a API não cria filhas além de duas gerações',
    deepest.length === 2 &&
      lastJobs.every(
        (j) => j?.note === 'só identificado: já há duas gerações desempacotadas acima',
      ),
    { geracoes: deepest.length, lastJobs },
  );

  // ------------------------------------------------------------ 4. falha no meio do trabalho
  // A criacao da segunda filha falha (armazenamento ou banco fora): a primeira fica na lista do
  // trabalho, e um novo pedido nao a duplica.
  const two = [Buffer.from('MZ primeira filha'), Buffer.from('MZ segunda filha')];
  const twoFiles = (res: http.ServerResponse) =>
    res.writeHead(200, { 'content-type': 'application/zip' }).end(
      storedZip([
        {
          name: 'manifest.json',
          data: Buffer.from(
            JSON.stringify({
              ok: true,
              unpacker: 'nsis',
              label: 'NSIS',
              note: null,
              files: two.map((data, i) => ({
                name: `filha${i + 1}.bin`,
                entry: `f000${i + 1}`,
                size: data.length,
                detections: [],
                candidate: false,
              })),
              skipped: [],
              ms: 1,
            }),
          ),
        },
        ...two.map((data, i) => ({ name: `f000${i + 1}`, data })),
      ]),
    );
  const realCreator = unpackChildCreator(app.log);
  let calls = 0;
  await startUnpackQueue(app.log, async (child) => {
    if (++calls === 2) throw new Error('armazenamento fora');
    return realCreator(child);
  });
  stopUnpackQueue();
  target = await upload(ana, 'meio.exe', file('prog64.exe'));
  await unpackIdle();
  await hostile(
    'falha ao criar a segunda filha: a primeira fica na lista e o trabalho falha com o motivo',
    twoFiles,
    (r) => {
      const files = (r?.files ?? []) as { entryId?: string }[];
      return (
        r?.status === 'FAILED' &&
        r.error === 'falha ao criar as amostras filhas (1 de 2 criadas)' &&
        files.length === 1 &&
        Boolean(files[0]?.entryId)
      );
    },
  );
  const half = await children(target);
  ok(
    'pedir de novo depois da falha no meio: 409, sem duplicar a filha',
    (await ask(ana, target)).statusCode === 409 && half.length === 1,
    half.length,
  );
  // Mesmo sem a lista (o trabalho caiu antes de grava-la), as filhas que existem barram o pedido.
  await prisma.unpackJob.update({ where: { entryId: target }, data: { files: [] } });
  ok(
    'filhas existentes sem a lista no trabalho: 409 do mesmo jeito',
    (await ask(ana, target)).statusCode === 409,
  );

  // ------------------------------------------------------------ 5. o banco falha na fila
  // O claim() rejeitando nao pode virar rejeicao sem tratamento (o Node encerraria a API): a fila
  // registra, para, e o trabalho continua pendente para o proximo tique.
  await startUnpackQueue(app.log, realCreator);
  stopUnpackQueue();
  target = await upload(ana, 'banco-fora.exe', file('prog32.exe'));
  await unpackIdle();
  await prisma.unpackJob.deleteMany({ where: { entryId: target } });
  let unhandled: unknown = null;
  const onUnhandled = (reason: unknown) => (unhandled = reason);
  process.on('unhandledRejection', onUnhandled);
  const delegate = prisma.unpackJob as unknown as { findFirst: unknown };
  const findFirst = delegate.findFirst;
  let rejected = 0;
  delegate.findFirst = () => {
    rejected++;
    return Promise.reject(new Error('banco fora'));
  };
  const asked = await ask(ana, target);
  await unpackIdle();
  await sleep(50);
  delegate.findFirst = findFirst;
  process.off('unhandledRejection', onUnhandled);
  const waiting = await job(target);
  ok(
    'banco fora no claim(): sem rejeição sem tratamento, e o trabalho segue pendente',
    asked.statusCode === 202 && rejected > 0 && unhandled === null && waiting?.status === 'PENDING',
    { status: asked.statusCode, rejected, unhandled: String(unhandled), job: waiting?.status },
  );
  await startUnpackQueue(app.log, realCreator);
  await unpackIdle();
  ok(
    'com o banco de volta, o tique seguinte conclui o trabalho',
    (await job(target))?.status === 'DONE',
    await job(target),
  );

  stopUnpackQueue();
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
