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

// Servico ml de verdade (plans/analise-estatica-ampliada, itens 26 e 29): o EMBER2024 da a nota
// informativa ao PE, e a aba de strings junta e ordena pelo StringSifter (sem o servico, pelas
// categorias).
async function main() {
  await ensureBucket(3, 500);
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.ML_URL = 'http://localhost:54400';
  env.ML_TOKEN = TOKEN;
  for (const k of [
    'EMULATE_URL',
    'ANDROID_URL',
    'EXTRACT_URL',
    'DOTNET_URL',
    'JAR_URL',
    'JSDEOB_URL',
    'OLETOOLS_URL',
    'PYDEC_URL',
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
        url: `/api/entries/${id}/analyses/ember`,
        headers: { cookie },
      })
    ).json().analysis;

  const strings = async (id: string) =>
    (
      await app.inject({ method: 'GET', url: `/api/entries/${id}/strings`, headers: { cookie } })
    ).json();

  // ---- EMBER2024: o PE vai sozinho; nota informativa, fora do risco.
  const pe = await upload('fatura.exe', file('prog64.exe'));
  await servicesIdle();
  const e = await analysis(pe);
  ok(
    'EMBER2024: o PE recebe a nota do modelo de PE, como alerta informativo',
    e?.status === 'DONE' &&
      e.result.model === 'EMBER2024_PE' &&
      e.result.features === 2568 &&
      e.result.score >= 0 &&
      e.result.score <= 1 &&
      e.alerts.every((a: { level: string }) => a.level === 'info'),
    e,
  );

  // ---- Strings: o arquivo, com a posicao, na ordem do StringSifter.
  const s = await strings(pe);
  const url = s.items?.find((x: { text: string }) => x.text === 'http://evil.test/stage2.bin');
  const rankOf = (text: string) => s.items.findIndex((x: { text: string }) => x.text === text);
  ok(
    'strings: ordenadas pelo StringSifter, com a URL no alto, a posição e a categoria',
    s.rankedBy === 'stringsifter' &&
      s.total > 20 &&
      Boolean(url) &&
      url.categories.includes('url') &&
      typeof url.offset === 'number' &&
      rankOf('http://evil.test/stage2.bin') < s.items.length / 4,
    { rankedBy: s.rankedBy, reason: s.rankReason, total: s.total, url, top: s.items?.slice(0, 5) },
  );
  ok(
    'strings: a posição bate com o arquivo',
    file('prog64.exe').toString('latin1', url.offset, url.offset + url.text.length) === url.text,
  );

  // ---- Sem o servico: a ordem pelas categorias, sem erro.
  env.ML_URL = '';
  const off = await strings(pe);
  ok(
    'strings sem o serviço ml: ordem pelas categorias',
    off.rankedBy === 'heuristic' && off.total === s.total,
    { rankedBy: off.rankedBy, total: off.total },
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
