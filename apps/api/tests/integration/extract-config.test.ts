import { readFileSync } from 'node:fs';
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

/**
 * "MZ" com o que a regra Remcos do CAPEv2 procura (o nome, o formato da hora e a rotina de
 * decifrar): a regra casa e o extrator do Remcos roda, mas nao acha a configuracao (nao e um PE de
 * verdade). Nenhum malware: so os bytes que a regra pede.
 */
function remcosLookalike(): Buffer {
  return Buffer.concat([
    Buffer.from('MZ'),
    Buffer.alloc(200),
    Buffer.from('Remcos\0%02i:%02i:%02i:%03i\0', 'latin1'),
    Buffer.from([0x81, 0xe1, 0xff, 0x00, 0x00, 0x80, 0x79, 0x05, 0x49, 0x81, 0xc9, 0x00]),
    Buffer.from([0xff, 0xff, 0xff, 0x41, 0x8a, 0x04, 0x80]),
    Buffer.alloc(200),
  ]);
}

// Configuracao de familias (plans/novas-analises, item 2): o servico extract de verdade (CAPE-parsers
// com as regras do CAPEv2). Um PE comum nao casa nada; o que imita o Remcos casa a regra, roda o
// extrator e, sem configuracao, vira alerta medio e a pontuacao de "familia reconhecida".
async function main() {
  await ensureBucket(3, 500);
  env.EXTRACT_URL = 'http://localhost:53900';
  env.EXTRACT_TOKEN = TOKEN;
  env.EMULATE_URL = '';
  env.ANDROID_URL = '';
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
  const get = async (id: string, lang?: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/entries/${id}/analyses/config`,
        headers: { cookie: cAna, ...(lang && { 'accept-language': lang }) },
      })
    ).json();

  // ---- 1. PE comum: nenhuma familia.
  const clean = await upload(
    'checksum-ok.exe',
    readFileSync(join(__dirname, '..', '.tmp', 'pe', 'checksum-ok.exe')),
  );
  await servicesIdle();
  const c = await get(clean);
  ok('PE vai sozinho e conclui', c.enabled && c.auto && c.analysis?.status === 'DONE', c.analysis);
  ok(
    'extratores carregados e nada reconhecido',
    c.analysis?.result?.parsers >= 60 &&
      c.analysis.result.matches.length === 0 &&
      c.analysis.result.configs.length === 0 &&
      (c.analysis.alerts ?? []).length === 0,
    c.analysis?.result,
  );
  ok(
    'versão com o commit das regras',
    /^CAPE-parsers .*\(regras [0-9a-f]{12}\)$/.test(c.analysis?.version ?? ''),
    c.analysis?.version,
  );

  // ---- 2. Imita o Remcos: a regra casa, o extrator roda e nao acha configuracao.
  const fake = await upload('remcos-de-mentira.exe', remcosLookalike());
  await servicesIdle();
  const f = await get(fake);
  ok(
    'regra Remcos do CAPE casou',
    f.analysis?.status === 'DONE' &&
      f.analysis.result.matches.some((m: { family: string }) => m.family === 'Remcos'),
    f.analysis?.result,
  );
  ok('sem configuração extraída', f.analysis?.result?.configs?.length === 0, f.analysis?.result);
  const texts = (f.analysis?.alerts ?? []).map(
    (x: { level: string; text: string }) => `${x.level}:${x.text}`,
  );
  ok(
    'alerta médio: família reconhecida sem configuração',
    texts.includes('medium:Regra do CAPE reconhece Remcos, sem configuração extraída.'),
    texts,
  );
  const en = await get(fake, 'en');
  ok(
    'alerta em inglês',
    en.analysis?.alerts?.some(
      (x: { text: string }) =>
        x.text === 'A CAPE rule recognizes Remcos, with no configuration extracted.',
    ),
    en.analysis?.alerts,
  );
  const risk = await riskOf(fake);
  ok(
    'pontuação: família reconhecida vale 35',
    risk?.reasons.some(
      (x) => x.source === 'Configuração' && x.weight === 35 && /Remcos/.test(x.text),
    ),
    risk?.reasons,
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
