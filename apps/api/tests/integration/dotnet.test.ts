import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { dotnetKeysOf } from '../../src/lib/dotnet';
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
const file = (name: string) => readFileSync(join(PE, name));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Descompilacao de .NET (plans/caca-e-formatos, item 3): o servico dotnet de verdade (ilspycmd) com
// o loader de teste (baixa, grava na chave Run, executa, traz um PE como recurso e o atributo do
// ConfuserEx) e o assembly de antes (carga em memoria, VirtualAlloc). O PE nativo nao vai sozinho
// para a fila; pedido a mao, falha com o motivo.
async function main() {
  await ensureBucket(3, 500);
  env.DOTNET_URL = 'http://localhost:54000';
  env.DOTNET_TOKEN = TOKEN;
  env.EMULATE_URL = '';
  env.ANDROID_URL = '';
  env.EXTRACT_URL = '';
  Object.assign(serviceTiming, { serviceWaitMs: 60_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startServiceQueues(log);
  stopServiceQueues();

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
  const get = (url: string, cookie = cAna, lang?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { cookie, ...(lang && { 'accept-language': lang }) },
    });
  type Analysis = {
    status: string;
    error: string | null;
    version: string | null;
    alerts: { level: string; text: string }[];
    iocs: string[];
    result: {
      module: { name: string; framework: string };
      types: { path: string }[];
      findings: { rule: string; path: string; line: number }[];
      obfuscators: string[];
      resources: { name: string; kind: string; sha256: string; entryId?: string }[];
      sourceKey: string;
      sources?: unknown;
    };
  };
  const analysis = async (id: string, lang?: string) =>
    (await get(`/api/entries/${id}/analyses/dotnet`, cAna, lang)).json().analysis as Analysis;

  // ---- 1. O loader: vai sozinho para a fila (PE .NET).
  const loader = await upload('atualizador.exe', file('dotnet-loader.exe'));
  await servicesIdle();
  const a = await analysis(loader);
  const rules = new Set(a?.result?.findings.map((f) => f.rule));
  ok(
    'loader: descompilado, com os tipos e a versão do ILSpy',
    a?.status === 'DONE' &&
      /^ilspycmd 11\./.test(a.version ?? '') &&
      a.result.types.some((t) => t.path === 'Carga/Programa.cs') &&
      a.result.module.name === 'dotnet-loader',
    a,
  );
  ok(
    'loader: download, execução e chave Run',
    ['download', 'process-start', 'run-key'].every((r) => rules.has(r)),
    [...rules],
  );
  ok(
    'loader: ConfuserEx reconhecido pelo atributo',
    JSON.stringify(a?.result.obfuscators) === '["ConfuserEx"]' &&
      a.alerts.some(
        (x) => x.text === 'Ofuscado com ConfuserEx: a descompilação pode estar ilegível',
      ),
    a?.result.obfuscators,
  );
  const res = a?.result.resources.find((r) => r.name.endsWith('carga.bin'));
  const child = res?.entryId
    ? await prisma.entry.findUnique({
        where: { id: res.entryId },
        select: { parentEntryId: true, sha256: true, description: true },
      })
    : null;
  ok(
    'o PE embutido como recurso vira amostra filha',
    res?.kind === 'pe' &&
      child?.parentEntryId === loader &&
      child.sha256 === sha(file('prog32.exe')) &&
      a.alerts.some((x) => x.level === 'high' && x.text.startsWith('Recurso embutido executável')),
    { res, child },
  );
  ok(
    'o fonte fica no armazenamento, não no banco',
    a?.result.sourceKey === `dotnet/${loader}.json.gz` &&
      a.result.sources === undefined &&
      JSON.stringify(await dotnetKeysOf(loader)) === JSON.stringify([`dotnet/${loader}.json.gz`]),
  );
  ok(
    'IOC: a URL do segundo estágio',
    a?.iocs.includes('http://loader.evil.test/estagio2.bin'),
    a?.iocs,
  );

  // ---- 2. O fonte de um tipo e o projeto em ZIP.
  const src = await get(
    `/api/entries/${loader}/dotnet/source?path=${encodeURIComponent('Carga/Programa.cs')}`,
  );
  ok(
    'fonte de um tipo',
    src.statusCode === 200 && /DownloadData\("http:\/\/loader\.evil\.test/.test(src.json().source),
    src.body.slice(0, 300),
  );
  ok(
    'arquivo que não está no projeto',
    (await get(`/api/entries/${loader}/dotnet/source?path=nao.cs`)).statusCode === 404,
  );
  ok(
    'quem não enviou nem é analista não vê o fonte',
    (await get(`/api/entries/${loader}/dotnet/source?path=Carga/Programa.cs`, cUser)).statusCode ===
      403,
  );
  const zip = await get(`/api/entries/${loader}/dotnet/download`);
  const audited = await prisma.auditEvent.findFirst({
    where: { action: 'ENTRY_DOWNLOADED', detail: 'código .NET descompilado (.zip)' },
  });
  ok(
    'projeto em ZIP, com auditoria',
    zip.statusCode === 200 &&
      zip.headers['content-type'] === 'application/zip' &&
      zip.rawPayload.subarray(0, 2).toString() === 'PK' &&
      zip.rawPayload.includes(Buffer.from('Carga/Programa.cs')) &&
      audited?.actorId === ana.id,
    { status: zip.statusCode, type: zip.headers['content-type'] },
  );

  // ---- 3. Em inglês.
  const en = await analysis(loader, 'en');
  ok(
    'alertas em inglês',
    en.alerts.some((x) =>
      /^downloads content from the internet: Carga\/Programa\.cs, line \d+$/.test(x.text),
    ) &&
      en.alerts.some(
        (x) => x.text === 'Obfuscated with ConfuserEx: the decompilation may be unreadable',
      ),
    en.alerts,
  );

  // ---- 4. O assembly de antes (carga em memoria) e o risco.
  const hello = await upload('carregador.exe', file('dotnet.exe'));
  await servicesIdle();
  const h = await analysis(hello);
  ok(
    'carga em memória e VirtualAlloc',
    h?.status === 'DONE' &&
      ['assembly-load', 'native-memory', 'keylogger'].every((r) =>
        h.result.findings.some((f) => f.rule === r),
      ) &&
      h.iocs.includes('http://dotnet.evil.test/c2'),
    h,
  );
  const risk = await riskOf(hello);
  ok(
    'risco: o .NET conta',
    risk?.reasons.some((r) => r.source === '.NET' && r.weight >= 25),
    risk?.reasons,
  );

  // ---- 5. PE nativo: nao vai sozinho; pedido a mao, falha com o motivo.
  const native = await upload('nativo.exe', file('prog64.exe'));
  await servicesIdle();
  ok(
    'PE nativo não entra sozinho na fila',
    !(await prisma.serviceAnalysis.findUnique({
      where: { entryId_kind: { entryId: native, kind: 'DOTNET' } },
    })),
  );
  const asked = await app.inject({
    method: 'POST',
    url: `/api/entries/${native}/analyses/dotnet`,
    headers: { cookie: cAna },
    payload: {},
  });
  await servicesIdle();
  const n = await analysis(native, 'en');
  ok(
    'pedido a mão: falha legível (em inglês)',
    asked.statusCode < 300 &&
      n?.status === 'FAILED' &&
      n.error === 'not a .NET assembly (no CLR metadata)',
    { asked: asked.body, n },
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
