import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { EntryStatus, Verdict } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { findTechnique } from '../lib/attack';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { slaConfig, slaWhere } from '../lib/sla';
import { sendValidationError } from '../lib/validation';

const Query = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90].includes(d), 'use 7, 30 ou 90')
    .default(7),
  /** Fuso do navegador (dias do grafico); invalido cai em UTC. */
  tz: z
    .string()
    .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/)
    .optional(),
});

/** Inicio do primeiro dia do periodo no fuso pedido (instante absoluto). */
async function periodStart(days: number, tz: string): Promise<Date> {
  const rows = await prisma.$queryRaw<{ since: Date }[]>`
    SELECT ((date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${days - 1}::int))
      AT TIME ZONE ${tz}) AS since`;
  return rows[0].since;
}

/** Contagem diaria (dia no fuso pedido) de um campo de data, a partir de `since`. */
async function daily(
  column: 'createdAt' | 'statusChangedAt',
  since: Date,
  tz: string,
  ownerId: string | null,
  completedOnly: boolean,
): Promise<Map<string, number>> {
  // `column` e um dos dois nomes fixos acima (nunca vem do usuario); os valores
  // vao como parametros ($1...).
  const col = column;
  const rows = await prisma.$queryRawUnsafe<{ day: string; n: bigint }[]>(
    `SELECT to_char(date_trunc('day', ("${col}" AT TIME ZONE 'UTC') AT TIME ZONE $1), 'YYYY-MM-DD') AS day,
            count(*) AS n
       FROM "Entry"
      WHERE "${col}" >= $2
        AND "deletedAt" IS NULL
        ${ownerId ? 'AND "ownerId" = $3' : ''}
        ${completedOnly ? `AND "status" = 'COMPLETED' AND "duplicateOfId" IS NULL` : ''}
      GROUP BY 1`,
    tz,
    since,
    ...(ownerId ? [ownerId] : []),
  );
  return new Map(rows.map((r) => [r.day, Number(r.n)]));
}
/**
 * Tecnicas ATT&CK mais vistas (item 59): relatorios publicados (ou editados)
 * no periodo, contando cada amostra uma vez por tecnica.
 */
async function topTechniques(since: Date, ownerId: string | null) {
  const rows = await prisma.$queryRaw<{ id: string; n: bigint }[]>`
    SELECT t AS id, count(DISTINCT r."entryId") AS n
      FROM "Report" r
      JOIN "Entry" e ON e."id" = r."entryId"
      CROSS JOIN LATERAL unnest(r."attackTechniques") AS t
     WHERE r."status" = 'PUBLISHED'
       AND r."updatedAt" >= ${since}
       AND e."deletedAt" IS NULL
       ${ownerId ? Prisma.sql`AND e."ownerId" = ${ownerId}` : Prisma.empty}
     GROUP BY t
     ORDER BY n DESC, t
     LIMIT 10`;
  return rows.map((r) => {
    const technique = findTechnique(r.id);
    return {
      id: r.id,
      name: technique?.name ?? r.id,
      tactics: technique?.tactics ?? [],
      count: Number(r.n),
    };
  });
}

