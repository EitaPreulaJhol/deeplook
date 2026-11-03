import { createHash, randomBytes } from 'node:crypto';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { scrubIntegrity } from '../../src/lib/integrity-scrub';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket, s3 } from '../../src/lib/s3';
import { systemStatus } from '../../src/lib/status';

// Item 4.2: o job de scrub le as amostras em segundo plano e confere o SHA-256 com o da ficha.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

async function main() {
  await ensureBucket(3, 500);
  const owner = await prisma.user.create({
    data: {
      email: 'dono@x.io',
      displayName: 'dono',
      role: 'USER',
      passwordHash: await hashPassword('senha-123!'),
    },
  });

  const put = (key: string, body: Buffer) =>
    s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body }));
  /** Amostra com o arquivo no bucket e a ficha com o SHA-256 dele, como o envio deixa. */
  const sample = async (title: string, content: Buffer, extra: Record<string, unknown> = {}) => {
    const storageKey = `samples/scrub-${title}-${Date.now()}`;
    await put(storageKey, content);
    const entry = await prisma.entry.create({
      data: {
        type: 'FILE',
        title,
        ownerId: owner.id,
        storageKey,
        bucket: env.S3_BUCKET,
        originalFilename: title,
        fileSize: content.length,
        sha256: sha(content),
        ...extra,
      },
    });
    return { entry, content };
  };
  const row = (id: string) => prisma.entry.findUniqueOrThrow({ where: { id } });
  const audits = (action: 'ENTRY_INTEGRITY_FAILED' | 'ENTRY_INTEGRITY_RESTORED') =>
    prisma.auditEvent.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const flip = (buf: Buffer) => {
    const bad = Buffer.from(buf);
    bad[0] ^= 0xff;
    return bad;
  };

  // Cenario: um bom, um com o conteudo trocado, um que sumiu, e tres que o scrub ignora.
  const good = await sample('bom', randomBytes(50 * 1024));
  const swapped = await sample('trocado', randomBytes(50 * 1024));
  await put(swapped.entry.storageKey!, flip(swapped.content));
  const gone = await sample('sumiu', randomBytes(50 * 1024));
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: gone.entry.storageKey! }));
  const purged = await sample('expurgado', randomBytes(1024), { filePurgedAt: new Date() });
  await put(purged.entry.storageKey!, randomBytes(1024)); // estragado, mas o arquivo foi expurgado
  const trashed = await sample('lixeira', randomBytes(1024), { deletedAt: new Date() });
  const noHash = await sample('sem-hash', randomBytes(1024), { sha256: null });
  const url = await prisma.entry.create({
    data: { type: 'URL', title: 'link', ownerId: owner.id, url: 'http://x.test/' },
  });

  // 1. Primeira rodada: so as tres candidatas sao lidas e julgadas.
  const r1 = await scrubIntegrity();
  ok(
    'rodada: lê as 3 candidatas e julga cada uma',
    r1.checked === 3 && r1.ok === 1 && r1.mismatch === 1 && r1.missing === 1 && r1.errors === 0,
    r1,
  );
  ok('rodada: conta os bytes lidos', r1.bytes === 3 * 50 * 1024, r1.bytes);

  const g = await row(good.entry.id);
  ok(
    'bom: conferido e sem marca',
    g.integrityCheckedAt !== null && g.integrityFailedAt === null,
    g,
  );
  const s = await row(swapped.entry.id);
  ok('trocado: marcado', s.integrityFailedAt !== null && s.integrityCheckedAt !== null, s);
  const m = await row(gone.entry.id);
  ok('ausente: marcado', m.integrityFailedAt !== null, m);

  const failed = await audits('ENTRY_INTEGRITY_FAILED');
  ok('duas auditorias de divergência', failed.length === 2, failed.length);
  const aSwapped = failed.find((f) => f.targetLabel === 'trocado');
  const aGone = failed.find((f) => f.targetLabel === 'sumiu');
  ok(
    'auditoria do trocado: o sistema, o dono, os dois hashes e "verificação periódica"',
    aSwapped?.actorId === null &&
      aSwapped?.targetUserId === owner.id &&
      aSwapped?.detail?.includes(`esperado ${swapped.entry.sha256}`) === true &&
      aSwapped?.detail?.includes('na verificação periódica') === true,
    aSwapped,
  );
  ok(
    'auditoria do ausente: diz que o objeto não está no armazenamento',
    aGone?.detail?.includes('o objeto não está no armazenamento') === true,
    aGone,
  );

  for (const [label, id] of [
    ['expurgado', purged.entry.id],
    ['na lixeira', trashed.entry.id],
    ['sem hash', noHash.entry.id],
    ['de link', url.id],
  ] as const) {
    const untouched = await prisma.entry.findFirstOrThrow({
      where: { id, deletedAt: label === 'na lixeira' ? { not: null } : null },
    });
    ok(
      `${label}: o scrub não toca`,
      untouched.integrityCheckedAt === null && untouched.integrityFailedAt === null,
      untouched,
    );
  }

  // 2. Segunda rodada: o estragado continua estragado e NAO enche a trilha.
  const r2 = await scrubIntegrity();
  ok(
    'segunda rodada: lê as mesmas 3',
    r2.checked === 3 && r2.mismatch === 1 && r2.missing === 1,
    r2,
  );
  ok(
    'segunda rodada: sem auditoria nova',
    (await audits('ENTRY_INTEGRITY_FAILED')).length === 2 &&
      (await audits('ENTRY_INTEGRITY_RESTORED')).length === 0,
  );
  const s2 = await row(swapped.entry.id);
  ok(
    'segunda rodada: mantém a primeira detecção e renova a leitura',
    s2.integrityFailedAt?.getTime() === s.integrityFailedAt?.getTime() &&
      s2.integrityCheckedAt!.getTime() >= s.integrityCheckedAt!.getTime(),
  );

  // 3. A integridade aparece no status do sistema (e, por ele, no do monitor).
  const status = await systemStatus();
  const check = status.checks.find((c) => c.id === 'integrity');
  ok(
    'status: laranja com 2 amostras divergentes',
    check?.level === 'warn' && check.summary.startsWith('2 amostras'),
    check,
  );
  ok(
    'status: detalha divergentes, guardados e conferidos',
    check?.details.some((d) => d.label === 'Com divergência' && d.value === '2') === true &&
      check?.details.some((d) => d.label === 'Arquivos guardados' && d.value === '3') === true &&
      check?.details.some((d) => d.label === 'Ainda não conferidos' && d.value === '0') === true,
    check?.details,
  );

  // 4. O objeto volta ao normal: a marca sai e a auditoria registra uma vez.
  await put(swapped.entry.storageKey!, swapped.content);
  const r3 = await scrubIntegrity();
  ok(
    'recuperação: o restaurado e o bom conferem; o ausente continua ausente',
    r3.checked === 3 && r3.ok === 2 && r3.mismatch === 0 && r3.missing === 1,
    r3,
  );
  ok('recuperação: a marca sai', (await row(swapped.entry.id)).integrityFailedAt === null);
  const restored = await audits('ENTRY_INTEGRITY_RESTORED');
  ok(
    'recuperação: uma auditoria de volta ao normal',
    restored.length === 1 && restored[0]?.targetLabel === 'trocado',
    restored,
  );
  const status2 = await systemStatus();
  ok(
    'status: 1 amostra divergente (a que ainda está ausente)',
    status2.checks.find((c) => c.id === 'integrity')?.summary.startsWith('1 amostra com') === true,
    status2.checks.find((c) => c.id === 'integrity'),
  );

  // 5. Orcamento: nunca conferidas primeiro, e uma so quando o orcamento e menor que o arquivo.
  const fresh = [] as { id: string }[];
  for (const name of ['novo-a', 'novo-b', 'novo-c']) {
    fresh.push((await sample(name, randomBytes(100 * 1024))).entry);
  }
  const small = await scrubIntegrity(150 * 1024);
  ok(
    'orçamento de 150 KB: lê um de 100 KB e para (o próximo estouraria)',
    small.checked === 1 && small.bytes === 100 * 1024,
    small,
  );
  const touched = await prisma.entry.count({
    where: { id: { in: fresh.map((f) => f.id) }, integrityCheckedAt: { not: null } },
  });
  ok('orçamento: o escolhido é um dos nunca conferidos', touched === 1, touched);
  const tiny = await scrubIntegrity(1);
  ok(
    'orçamento menor que o arquivo: ainda confere um (ninguém fica sem vez)',
    tiny.checked === 1,
    tiny,
  );
  const touched2 = await prisma.entry.count({
    where: { id: { in: fresh.map((f) => f.id) }, integrityCheckedAt: { not: null } },
  });
  ok('orçamento: a rodada seguinte pega outro nunca conferido', touched2 === 2, touched2);

  // 6. Armazenamento fora do ar: nada e marcado e a rodada desiste depressa.
  const before = await prisma.entry.findMany({
    select: { id: true, integrityCheckedAt: true, integrityFailedAt: true },
    orderBy: { id: 'asc' },
  });
  const original = s3.config.endpoint;
  // @ts-expect-error: troca o endpoint em tempo de execucao so para este teste.
  s3.config.endpoint = async () => ({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: 1,
    path: '/',
  });
  const down = await scrubIntegrity();
  // @ts-expect-error: devolve o endpoint original.
  s3.config.endpoint = original;
  ok('MinIO fora: nada julgado, 3 falhas e desiste', down.checked === 0 && down.errors === 3, down);
  const afterDown = await prisma.entry.findMany({
    select: { id: true, integrityCheckedAt: true, integrityFailedAt: true },
    orderBy: { id: 'asc' },
  });
  ok(
    'MinIO fora: ninguém é marcado nem tem a leitura alterada',
    JSON.stringify(afterDown) === JSON.stringify(before),
  );

  // 7. Duas rodadas ao mesmo tempo: a segunda sai sem fazer nada (uma de cada vez).
  const [a, b] = await Promise.all([scrubIntegrity(), scrubIntegrity()]);
  ok('concorrência: só uma das duas rodadas trabalha', a.checked > 0 !== b.checked > 0, { a, b });

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
