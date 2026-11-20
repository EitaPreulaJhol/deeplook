import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
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
const PY = join(process.env.TEST_TMP!, 'py');
const file = (name: string) => readFileSync(join(PY, name));
const C2 = 'https://c2.exemplo.invalid/painel';

// Descompilacao de bytecode Python (plans/analise-estatica-ampliada, item 15): o servico pydec de
// verdade (pycdc e pycdas) com os .pyc e o PYZ que o run.mjs compila com o Python 3.9 a partir de
// fixtures/py: um script que descompila inteiro, um que para no laco (sai o disassembly), o
// carregador do PyArmor e um PYZ com dois modulos do autor e um da biblioteca padrao.
async function main() {
  await ensureBucket(3, 500);
  env.PYDEC_URL = 'http://localhost:54300';
  env.PYDEC_TOKEN = TOKEN;
  for (const k of [
    'EMULATE_URL',
    'ANDROID_URL',
    'EXTRACT_URL',
    'DOTNET_URL',
    'JAR_URL',
    'JSDEOB_URL',
    'OLETOOLS_URL',
  ] as const) {
    env[k] = '';
  }
  Object.assign(serviceTiming, { serviceWaitMs: 60_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startServiceQueues(log);
  stopServiceQueues();

  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  const cAna = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
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
  const analysis = async (id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/analyses/pydec`,
        headers: { cookie: cAna },
      })
    ).json().analysis;
  const script = async (id: string) =>
    (
      (await prisma.entry.findUnique({ where: { id }, select: { staticInfo: true } }))
        ?.staticInfo as any
    )?.script;

  const source = async (id: string, path: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/pydec/source?path=${encodeURIComponent(path)}`,
        headers: { cookie: cAna },
      })
    ).json().source as string | undefined;

  // ---- 1. O .pyc que descompila inteiro: vai sozinho para a fila.
  const id = await upload('ladrao.pyc', file('ladrao.pyc'));
  await servicesIdle();
  const a = await analysis(id);
  const src = await source(id, a?.result?.types?.[0]?.path ?? '');
  ok(
    '.pyc: o pycdc devolve o fonte, guardado fora do banco, com a URL',
    a?.status === 'DONE' &&
      /^pycdc /.test(a.version ?? '') &&
      a.result.module.kind === 'pyc' &&
      a.result.module.pythonVersion === '3.9' &&
      a.result.failed === 0 &&
      a.result.sources === undefined &&
      Boolean(src?.includes(`C2 = '${C2}'`)) &&
      Boolean(src?.includes("'Login Data'")) &&
      a.iocs.includes(C2),
    { a, src },
  );
  const s = await script(id);
  ok(
    'a análise de scripts no sabor Python passa a ser a da amostra (o subprocess e a URL)',
    s?.language === 'python' &&
      s.urls.includes(C2) &&
      s.findings.some((f: { name: string }) => /Popen|subprocess/.test(f.name)) &&
      a.alerts.some((x: { text: string }) => x.text.startsWith('No código Python:')),
    { s, alerts: a.alerts },
  );

  // ---- 2. O laco que o pycdc nao segue: o parcial com o disassembly.
  const partialId = await upload('varredura.pyc', file('varredura.pyc'));
  await servicesIdle();
  const partial = await analysis(partialId);
  ok(
    'parcial: o fonte até onde deu e o disassembly do pycdas junto',
    partial?.status === 'DONE' &&
      partial.result.failed === 1 &&
      partial.result.types.some((t: { path: string }) => t.path.endsWith('.pycdas.txt')) &&
      partial.alerts.some((x: { level: string; text: string }) =>
        x.text.startsWith('1 módulo(s) não foram descompilados por completo'),
      ),
    partial,
  );

  // ---- 3. O carregador do PyArmor: reconhecido e dito.
  const armorId = await upload('armado.pyc', file('armado.pyc'));
  await servicesIdle();
  const armor = await analysis(armorId);
  ok(
    'PyArmor: reconhecido, com o aviso de que o bytecode real não descompila',
    armor?.status === 'DONE' &&
      armor.result.obfuscators.includes('PyArmor') &&
      armor.alerts.some(
        (x: { level: string; text: string }) =>
          x.level === 'high' && x.text.startsWith('Protegido pelo PyArmor'),
      ),
    armor,
  );

  // ---- 4. O PYZ do PyInstaller: os modulos do autor, sem a biblioteca padrao.
  const pyzId = await upload('PYZ-00.pyz', file('painel.pyz'));
  await servicesIdle();
  const z = await analysis(pyzId);
  ok(
    'PYZ: os dois módulos do autor (o base64 da biblioteca padrão fica de fora)',
    z?.status === 'DONE' &&
      z.result.module.kind === 'pyz' &&
      z.result.module.modules === 2 &&
      z.result.types.some((t: { path: string }) => t.path === 'painel.py') &&
      z.result.types.some((t: { path: string }) => t.path === 'painel/varredura.py') &&
      !z.result.types.some((t: { path: string }) => t.path.startsWith('base64')) &&
      Boolean((await source(pyzId, 'painel.py'))?.includes(C2)),
    z,
  );
  const zip = await app.inject({
    method: 'GET',
    url: `/api/entries/${pyzId}/pydec/download`,
    headers: { cookie: cAna },
  });
  ok(
    'o projeto inteiro em ZIP',
    zip.statusCode === 200 && zip.rawPayload.subarray(0, 2).toString() === 'PK',
    zip.statusCode,
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
