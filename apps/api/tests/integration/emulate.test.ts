import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { riskOf } from '../../src/lib/risk-score';
import { ensureBucket } from '../../src/lib/s3';
import {
  servicesIdle,
  serviceTiming,
  startServiceQueues,
  stopServiceQueues,
} from '../../src/lib/service-analysis';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const TOKEN = '0123456789abcdef01';
const PE = join(__dirname, '..', '.tmp', 'pe');

// Emulacao de PE e shellcode (plans/novas-analises, item 4): o servico emulate de verdade (Speakeasy)
// com o PE de teste que baixa, grava, mexe na chave Run, abre o cmd e injeta; o shellcode pedido por
// um analista; e, com um servico falso, a resposta fora do formato e o servico fora do ar.
async function main() {
  await ensureBucket(3, 500);
  env.EMULATE_URL = 'http://localhost:53600';
  env.EMULATE_TOKEN = TOKEN;
  // Os outros servicos novos ficam desligados: este teste e so da emulacao.
  env.ANDROID_URL = '';
  env.EXTRACT_URL = '';
  Object.assign(serviceTiming, { serviceWaitMs: 30_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startServiceQueues(log);
  stopServiceQueues();

  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
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
  const upload = async (name: string, data: Buffer): Promise<string> => {
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
      headers: { cookie: cAna, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const get = async (id: string, c = cAna, lang?: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/analyses/emulation`,
        headers: { cookie: c, ...(lang && { 'accept-language': lang }) },
      })
    ).json();
  const post = (id: string, payload: object, c = cAna) =>
    app.inject({
      method: 'POST',
      url: `/api/entries/${id}/analyses/emulation`,
      payload,
      headers: { cookie: c },
    });

  // ---- 1. PE: vai sozinho para a fila e o Speakeasy ve o comportamento.
  const pe = await upload('emulado32.exe', readFileSync(join(PE, 'emulado32.exe')));
  await servicesIdle();
  const a = await get(pe);
  const r = a.analysis?.result;
  ok('PE vai sozinho e conclui', a.enabled && a.auto && a.analysis?.status === 'DONE', a.analysis);
  ok('versão do Speakeasy', /^speakeasy /.test(a.analysis?.version ?? ''), a.analysis?.version);
  const apis = (r?.apis ?? []).map((x: { name: string }) => x.name);
  ok(
    'chamadas de API, na ordem',
    apis.indexOf('WININET.InternetOpenUrlA') > apis.indexOf('KERNEL32.IsDebuggerPresent') &&
      apis.includes('KERNEL32.CreateRemoteThread'),
    apis,
  );
  ok(
    'rede, arquivo gravado e processo criado',
    r?.network?.traffic?.some((t: { server: string }) => t.server === 'deeplook-emulado.top') &&
      r?.dropped?.some((d: { path: string }) => /stage2\.exe$/i.test(d.path)) &&
      r?.processes?.some((p: { cmdline: string | null }) => p.cmdline === 'cmd.exe /c whoami'),
    r,
  );
  const texts = (a.analysis?.alerts ?? []).map(
    (x: { level: string; text: string }) => `${x.level}:${x.text}`,
  );
  ok(
    'alerta alto de injeção',
    texts.some((t: string) => t.startsWith('high:Injeta código')),
    texts,
  );
  ok(
    'alerta alto: contata a rede e abre outro programa',
    texts.some((t: string) => t.startsWith('high:Contata a rede e abre outro programa')),
    texts,
  );
  ok(
    'antidepuração',
    texts.some((t: string) => t.includes('depurado')),
    texts,
  );
  ok(
    'IOC sugerido: o domínio',
    a.analysis?.iocs?.includes('deeplook-emulado.top'),
    a.analysis?.iocs,
  );
  const en = await get(pe, cAna, 'en');
  ok(
    'alertas em inglês',
    en.analysis?.alerts?.some((x: { text: string }) =>
      x.text.startsWith('Injects code into another process'),
    ),
    en.analysis?.alerts,
  );
  const risk = await riskOf(pe);
  ok(
    'pontuação de risco soma a emulação',
    risk?.reasons.some((x) => x.source === 'Emulação' && x.weight >= 25),
    risk?.reasons,
  );
  ok('usuário comum vê a análise', (await get(pe, cUser)).analysis?.status === 'DONE');

  // ---- 2. Shellcode: pedido por um analista, com a arquitetura.
  // Item 16: a memoria ao fim. O programa decifra um PE (XOR) numa regiao do VirtualAlloc; o PE
  // so existe na memoria emulada e vira amostra filha, igual ao payload.bin original.
  const loader = await upload('carga-memoria.exe', readFileSync(join(PE, 'carga-memoria.exe')));
  await servicesIdle();
  const mem = (await get(loader)).analysis;
  const payloadSha = createHash('sha256')
    .update(readFileSync(join(PE, 'payload.bin')))
    .digest('hex');
  const region = (mem?.result?.memory?.regions ?? []).find(
    (x: { kind: string }) => x.kind === 'pe',
  );
  const memChild = await prisma.entry.findFirst({
    where: { parentEntryId: loader },
    select: { id: true, sha256: true, originalFilename: true, description: true },
  });
  ok(
    'memória ao fim: o PE decifrado no VirtualAlloc vira filha, igual ao original',
    mem?.status === 'DONE' &&
      /^api\.VirtualAlloc/.test(region?.tag ?? '') &&
      region.carved === payloadSha &&
      memChild?.sha256 === payloadSha &&
      Boolean(memChild.originalFilename?.startsWith('memoria-0x')) &&
      mem.result.memory.carved[0]?.entryId === memChild.id &&
      mem.result.memory.carved[0]?.data === undefined &&
      mem.alerts.some((x: { text: string }) => x.text.startsWith('PE escrito na memória')),
    { mem: mem?.result?.memory, alerts: mem?.alerts, memChild },
  );
  // A filha (o payload, que nao aloca nada) nao gera netas.
  ok(
    'a filha da memória não gera netas',
    (await prisma.entry.count({ where: { parentEntryId: memChild?.id } })) === 0,
  );

  const sc = await upload('payload.bin', Buffer.from([0x90, 0x90, 0x31, 0xc0, 0xc3]));
  await servicesIdle();
  ok('binário qualquer não vai sozinho', (await get(sc)).analysis === null);
  ok(
    'usuário comum não pede',
    (await post(sc, { kind: 'shellcode', arch: 'x86' }, cUser)).statusCode === 403,
  );
  ok('opção inválida', (await post(sc, { kind: 'shellcode', arch: 'arm' })).statusCode === 400);
  ok('campo desconhecido', (await post(sc, { kind: 'shellcode', extra: 1 })).statusCode === 400);
  ok('sem opção, o binário não é PE', (await post(sc, {})).statusCode === 400);
  ok('pedido aceito', (await post(sc, { kind: 'shellcode', arch: 'x86' })).statusCode === 202);
  ok(
    'repetido enquanto na fila',
    (await post(sc, { kind: 'shellcode', arch: 'x86' })).statusCode === 409,
  );
  await servicesIdle();
  const s = await get(sc);
  ok(
    'shellcode emulado',
    s.analysis?.status === 'DONE' &&
      s.analysis.result?.kind === 'shellcode' &&
      s.analysis.options?.arch === 'x86' &&
      s.analysis.result?.entryPoints?.[0]?.type === 'shellcode',
    s.analysis,
  );

  // ---- 3. Servico falso: resposta fora do formato e servico fora do ar.
  const fake = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ state: 'livre' }));
      return;
    }
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, kind: 'pe', apis: 'não é lista' }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  env.EMULATE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  await post(pe, {});
  await servicesIdle();
  const bad = await get(pe);
  ok(
    'formato inesperado vira falha legível',
    bad.analysis?.status === 'FAILED' &&
      bad.analysis.error === 'resposta do serviço em formato inesperado',
    bad.analysis,
  );
  fake.close();
  env.EMULATE_URL = 'http://127.0.0.1:1';
  Object.assign(serviceTiming, { serviceWaitMs: 300, retryEveryMs: 100, retryAfterMs: 0 });
  await post(pe, {});
  await servicesIdle();
  const down = await prisma.serviceAnalysis.findUnique({
    where: { entryId_kind: { entryId: pe, kind: 'EMULATION' } },
  });
  ok(
    'serviço fora do ar: volta para a fila e, sem tentativas, falha',
    down?.status === 'FAILED' && down.attempts === 3 && /não respondeu/.test(down.error ?? ''),
    down,
  );
  env.EMULATE_URL = '';
  ok('desligado: pedido recusado', (await post(pe, {})).statusCode === 503);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
