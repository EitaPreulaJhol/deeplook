import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { extractZipEntry, listZip } from '../../src/lib/zip';

// Item 4.2: o download confere o SHA-256 e o tamanho enquanto os bytes passam.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await ensureBucket(3, 500);
  const alertLog = join(process.env.TEST_TMP!, `alertas-integridade-${Date.now()}.jsonl`);
  env.ALERT_LOG = alertLog;
  const app = await buildApp();
  await app.ready();

  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['dono@x.io', 'USER'],
    ['outro@x.io', 'USER'],
    ['ana@x.io', 'ANALYST'],
  ] as const) {
    const u = await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        apiAccess: true,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
    ids[email] = u.id;
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
  const [cDono, cAna] = await Promise.all(['dono@x.io', 'ana@x.io'].map(login));

  /** Envio pelo upload de verdade: o hash gravado e o do que a API recebeu. */
  const upload = async (buf: Buffer, name: string) => {
    const boundary = `----dl${Math.random()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/entries/file',
      headers: { cookie: cDono, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        buf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    const id = res.json<{ entry: { id: string } }>().entry.id;
    return prisma.entry.findUniqueOrThrow({ where: { id } });
  };
  const download = (id: string, c = cDono, query = '') =>
    app.inject({
      method: 'GET',
      url: `/api/entries/${id}/download${query}`,
      headers: { cookie: c },
    });
  const put = (key: string, body: Buffer) =>
    s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body }));
  const row = (id: string) => prisma.entry.findUniqueOrThrow({ where: { id } });
  const audits = (action: 'ENTRY_INTEGRITY_FAILED' | 'ENTRY_INTEGRITY_RESTORED', id?: string) =>
    prisma.auditEvent.findMany({
      where: { action, ...(id ? { targetLabel: { contains: id } } : {}) },
    });
  const flip = (buf: Buffer) => {
    const bad = Buffer.from(buf);
    bad[bad.length >> 1] ^= 0xff;
    return bad;
  };

  // 1. Arquivo integro: entregue igual, conferido e sem alarme.
  const original = randomBytes(300 * 1024);
  const good = await upload(original, 'bom-integridade.bin');
  ok('o envio gravou o SHA-256 e o tamanho', Boolean(good.sha256) && good.fileSize === 300 * 1024);
  const first = await download(good.id);
  ok(
    'integro: baixa os mesmos bytes',
    first.statusCode === 200 && Buffer.compare(first.rawPayload, original) === 0,
    first.statusCode,
  );
  ok('integro: sem cabeçalho de alerta', first.headers['x-deeplook-integrity'] === undefined);
  ok('integro: Content-Length é o do objeto', first.headers['content-length'] === '307200');
  const checked = await row(good.id);
  ok(
    'integro: registra a conferência e não marca',
    checked.integrityCheckedAt !== null && checked.integrityFailedAt === null,
    checked,
  );
  ok(
    'integro: sem auditoria de divergência',
    (await audits('ENTRY_INTEGRITY_FAILED')).length === 0,
  );

  // 2. Conteudo trocado no armazenamento (mesmo tamanho): entrega, marca e audita.
  const badBytes = flip(original);
  await put(good.storageKey!, badBytes);
  const dl2 = await download(good.id, cAna);
  ok(
    'divergente: o arquivo é entregue mesmo assim (não tira a única cópia)',
    dl2.statusCode === 200 && Buffer.compare(dl2.rawPayload, badBytes) === 0,
    dl2.statusCode,
  );
  ok(
    'divergente: a primeira vez ainda sai sem cabeçalho (só se sabe ao final)',
    dl2.headers['x-deeplook-integrity'] === undefined,
  );
  const flagged = await row(good.id);
  ok('divergente: a amostra fica marcada', flagged.integrityFailedAt !== null, flagged);
  const failed = await audits('ENTRY_INTEGRITY_FAILED', 'bom-integridade');
  ok('divergente: uma auditoria', failed.length === 1, failed.length);
  // Log centralizado de alertas (plano pos-revisao, 5.2): a divergencia vira uma linha.
  const alerts = existsSync(alertLog)
    ? readFileSync(alertLog, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
  ok(
    'divergente: uma linha no log de alertas',
    alerts.length === 1 &&
      alerts[0].code === 'integrity.mismatch' &&
      alerts[0].context.entryId === good.id &&
      alerts[0].context.expected === good.sha256,
    alerts,
  );
  ok(
    'auditoria: quem baixou, de quem é, o hash esperado e o calculado',
    failed[0]?.actorId === ids['ana@x.io'] &&
      failed[0]?.targetUserId === ids['dono@x.io'] &&
      failed[0]?.detail?.includes(`esperado ${good.sha256}`) === true &&
      failed[0]?.detail?.includes('no download') === true &&
      failed[0]?.detail?.includes('calculado') === true,
    failed[0],
  );

  // 3. Segue estragado: avisa no cabecalho e NAO enche a trilha de novo.
  const before = (await row(good.id)).integrityCheckedAt!;
  await sleep(15);
  const dl3 = await download(good.id);
  ok(
    'marcada: o download seguinte avisa no cabeçalho',
    dl3.headers['x-deeplook-integrity'] === 'mismatch',
  );
  ok('marcada: continua entregando', dl3.statusCode === 200 && dl3.rawPayload.length === 307200);
  ok('marcada: sem nova auditoria', (await audits('ENTRY_INTEGRITY_FAILED')).length === 1);
  const after = await row(good.id);
  ok(
    'marcada: guarda a primeira detecção e renova a última leitura',
    after.integrityFailedAt?.getTime() === flagged.integrityFailedAt?.getTime() &&
      after.integrityCheckedAt!.getTime() > before.getTime(),
  );

  // 3b. Em ZIP com senha (plano pos-revisao, item 2.1): a conferencia e dos bytes originais.
  const dlZip = await download(good.id, cDono, '?format=zip');
  const [zipEntry] = listZip(dlZip.rawPayload);
  ok(
    'ZIP: marcada continua avisando no cabeçalho e entrega os mesmos bytes',
    dlZip.statusCode === 200 &&
      dlZip.headers['x-deeplook-integrity'] === 'mismatch' &&
      Buffer.compare(
        extractZipEntry(dlZip.rawPayload, zipEntry, 'infected', 1024 * 1024),
        badBytes,
      ) === 0,
    dlZip.headers,
  );
  ok('ZIP: sem nova auditoria', (await audits('ENTRY_INTEGRITY_FAILED')).length === 1);

  // 4. O objeto volta ao que era: a marca sai e a auditoria registra.
  await put(good.storageKey!, original);
  const dl4 = await download(good.id);
  ok(
    'restaurado: ainda avisa no cabeçalho (a marca valia ao começar)',
    dl4.headers['x-deeplook-integrity'] === 'mismatch' &&
      Buffer.compare(dl4.rawPayload, original) === 0,
  );
  const cleared = await row(good.id);
  ok('restaurado: a marca sai', cleared.integrityFailedAt === null, cleared);
  ok(
    'restaurado: uma auditoria de volta ao normal',
    (await audits('ENTRY_INTEGRITY_RESTORED')).length === 1,
  );
  ok(
    'restaurado: o próximo download sai sem aviso',
    (await download(good.id)).headers['x-deeplook-integrity'] === undefined,
  );

  // 5. Truncado: o tamanho tambem conta, e o corpo continua bem formado.
  const cut = await upload(randomBytes(200 * 1024), 'truncado-integridade.bin');
  const half = Buffer.alloc(100 * 1024, 7);
  await put(cut.storageKey!, half);
  const dl5 = await download(cut.id);
  ok(
    'truncado: Content-Length é o do objeto e o corpo chega inteiro',
    dl5.statusCode === 200 &&
      dl5.headers['content-length'] === String(half.length) &&
      dl5.rawPayload.length === half.length,
    { status: dl5.statusCode, length: dl5.headers['content-length'], got: dl5.rawPayload.length },
  );
  ok('truncado: marcado', (await row(cut.id)).integrityFailedAt !== null);
  ok(
    'truncado: a auditoria cita os bytes lidos e o da ficha',
    (await audits('ENTRY_INTEGRITY_FAILED', 'truncado-integridade'))[0]?.detail?.includes(
      `${half.length} bytes lidos; a ficha diz ${cut.fileSize}`,
    ) === true,
  );

  // 6. Sem hash gravado: nao ha com o que comparar, e nada se marca.
  const bare = await upload(randomBytes(1024), 'sem-hash-integridade.bin');
  await prisma.entry.update({ where: { id: bare.id }, data: { sha256: null } });
  const dl6 = await download(bare.id);
  ok('sem hash: baixa normalmente', dl6.statusCode === 200 && dl6.rawPayload.length === 1024);
  const bareRow = await row(bare.id);
  ok(
    'sem hash: não confere nem marca',
    bareRow.integrityCheckedAt === null && bareRow.integrityFailedAt === null,
    bareRow,
  );

  // 7. Download abortado no meio nao tem veredito: parcial nao vira falso alarme.
  const big = await upload(randomBytes(1024 * 1024), 'grande-integridade.bin');
  const bigBad = flip(randomBytes(24 * 1024 * 1024));
  await put(big.storageKey!, bigBad); // diferente do gravado: se o fluxo fosse ate o fim, marcaria
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/entries/${big.id}/download`, {
    headers: { cookie: cDono },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  await reader.read(); // um pedaco so
  controller.abort();
  await reader.read().catch(() => null);
  await sleep(1200);
  const aborted = await row(big.id);
  ok(
    'abortado: nada marcado (sem veredito)',
    aborted.integrityFailedAt === null && aborted.integrityCheckedAt === null,
    aborted,
  );
  ok(
    'abortado: sem auditoria de divergência dele',
    (await audits('ENTRY_INTEGRITY_FAILED', 'grande-integridade')).length === 0,
  );

  // 8. O arquivo que nao esta no bucket continua com a sua resposta propria (404), sem marcar.
  const lost = await upload(randomBytes(512), 'perdido-integridade.bin');
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: lost.storageKey! }));
  const dl8 = await download(lost.id);
  ok('ausente: 404 com a explicação de sempre', dl8.statusCode === 404, dl8.body);
  ok(
    'ausente: o download não marca (quem trata disso é o scrub)',
    (await row(lost.id)).integrityFailedAt === null,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
