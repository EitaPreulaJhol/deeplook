import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { reportRoutes } from '../../src/routes/reports';

// Fluxo de revisao com pedidos ao mesmo tempo: editar x enviar, aprovar x devolver.
let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const PASSWORD = 'Senha-Forte-123!';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, reportRoutes]) await app.register(r);
  await app.ready();

  const passwordHash = await hashPassword(PASSWORD);
  const mkAnalyst = (email: string) =>
    prisma.user.create({ data: { email, displayName: email, role: 'ANALYST', passwordHash } });
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: PASSWORD },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const author = await mkAnalyst('autor@x.io');
  await mkAnalyst('revisor@x.io');
  const cAuthor = await login('autor@x.io');
  const cReviewer = await login('revisor@x.io');

  const mkReport = async (status: 'DRAFT' | 'IN_REVIEW') => {
    const entry = await prisma.entry.create({
      data: { ownerId: author.id, type: 'URL', title: 'amostra' },
    });
    return prisma.report.create({
      data: {
        entryId: entry.id,
        analystId: author.id,
        summary: 'S0 original',
        verdict: 'SUSPICIOUS',
        status,
        ...(status === 'IN_REVIEW' && { submittedAt: new Date() }),
      },
    });
  };

  // 1. Edicao que leu "rascunho" antes do envio terminar: recusada, sem mudar o conteudo.
  //    Uma transacao segura o relatorio e o envia; a edicao chega no meio.
  const r1 = await mkReport('DRAFT');
  let patch: Promise<Awaited<ReturnType<typeof app.inject>>> | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Report" WHERE "id" = ${r1.id} FOR UPDATE`;
    await tx.report.update({ where: { id: r1.id }, data: { status: 'IN_REVIEW' } });
    patch = app.inject({
      method: 'PATCH',
      url: `/api/reports/${r1.id}`,
      headers: { cookie: cAuthor },
      payload: { summary: 'S1 depois do envio', verdict: 'MALICIOUS' },
    });
    await sleep(300);
  });
  const patched = await patch!;
  const after = await prisma.report.findUniqueOrThrow({ where: { id: r1.id } });
  ok('edição no meio do envio: 409', patched.statusCode === 409, patched.json());
  ok(
    'conteúdo enviado não muda',
    after.summary === 'S0 original' && after.verdict === 'SUSPICIOUS',
    after,
  );

  // 2. Editar e enviar juntos, varias vezes: o que esta em revisao e sempre o que ficou
  //    gravado antes do envio (sem versao nova depois dele).
  let raceBad = 0;
  for (let i = 0; i < 10; i++) {
    const r = await mkReport('DRAFT');
    const [p, s] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/reports/${r.id}`,
        headers: { cookie: cAuthor },
        payload: { summary: `S${i} editado` },
      }),
      app.inject({
        method: 'POST',
        url: `/api/reports/${r.id}/submit`,
        headers: { cookie: cAuthor },
      }),
    ]);
    const events = await prisma.entryEvent.findMany({
      where: { entryId: r.entryId, type: 'REPORT_SUBMITTED' },
    });
    const revisions = await prisma.reportRevision.findMany({ where: { reportId: r.id } });
    const final = await prisma.report.findUniqueOrThrow({ where: { id: r.id } });
    // Edicao aceita depois do envio deixaria uma versao com status IN_REVIEW.
    const editedInReview = revisions.some((v) => v.status === 'IN_REVIEW');
    if (
      s.statusCode !== 200 ||
      ![200, 409].includes(p.statusCode) ||
      events.length !== 1 ||
      final.status !== 'IN_REVIEW' ||
      editedInReview
    ) {
      raceBad++;
    }
  }
  ok('editar e enviar juntos: nunca muda o que está em revisão', raceBad === 0, raceBad);

  // 3. Aprovar e devolver juntos: uma decisao so, e amostra coerente com ela.
  let decisionBad = 0;
  const outcomes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await mkReport('IN_REVIEW');
    const [a, d] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/reports/${r.id}/approve`,
        headers: { cookie: cReviewer },
      }),
      app.inject({
        method: 'POST',
        url: `/api/reports/${r.id}/return`,
        headers: { cookie: cReviewer },
        payload: { note: 'devolvido na corrida' },
      }),
    ]);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: r.id } });
    const entry = await prisma.entry.findUniqueOrThrow({ where: { id: r.entryId } });
    const codes = [a.statusCode, d.statusCode].sort().join('/');
    outcomes.push(`${a.statusCode}/${d.statusCode} ${report.status} ${entry.status}`);
    const approved = a.statusCode === 200;
    const coherent = approved
      ? report.status === 'PUBLISHED' && !report.reviewNote && entry.status === 'COMPLETED'
      : report.status === 'DRAFT' && Boolean(report.reviewNote) && entry.status !== 'COMPLETED';
    if (codes !== '200/409' || !coherent) decisionBad++;
  }
  ok('aprovar e devolver juntos: uma decisão, estado coerente', decisionBad === 0, outcomes);

  // 4. Sequencial continua igual.
  const r4 = await mkReport('DRAFT');
  const sent = await app.inject({
    method: 'POST',
    url: `/api/reports/${r4.id}/submit`,
    headers: { cookie: cAuthor },
  });
  const again = await app.inject({
    method: 'PATCH',
    url: `/api/reports/${r4.id}`,
    headers: { cookie: cAuthor },
    payload: { summary: 'depois' },
  });
  const twice = await app.inject({
    method: 'POST',
    url: `/api/reports/${r4.id}/submit`,
    headers: { cookie: cAuthor },
  });
  ok(
    'enviar, editar e reenviar em sequência: 200, 409, 409',
    sent.statusCode === 200 && again.statusCode === 409 && twice.statusCode === 409,
    [sent.statusCode, again.statusCode, twice.statusCode],
  );
  const draftEdit = await app.inject({
    method: 'PATCH',
    url: `/api/reports/${(await mkReport('DRAFT')).id}`,
    headers: { cookie: cAuthor },
    payload: { summary: 'rascunho editado' },
  });
  ok('rascunho continua editável', draftEdit.statusCode === 200, draftEdit.json());

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
