import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { jarKeysOf } from '../../src/lib/jar';
import { prisma } from '../../src/lib/prisma';
import { riskOf } from '../../src/lib/risk-score';
import { ensureBucket } from '../../src/lib/s3';
import {
  servicesIdle,
  serviceTiming,
  startServiceQueues,
  stopServiceQueues,
} from '../../src/lib/service-analysis';
import { ZipWriter } from '../../src/lib/zip-writer';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const TOKEN = '0123456789abcdef01';
const PE = join(__dirname, '..', '.tmp', 'pe');
const file = (name: string) => readFileSync(join(PE, name));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Descompilacao de Java: o servico jar de verdade (CFR numa JRE) com um JAR compilado pelo javac
// (Runtime.exec, URLClassLoader, Cipher, Base64, Robot, webhook do Discord, agente e quatro arquivos
// embutidos: PE, ELF, ZIP e script), um JAR limpo e um .class solto. Um ZIP sem classes, pedido a
// mao, falha com o motivo.
async function main() {
  await ensureBucket(3, 500);
  env.JAR_URL = 'http://localhost:54100';
  env.JAR_TOKEN = TOKEN;
  env.EMULATE_URL = '';
  env.ANDROID_URL = '';
  env.EXTRACT_URL = '';
  env.DOTNET_URL = '';
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
      module: { mainClass: string | null; agentClass: string | null; javaVersion: string | null };
      types: { path: string }[];
      findings: { rule: string; path: string; line: number }[];
      obfuscators: string[];
      resources: { name: string; kind: string; sha256: string; entryId?: string }[];
      failed: number;
      sourceKey: string;
      sources?: unknown;
      channels?: { kind: string }[];
    };
  };
  const analysis = async (id: string, lang?: string) =>
    (await get(`/api/entries/${id}/analyses/jar`, cAna, lang)).json().analysis as Analysis;

  // ---- 1. O JAR com comportamento de risco: vai sozinho para a fila.
  const bad = await upload('atualizador.jar', file('malvado.jar'));
  await servicesIdle();
  const a = await analysis(bad);
  const rules = new Set(a?.result?.findings.map((f) => f.rule));
  ok(
    'JAR: descompilado, com a classe, o módulo e a versão do CFR',
    a?.status === 'DONE' &&
      /^CFR 0\.152/.test(a.version ?? '') &&
      a.result.types.some((t) => t.path === 'demo/Principal.java') &&
      a.result.module.mainClass === 'demo.Principal' &&
      a.result.module.agentClass === 'demo.Principal' &&
      a.result.module.javaVersion === 'Java 11' &&
      a.result.failed === 0,
    a,
  );
  ok(
    'JAR: execução, carga de classes, cifra, Base64, tela e webhook',
    ['exec', 'classloader', 'network', 'crypto', 'base64', 'screen-keys', 'discord-telegram'].every(
      (r) => rules.has(r),
    ),
    [...rules],
  );
  // Canais de exfiltracao no codigo inteiro (plans/analise-estatica-ampliada, item 3).
  const channels = (await get(`/api/entries/${bad}/channels`, cAna)).json().channels as {
    kind: string;
    source: string;
  }[];
  ok(
    'JAR: o webhook do Discord no código vira canal de exfiltração',
    channels.some((c) => c.kind === 'discord-webhook' && c.source === 'jar'),
    channels,
  );
  ok(
    'JAR: o import não conta como uso (nada na linha 1 a 12)',
    a?.result.findings.every((f) => f.line > 12),
    a?.result.findings.map((f) => f.line),
  );
  const embedded = (name: string) => a?.result.resources.find((r) => r.name.endsWith(name));
  const childOf = async (name: string) => {
    const id = embedded(name)?.entryId;
    return id
      ? prisma.entry.findUnique({
          where: { id },
          select: { parentEntryId: true, sha256: true, description: true },
        })
      : null;
  };
  const exe = await childOf('carga.exe');
  const elf = await childOf('ajuda.bin');
  const pack = await childOf('pacote.zip');
  const sh = await childOf('instala.sh');
  ok(
    'o PE embutido vira amostra filha, com o alerta alto',
    embedded('carga.exe')?.kind === 'pe' &&
      exe?.parentEntryId === bad &&
      exe.sha256 === sha(file('payload.bin')) &&
      exe.description?.includes('Arquivo embutido no JAR') &&
      a.alerts.some(
        (x) => x.level === 'high' && x.text === 'Recurso embutido executável: recursos/carga.exe',
      ),
    { exe, alerts: a?.alerts },
  );
  ok(
    'ELF, ZIP e script embutidos também viram filhas',
    embedded('ajuda.bin')?.kind === 'elf' &&
      embedded('pacote.zip')?.kind === 'zip' &&
      embedded('instala.sh')?.kind === 'script' &&
      [elf, pack, sh].every((c) => c?.parentEntryId === bad),
    { elf, pack, sh },
  );
  ok(
    'agente Java vira alerta médio',
    a?.alerts.some(
      (x) =>
        x.level === 'medium' &&
        x.text === 'Agente Java (demo.Principal): o JAR se anexa a outra JVM',
    ),
    a?.alerts,
  );
  ok(
    'o fonte fica no armazenamento, não no banco',
    a?.result.sourceKey === `jar/${bad}.json.gz` &&
      a.result.sources === undefined &&
      JSON.stringify(await jarKeysOf(bad)) === JSON.stringify([`jar/${bad}.json.gz`]),
  );
  ok(
    'IOCs: a URL da carga e o webhook',
    a?.iocs.includes('http://carga.exemplo.test/stage2.jar') &&
      a.iocs.some((i) => i.startsWith('https://discord.com/api/webhooks/123456789012345678/')),
    a?.iocs,
  );

  // ---- 2. O fonte de uma classe e o projeto em ZIP.
  const src = await get(
    `/api/entries/${bad}/jar/source?path=${encodeURIComponent('demo/Principal.java')}`,
  );
  ok(
    'fonte de uma classe',
    src.statusCode === 200 && /Runtime\.getRuntime\(\)\.exec\(/.test(src.json().source),
    src.body.slice(0, 300),
  );
  ok(
    'arquivo que não está no projeto',
    (await get(`/api/entries/${bad}/jar/source?path=nao.java`)).statusCode === 404,
  );
  ok(
    'quem não enviou nem é analista não vê o fonte',
    (await get(`/api/entries/${bad}/jar/source?path=demo/Principal.java`, cUser)).statusCode ===
      403,
  );
  const zip = await get(`/api/entries/${bad}/jar/download`);
  const audited = await prisma.auditEvent.findFirst({
    where: { action: 'ENTRY_DOWNLOADED', detail: 'código Java descompilado (.zip)' },
  });
  ok(
    'projeto em ZIP, com auditoria',
    zip.statusCode === 200 &&
      zip.headers['content-type'] === 'application/zip' &&
      zip.rawPayload.subarray(0, 2).toString() === 'PK' &&
      zip.rawPayload.includes(Buffer.from('demo/Principal.java')) &&
      audited?.actorId === ana.id,
    { status: zip.statusCode, type: zip.headers['content-type'] },
  );

  // ---- 3. Em inglês.
  const en = await analysis(bad, 'en');
  ok(
    'alertas em inglês',
    en.alerts.some((x) =>
      /^starts another program or system command: demo\/Principal\.java, line \d+$/.test(x.text),
    ) &&
      en.alerts.some(
        (x) => x.text === 'Java agent (demo.Principal): the JAR attaches to another JVM',
      ),
    en.alerts,
  );

  // ---- 4. O risco.
  const risk = await riskOf(bad);
  ok(
    'risco: o Java conta',
    risk?.reasons.some((r) => r.source === 'Java' && r.weight >= 25),
    risk?.reasons,
  );

  // ---- 5. O JAR limpo: sem achados e sem peso no risco.
  const clean = await upload('limpo.jar', file('limpo.jar'));
  await servicesIdle();
  const c = await analysis(clean);
  const cleanRisk = await riskOf(clean);
  ok(
    'JAR limpo: descompilado, sem achados nem alertas',
    c?.status === 'DONE' &&
      c.result.findings.length === 0 &&
      c.alerts.length === 0 &&
      c.result.module.mainClass === 'demo.Limpo' &&
      !cleanRisk?.reasons.some((r) => r.source === 'Java'),
    { c, reasons: cleanRisk?.reasons },
  );

  // ---- 6. O .class solto: tambem vai sozinho.
  const cls = await upload('Limpo.class', file('solto.class'));
  await servicesIdle();
  const k = await analysis(cls);
  ok(
    '.class solto: descompilado',
    k?.status === 'DONE' &&
      k.result.types.some((t) => t.path === 'demo/Limpo.java') &&
      k.result.module.javaVersion === 'Java 11',
    k,
  );

  // ---- 7. Um ZIP sem classes: nao vai sozinho; pedido a mao, falha com o motivo.
  const dir = mkdtempSync(join(tmpdir(), 'deeplook-jar-'));
  const zipPath = join(dir, 'doc.zip');
  const writer = await ZipWriter.create(zipPath);
  await writer.add('leia.txt', 2, Buffer.from('oi'));
  await writer.finish();
  const plain = await upload('doc.zip', readFileSync(zipPath));
  rmSync(dir, { recursive: true, force: true });
  await servicesIdle();
  ok(
    'ZIP não entra sozinho na fila',
    !(await prisma.serviceAnalysis.findUnique({
      where: { entryId_kind: { entryId: plain, kind: 'JAR' } },
    })),
  );
  const asked = await app.inject({
    method: 'POST',
    url: `/api/entries/${plain}/analyses/jar`,
    headers: { cookie: cAna },
    payload: {},
  });
  await servicesIdle();
  const n = await analysis(plain, 'en');
  ok(
    'pedido a mão: falha legível (em inglês)',
    asked.statusCode < 300 && n?.status === 'FAILED' && n.error === 'the JAR has no Java classes',
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
