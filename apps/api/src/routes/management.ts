import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Priority, Verdict } from '../generated/prisma/client';
import { findTechnique } from '../lib/attack';
import { isAnalyst, requireUser } from '../lib/auth';
import { csvSeparator, toCsv } from '../lib/csv';
import { csvText } from '../lib/csv-en';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import { PRIORITIES } from '../lib/sla';
import { sendValidationError } from '../lib/validation';

/** Periodo maximo (dias) de um relatorio gerencial. */
export const MANAGEMENT_MAX_DAYS = 366;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Query = z
  .object({
    from: z.string().regex(DATE, 'use AAAA-MM-DD'),
    to: z.string().regex(DATE, 'use AAAA-MM-DD'),
    /** Fuso do navegador (inicio e fim dos dias); invalido cai em UTC. */
    tz: z
      .string()
      .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/)
      .optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine((q) => q.from <= q.to, { message: 'o início vem antes do fim', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MANAGEMENT_MAX_DAYS, {
    message: `no máximo ${MANAGEMENT_MAX_DAYS} dias`,
    path: ['to'],
  });

/** Inicio do dia `from` e do dia seguinte a `to`, no fuso (instantes absolutos). */
async function bounds(from: string, to: string, tz: string) {
  const rows = await prisma.$queryRaw<{ since: Date; until: Date }[]>`
    SELECT (${from}::date::timestamp AT TIME ZONE ${tz}) AS since,
           ((${to}::date + 1)::timestamp AT TIME ZONE ${tz}) AS until`;
  return rows[0];
}

type Duration = { n: number; avgHours: number | null; medianHours: number | null };
const hours = (v: unknown) =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

/**
 * Relatorio gerencial (item 77): resumo de um periodo para analistas e admins.
 * "Concluidas" sao as que chegaram a Concluido no periodo (sem duplicatas, que
 * nao tiveram analise); o tempo ate concluir vai do envio a conclusao.
 */
export async function managementRoutes(app: FastifyInstance) {
  app.get('/api/management', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Período inválido.');
    const { from, to, format } = parsed.data;

    let tz = parsed.data.tz ?? 'UTC';
    let range: { since: Date; until: Date };
    try {
      range = await bounds(from, to, tz);
    } catch {
      tz = 'UTC';
      range = await bounds(from, to, tz);
    }
    const { since, until } = range;
    const inPeriod = { gte: since, lt: until };
    const completed = {
      status: 'COMPLETED' as const,
      duplicateOfId: null,
      statusChangedAt: inPeriod,
    };

    const [
      receivedByType,
      completedCount,
      verdictRows,
      durationRows,
      techniqueRows,
      casesOpened,
      casesClosed,
      casesOpenNow,
      analystRows,
      reportRows,
      reviewRows,
      people,
    ] = await Promise.all([
      prisma.entry.groupBy({
        by: ['type'],
        where: { createdAt: inPeriod },
        _count: { _all: true },
      }),
      prisma.entry.count({ where: completed }),
      prisma.entry.groupBy({ by: ['verdict'], where: completed, _count: { _all: true } }),
      // Tempo ate concluir por prioridade; ROLLUP traz o total (priority null).
      prisma.$queryRaw<{ priority: Priority | null; n: bigint; avg_h: number; median_h: number }[]>`
        SELECT "priority" AS priority, count(*) AS n,
               avg(extract(epoch FROM "statusChangedAt" - "createdAt")) / 3600 AS avg_h,
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM "statusChangedAt" - "createdAt")) / 3600 AS median_h
          FROM "Entry"
         WHERE "status" = 'COMPLETED' AND "duplicateOfId" IS NULL AND "deletedAt" IS NULL
           AND "statusChangedAt" >= ${since} AND "statusChangedAt" < ${until}
         GROUP BY ROLLUP ("priority")`,
      // Tecnicas dos relatorios publicados escritos no periodo (amostra conta uma vez).
      prisma.$queryRaw<{ id: string; n: bigint }[]>`
        SELECT t AS id, count(DISTINCT r."entryId") AS n
          FROM "Report" r
          JOIN "Entry" e ON e."id" = r."entryId"
          CROSS JOIN LATERAL unnest(r."attackTechniques") AS t
         WHERE r."status" = 'PUBLISHED' AND e."deletedAt" IS NULL
           AND r."createdAt" >= ${since} AND r."createdAt" < ${until}
         GROUP BY t
         ORDER BY n DESC, t
         LIMIT 10`,
      prisma.case.count({ where: { createdAt: inPeriod } }),
      prisma.case.count({ where: { closedAt: inPeriod } }),
      prisma.case.count({ where: { status: { not: 'CLOSED' } } }),
      // Concluidas e tempo medio por responsavel.
      prisma.$queryRaw<{ id: string; n: bigint; avg_h: number }[]>`
        SELECT "assigneeId" AS id, count(*) AS n,
               avg(extract(epoch FROM "statusChangedAt" - "createdAt")) / 3600 AS avg_h
          FROM "Entry"
         WHERE "status" = 'COMPLETED' AND "duplicateOfId" IS NULL AND "deletedAt" IS NULL
           AND "assigneeId" IS NOT NULL
           AND "statusChangedAt" >= ${since} AND "statusChangedAt" < ${until}
         GROUP BY "assigneeId"`,
      // Relatorios escritos no periodo e ja publicados, por autor.
      prisma.report.groupBy({
        by: ['analystId'],
        where: { status: 'PUBLISHED', createdAt: inPeriod, entry: { deletedAt: null } },
        _count: { _all: true },
      }),
      // Revisoes feitas no periodo (aprovar ou devolver), por revisor.
      prisma.report.groupBy({
        by: ['reviewedById'],
        where: { reviewedAt: inPeriod, reviewedById: { not: null } },
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { role: { in: ['ANALYST', 'ADMIN'] } },
        select: { id: true, displayName: true, status: true },
      }),
    ]);

    const received = { total: 0, files: 0, urls: 0 };
    for (const r of receivedByType) {
      received.total += r._count._all;
      if (r.type === 'FILE') received.files = r._count._all;
      else received.urls = r._count._all;
    }
    const verdicts: Record<Verdict, number> = { UNKNOWN: 0, CLEAN: 0, SUSPICIOUS: 0, MALICIOUS: 0 };
    for (const r of verdictRows) verdicts[r.verdict] = r._count._all;

    const duration = (row?: { n: bigint; avg_h: number; median_h: number }): Duration => ({
      n: row ? Number(row.n) : 0,
      avgHours: row ? hours(row.avg_h) : null,
      medianHours: row ? hours(row.median_h) : null,
    });
    const timeToComplete = {
      all: duration(durationRows.find((r) => r.priority === null)),
      byPriority: Object.fromEntries(
        PRIORITIES.map((p) => [p, duration(durationRows.find((r) => r.priority === p))]),
      ) as Record<Priority, Duration>,
    };

    const techniques = techniqueRows.map((r) => ({
      id: r.id,
      name: findTechnique(r.id)?.name ?? r.id,
      count: Number(r.n),
    }));

    // Carga por analista: ativos sempre; inativos so com atividade no periodo.
    const byId = new Map(people.map((p) => [p.id, p]));
    const analysts = new Map<
      string,
      {
        id: string;
        name: string;
        completed: number;
        avgHours: number | null;
        reports: number;
        reviews: number;
      }
    >();
    const row = (id: string) => {
      if (!analysts.has(id)) {
        const person = byId.get(id);
        analysts.set(id, {
          id,
          name: person
            ? person.displayName + (person.status === 'ACTIVE' ? '' : ' (inativo)')
            : '(removido)',
          completed: 0,
          avgHours: null,
          reports: 0,
          reviews: 0,
        });
      }
      return analysts.get(id)!;
    };
    for (const p of people) if (p.status === 'ACTIVE') row(p.id);
    for (const r of analystRows) {
      const a = row(r.id);
      a.completed = Number(r.n);
      a.avgHours = hours(r.avg_h);
    }
    for (const r of reportRows) row(r.analystId).reports = r._count._all;
    for (const r of reviewRows) if (r.reviewedById) row(r.reviewedById).reviews = r._count._all;
    const workload = [...analysts.values()].sort(
      (a, b) => b.completed - a.completed || b.reports - a.reports || a.name.localeCompare(b.name),
    );

    const result = {
      period: { from, to, tz, since, until },
      received,
      completed: completedCount,
      timeToComplete,
      verdicts,
      techniques,
      cases: { opened: casesOpened, closed: casesClosed, openNow: casesOpenNow },
      workload,
    };
    if (format === 'json') return reply.send(result);

    // CSV: uma linha por indicador, agrupadas por secao, no idioma da interface (?lang=).
    const lang = requestLang(req);
    const tr = csvText(lang);
    const VERDICT: Record<Verdict, string> = {
      MALICIOUS: 'Malicioso',
      SUSPICIOUS: 'Suspeito',
      CLEAN: 'Limpo',
      UNKNOWN: 'Desconhecido',
    };
    const PRIORITY: Record<Priority, string> = {
      P1: 'P1 Crítica',
      P2: 'P2 Alta',
      P3: 'P3 Média',
      P4: 'P4 Baixa',
    };
    const rows: unknown[][] = [
      ['Período', `${from} a ${to} (${tz})`, '', '', '', '', ''],
      ['Amostras', 'Recebidas', received.total, '', '', '', ''],
      ['Amostras', 'Recebidas (arquivos)', received.files, '', '', '', ''],
      ['Amostras', 'Recebidas (links)', received.urls, '', '', '', ''],
      ['Amostras', 'Concluídas', completedCount, '', '', '', ''],
      [
        'Tempo até concluir',
        'Todas',
        timeToComplete.all.n,
        timeToComplete.all.avgHours,
        timeToComplete.all.medianHours,
        '',
        '',
      ],
      ...PRIORITIES.map((p) => {
        const d = timeToComplete.byPriority[p];
        return ['Tempo até concluir', PRIORITY[p], d.n, d.avgHours, d.medianHours, '', ''];
      }),
      ...(Object.keys(VERDICT) as Verdict[]).map((v) => [
        'Vereditos',
        VERDICT[v],
        verdicts[v],
        '',
        '',
        '',
        '',
      ]),
      ...techniques.map((t) => ['Técnicas ATT&CK', `${t.id} ${t.name}`, t.count, '', '', '', '']),
      ['Casos', 'Abertos no período', casesOpened, '', '', '', ''],
      ['Casos', 'Encerrados no período', casesClosed, '', '', '', ''],
      ['Casos', 'Em aberto agora', casesOpenNow, '', '', '', ''],
      ...workload.map((a) => [
        'Analistas',
        a.name,
        a.completed,
        a.avgHours,
        '',
        a.reports,
        a.reviews,
      ]),
    ];
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="deeplook-gerencial-${from}-a-${to}.csv"`,
      )
      .send(
        toCsv(
          [
            'Seção',
            'Item',
            'Quantidade',
            'Tempo médio (h)',
            'Mediana (h)',
            'Relatórios',
            'Revisões',
          ].map(tr),
          // Secao e item no idioma de quem baixa (plano pos-revisao, item 1.4).
          rows.map((row) =>
            row.map((cell, i) => (i < 2 && typeof cell === 'string' ? tr(cell) : cell)),
          ),
          csvSeparator(lang),
        ),
      );
  });
}
