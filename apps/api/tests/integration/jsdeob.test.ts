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
const JS = join(__dirname, '..', 'fixtures', 'js');
const file = (name: string) => readFileSync(join(JS, name));
const C2 = 'https://c2.exemplo.invalid/carga.ps1';

// Desofuscacao de JavaScript (plans/analise-estatica-ampliada, item 20): o servico jsdeob de verdade
// (webcrack no Node) com um script do javascript-obfuscator 4.1.1 (string array em Base64, fluxo
// achatado, strings partidas), solto e dentro de um HTML. O desofuscado vira camada da analise de
// scripts, e a URL e a execucao que a ofuscacao escondia aparecem.
async function main() {
  await ensureBucket(3, 500);
  env.JSDEOB_URL = 'http://localhost:54200';
  env.JSDEOB_TOKEN = TOKEN;
  for (const k of ['EMULATE_URL', 'ANDROID_URL', 'EXTRACT_URL', 'DOTNET_URL', 'JAR_URL'] as const) {
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
        url: `/api/entries/${id}/analyses/jsdeob`,
        headers: { cookie: cAna },
      })
    ).json().analysis;
  const script = async (id: string) =>
    (
      (await prisma.entry.findUnique({ where: { id }, select: { staticInfo: true } }))
        ?.staticInfo as any
    )?.script;

  // ---- 1. O .js ofuscado: vai sozinho para a fila.
  const before = (await import('../../src/lib/script-analysis')).analyzeScript(
    file('obfuscatorio.js'),
    'fatura.js',
  );
  const id = await upload('fatura.js', file('obfuscatorio.js'));
  await servicesIdle();
  const a = await analysis(id);
  const squash = (s: string) => s.replace(/\s+/g, '');
  ok(
    'ofuscado: o webcrack devolve o código original',
    a?.status === 'DONE' &&
      /^webcrack 2\.16/.test(a.version ?? '') &&
      a.result.changed === true &&
      squash(a.result.code) === squash(file('obfuscatorio.original.js').toString()),
    a,
  );
  const s = await script(id);
  ok(
    'a análise de scripts ganha a camada do webcrack, a URL e a execução que a ofuscação escondia',
    !before?.urls.includes(C2) &&
      s?.layers.some((l: { method: string }) => l.method.startsWith('webcrack')) &&
      s.urls.includes(C2) &&
      s.findings.length > (before?.findings.length ?? 0) &&
      s.risk === 'high',
    { before: before && { urls: before.urls, findings: before.findings.map((f) => f.name) }, s },
  );
  ok(
    'alerta do desofuscado e a URL nos IOCs da análise',
    a.alerts.some((x: { text: string }) => x.text.startsWith('No código desofuscado:')) &&
      a.iocs.includes(C2),
    { alerts: a.alerts, iocs: a.iocs },
  );

  // ---- 2. Pedir de novo nao empilha a camada.
  await app.inject({
    method: 'POST',
    url: `/api/entries/${id}/analyses/jsdeob`,
    headers: { cookie: cAna },
    payload: {},
  });
  await servicesIdle();
  const again = await script(id);
  ok(
    'pedir de novo: uma camada do webcrack só',
    again?.layers.filter((l: { method: string }) => l.method.startsWith('webcrack')).length === 1,
    again?.layers.map((l: { method: string }) => l.method),
  );

  // ---- 3. O mesmo script dentro de um HTML.
  const html = Buffer.concat([
    Buffer.from('<html><body><p>Fatura</p><script>'),
    file('obfuscatorio.js'),
    Buffer.from('</script></body></html>'),
  ]);
  const htmlId = await upload('fatura.html', html);
  await servicesIdle();
  const h = await analysis(htmlId);
  ok(
    'HTML: os scripts embutidos são desofuscados juntos',
    h?.status === 'DONE' && h.result.scripts === 1 && h.result.code.includes(C2),
    h,
  );

  // ---- 4. Texto que nao e JavaScript nao vai para a fila.
  const txt = await upload('notas.txt', Buffer.from('apenas um texto qualquer, sem script nenhum'));
  await servicesIdle();
  ok('texto comum: fora da fila', (await analysis(txt)) === null);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
