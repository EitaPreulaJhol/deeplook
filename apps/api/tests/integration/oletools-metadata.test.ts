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
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));
const TOKEN = '0123456789abcdef01';

// Metadados com o ExifTool (plans/analise-estatica-ampliada, item 19), pela rota /metadata do
// servico oletools de verdade: um DOCX com autor e datas trocadas e dois PDFs do mesmo modelo
// (o mesmo DocumentID do XMP), que a aba Relacionadas liga.
async function main() {
  await ensureBucket(3, 500);
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.OLETOOLS_URL = 'http://localhost:53500';
  env.OLETOOLS_TOKEN = TOKEN;
  for (const k of [
    'EMULATE_URL',
    'ANDROID_URL',
    'EXTRACT_URL',
    'DOTNET_URL',
    'JAR_URL',
    'JSDEOB_URL',
  ] as const) {
    env[k] = '';
  }
  Object.assign(serviceTiming, { serviceWaitMs: 60_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startServiceQueues(log);
  stopServiceQueues();
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const cookie = String(
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
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const analysis = async (id: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/analyses/metadata`,
        headers: { cookie },
      })
    ).json().analysis;

  const docx = await upload('fatura.docx', file('metadados.docx'));
  await servicesIdle();
  const d = await analysis(docx);
  ok(
    'DOCX: autor, modificado por e empresa, a ferramenta e as datas, pelo ExifTool',
    d?.status === 'DONE' &&
      /^ExifTool \d+\.\d+/.test(d.version ?? '') &&
      JSON.stringify(d.result.fields.authors) ===
        JSON.stringify(['Joao Golpista', 'Operador 7', 'Fatura Facil Ltda']) &&
      d.result.fields.tools[0] === 'Microsoft Office Word' &&
      d.result.groups.XML?.LastModifiedBy === 'Operador 7' &&
      !('System' in d.result.groups),
    d,
  );
  ok(
    'DOCX: modificado antes de criado vira aviso',
    d.alerts.some(
      (a: { level: string; text: string }) =>
        a.level === 'info' &&
        a.text.startsWith('Modificado (2026-01-01) antes de criado (2026-05-10)'),
    ),
    d.alerts,
  );
  const pivots = await prisma.entryPivot.findMany({
    where: { entryId: docx },
    orderBy: [{ kind: 'asc' }, { value: 'asc' }],
  });
  ok(
    'DOCX: autores e ferramenta viram pivôs da origem metadata',
    pivots.some((p) => p.kind === 'DOC_AUTHOR' && p.value === 'Joao Golpista') &&
      pivots.some((p) => p.kind === 'DOC_TOOL' && p.value === 'Microsoft Office Word') &&
      pivots.every((p) => p.source === 'metadata'),
    pivots,
  );

  const pdfA = await upload('fatura-001.pdf', file('modelo-a.pdf'));
  const pdfB = await upload('fatura-002.pdf', file('modelo-b.pdf'));
  await servicesIdle();
  const a = await analysis(pdfA);
  ok(
    'PDF: Producer, CreatorTool e os IDs do XMP',
    a?.status === 'DONE' &&
      a.result.fields.tools.includes('FabricaDeFaturas 3.1') &&
      a.result.fields.xmpIds.includes('6f1c2a9e-0b7d-4c55-9f3e-2d8a7b1c0e44') &&
      a.result.groups['XMP-xmpMM']?.DocumentID === 'uuid:6f1c2a9e-0b7d-4c55-9f3e-2d8a7b1c0e44',
    a,
  );
  const related = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${pdfA}/related`,
      headers: { cookie },
    })
  ).json().items as { entry: { id: string }; reasons: { kind: string; detail?: unknown }[] }[];
  const toB = related.find((i) => i.entry.id === pdfB)?.reasons ?? [];
  ok(
    'Relacionadas: os dois PDFs do mesmo modelo ligados pelo DocumentID do XMP',
    toB.some(
      (r) =>
        r.kind === 'SAME_PIVOT' &&
        (r.detail as { pivot: string; value: string }).pivot === 'XMP_ID' &&
        (r.detail as { value: string }).value === '6f1c2a9e-0b7d-4c55-9f3e-2d8a7b1c0e44',
    ),
    toB,
  );
  ok('Relacionadas: o DOCX não se liga aos PDFs', !related.some((i) => i.entry.id === docx));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