/** Dias (YYYY-MM-DD no fuso) do periodo, do mais antigo ao de hoje. */
async function dayList(days: number, tz: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ day: string }[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS day
      FROM generate_series(
        date_trunc('day', now() AT TIME ZONE ${tz}) - make_interval(days => ${days - 1}::int),
        date_trunc('day', now() AT TIME ZONE ${tz}),
        interval '1 day') AS d`;
  return rows.map((r) => r.day);
}

/**
 * Painel (Dashboards do HPSM): amostras por status e veredito, prazo, entrada e
 * conclusao no periodo (por dia) e, para analistas, a carga por responsavel.
 * Analistas veem tudo; usuarios comuns, so as proprias amostras. "Concluidas"
 * no periodo nao contam duplicatas (nao houve analise).
 */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parametros invalidos.');
    const { days } = parsed.data;
    const all = isAnalyst(user);
    const scope: Prisma.EntryWhereInput = all ? {} : { ownerId: user.id };
    const ownerId = all ? null : user.id;

    // Fuso invalido para o Postgres: cai em UTC sem derrubar o painel.
    let tz = parsed.data.tz ?? 'UTC';
    let since: Date;
    try {
      since = await periodStart(days, tz);
    } catch {
      tz = 'UTC';
      since = await periodStart(days, tz);
    }

    const open = { ...scope, status: { not: 'COMPLETED' as EntryStatus } };
    const completedInPeriod: Prisma.EntryWhereInput = {
      ...scope,
      status: 'COMPLETED',
      duplicateOfId: null,
      statusChangedAt: { gte: since },
    };
    const [
      byStatusRows,
      byVerdictRows,
      warn,
      late,
      submitted,
      completed,
      days_,
      subDaily,
      doneDaily,
      techniques,
    ] = await Promise.all([
      prisma.entry.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      prisma.entry.groupBy({ by: ['verdict'], where: scope, _count: { _all: true } }),
      prisma.entry.count({ where: { AND: [open, slaWhere('warn')] } }),
      prisma.entry.count({ where: { AND: [open, slaWhere('late')] } }),
      prisma.entry.count({ where: { ...scope, createdAt: { gte: since } } }),
      prisma.entry.count({ where: completedInPeriod }),
      dayList(days, tz),
      daily('createdAt', since, tz, ownerId, false),
      daily('statusChangedAt', since, tz, ownerId, true),
      topTechniques(since, ownerId),
    ]);

    const byStatus: Record<EntryStatus, number> = { PENDING: 0, IN_REVIEW: 0, COMPLETED: 0 };
    for (const r of byStatusRows) byStatus[r.status] = r._count._all;
    const byVerdict: Record<Verdict, number> = {
      UNKNOWN: 0,
      CLEAN: 0,
      SUSPICIOUS: 0,
      MALICIOUS: 0,
    };
    for (const r of byVerdictRows) byVerdict[r.verdict] = r._count._all;

    let workload: {
      id: string | null;
      name: string;
      pending: number;
      inReview: number;
      late: number;
      completed: number;
    }[] = [];
    if (all) {
      const [openRows, lateRows, doneRows, analysts] = await Promise.all([
        prisma.entry.groupBy({ by: ['assigneeId', 'status'], where: open, _count: { _all: true } }),
        prisma.entry.groupBy({
          by: ['assigneeId'],
          where: { AND: [open, slaWhere('late')] },
          _count: { _all: true },
        }),
        prisma.entry.groupBy({
          by: ['assigneeId'],
          where: completedInPeriod,
          _count: { _all: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ['ANALYST', 'ADMIN'] }, status: 'ACTIVE' },
          select: { id: true, displayName: true },
        }),
      ]);
      const rows = new Map<string | null, (typeof workload)[number]>();
      const row = (id: string | null) => {
        if (!rows.has(id)) {
          const name = id
            ? (analysts.find((a) => a.id === id)?.displayName ?? '(inativo)')
            : 'Sem responsável';
          rows.set(id, { id, name, pending: 0, inReview: 0, late: 0, completed: 0 });
        }
        return rows.get(id)!;
      };
      for (const a of analysts) row(a.id);
      row(null);
      for (const r of openRows) {
        if (r.status === 'PENDING') row(r.assigneeId).pending = r._count._all;
        if (r.status === 'IN_REVIEW') row(r.assigneeId).inReview = r._count._all;
      }
      for (const r of lateRows) row(r.assigneeId).late = r._count._all;
      for (const r of doneRows) if (r.assigneeId) row(r.assigneeId).completed = r._count._all;
      // Analistas por carga (abertas), "Sem responsavel" por ultimo.
      workload = [...rows.values()].sort(
        (a, b) =>
          Number(a.id === null) - Number(b.id === null) ||
          b.pending + b.inReview - (a.pending + a.inReview) ||
          a.name.localeCompare(b.name),
      );
    }

    return reply.send({
      scope: all ? 'all' : 'mine',
      days,
      tz,
      since,
      sla: slaConfig(),
      byStatus,
      byVerdict,
      open: { warn, late },
      period: { submitted, completed },
      daily: days_.map((day) => ({
        day,
        submitted: subDaily.get(day) ?? 0,
        completed: doneDaily.get(day) ?? 0,
      })),
      workload,
      techniques,
    });
  });
}
