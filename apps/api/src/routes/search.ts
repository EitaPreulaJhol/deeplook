import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const GROUPS = ['entries', 'reports', 'comments', 'kb', 'cases'] as const;
type Group = (typeof GROUPS)[number];

const Query = z.object({
  q: z.string().trim().min(2).max(200),
  type: z.enum(['all', ...GROUPS]).default('all'),
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

/** Marcadores do trecho encontrado (o front destaca sem HTML). */
export const MARK_START = '⟦';
export const MARK_END = '⟧';
const HEADLINE = Prisma.raw(
  `'StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "'`,
);

/** Texto pesquisavel: com e sem acentos (busca "relatorio" acha "relatório"). */
function doc(text: Prisma.Sql) {
  return Prisma.sql`to_tsvector('portuguese', unaccent(${text}))`;
}

/**
 * Busca avancada (item 68): busca textual do Postgres (portugues, sem acento) em
 * amostras, relatorios, comentarios, base de conhecimento e casos, com o trecho
 * encontrado. Usuario comum ve so relatorios publicados e nao ve casos.
 */
export async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Busca inválida.');
    const { q, type, days } = parsed.data;
    const analyst = isAnalyst(user);
    const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
    const limit = type === 'all' ? 10 : 50;
    // Consulta com e sem acento; o trecho destaca a forma digitada.
    const tsq = Prisma.sql`websearch_to_tsquery('portuguese', unaccent(${q}))`;
    const hlq = Prisma.sql`(websearch_to_tsquery('portuguese', ${q}) || ${tsq})`;
    const wants = (g: Group) => type === 'all' || type === g;

    const run = async <T>(sql: Prisma.Sql) => prisma.$queryRaw<T[]>(sql);
    const count = async (sql: Prisma.Sql) =>
      Number((await prisma.$queryRaw<{ n: bigint }[]>(sql))[0]?.n ?? 0);

    const entryText = Prisma.sql`coalesce(e."title", '') || ' ' || coalesce(e."description", '') || ' ' || coalesce(e."originalFilename", '') || ' ' || coalesce(e."url", '')`;
    const reportText = Prisma.sql`coalesce(r."summary", '') || ' ' || coalesce(r."findings", '') || ' ' || coalesce(r."iocs", '')`;
    const kbText = Prisma.sql`coalesce(k."title", '') || ' ' || coalesce(k."summary", '') || ' ' || coalesce(k."body", '') || ' ' || array_to_string(k."tags", ' ')`;
    const caseText = Prisma.sql`coalesce(c."title", '') || ' ' || coalesce(c."description", '')`;
    const reportVisible = analyst ? Prisma.empty : Prisma.sql`AND r."status" = 'PUBLISHED'`;

    const result: Partial<Record<Group, { total: number; items: unknown[] }>> = {};
    const tasks: Promise<void>[] = [];

    if (wants('entries')) {
      const where = Prisma.sql`e."deletedAt" IS NULL AND e."createdAt" >= ${since} AND ${doc(entryText)} @@ ${tsq}`;
      tasks.push(
        (async () => {
          const [items, total] = await Promise.all([
            run(Prisma.sql`
              SELECT e."id", e."title", e."type", e."status", e."verdict", e."createdAt",
                     ts_headline('portuguese', ${entryText}, ${hlq}, ${HEADLINE}) AS snippet
                FROM "Entry" e WHERE ${where}
               ORDER BY ts_rank(${doc(entryText)}, ${tsq}) DESC, e."createdAt" DESC
               LIMIT ${limit}`),
            count(Prisma.sql`SELECT count(*) AS n FROM "Entry" e WHERE ${where}`),
          ]);
          result.entries = { total, items };
        })(),
      );
    }

    if (wants('reports')) {
      const where = Prisma.sql`e."deletedAt" IS NULL ${reportVisible} AND r."updatedAt" >= ${since} AND ${doc(reportText)} @@ ${tsq}`;
      tasks.push(
        (async () => {
          const [items, total] = await Promise.all([
            run(Prisma.sql`
              SELECT r."id", r."status", r."verdict", r."updatedAt",
                     e."id" AS "entryId", e."title" AS "entryTitle", u."displayName" AS "analyst",
                     ts_headline('portuguese', ${reportText}, ${hlq}, ${HEADLINE}) AS snippet
                FROM "Report" r
                JOIN "Entry" e ON e."id" = r."entryId"
                JOIN "User" u ON u."id" = r."analystId"
               WHERE ${where}
               ORDER BY ts_rank(${doc(reportText)}, ${tsq}) DESC, r."updatedAt" DESC
               LIMIT ${limit}`),
            count(
              Prisma.sql`SELECT count(*) AS n FROM "Report" r JOIN "Entry" e ON e."id" = r."entryId" WHERE ${where}`,
            ),
          ]);
          result.reports = { total, items };
        })(),
      );
    }

    if (wants('comments')) {
      const text = Prisma.sql`coalesce(v."detail", '')`;
      const where = Prisma.sql`v."type" = 'COMMENT' AND e."deletedAt" IS NULL AND v."createdAt" >= ${since} AND ${doc(text)} @@ ${tsq}`;
      tasks.push(
        (async () => {
          const [items, total] = await Promise.all([
            run(Prisma.sql`
              SELECT v."id", v."createdAt", e."id" AS "entryId", e."title" AS "entryTitle",
                     u."displayName" AS "author",
                     ts_headline('portuguese', ${text}, ${hlq}, ${HEADLINE}) AS snippet
                FROM "EntryEvent" v
                JOIN "Entry" e ON e."id" = v."entryId"
                LEFT JOIN "User" u ON u."id" = v."actorId"
               WHERE ${where}
               ORDER BY ts_rank(${doc(text)}, ${tsq}) DESC, v."createdAt" DESC
               LIMIT ${limit}`),
            count(
              Prisma.sql`SELECT count(*) AS n FROM "EntryEvent" v JOIN "Entry" e ON e."id" = v."entryId" WHERE ${where}`,
            ),
          ]);
          result.comments = { total, items };
        })(),
      );
    }

    if (wants('kb')) {
      const where = Prisma.sql`k."updatedAt" >= ${since} AND ${doc(kbText)} @@ ${tsq}`;
      tasks.push(
        (async () => {
          const [items, total] = await Promise.all([
            run(Prisma.sql`
              SELECT k."id", k."title", k."category", k."updatedAt",
                     ts_headline('portuguese', ${kbText}, ${hlq}, ${HEADLINE}) AS snippet
                FROM "KbArticle" k WHERE ${where}
               ORDER BY ts_rank(${doc(kbText)}, ${tsq}) DESC, k."updatedAt" DESC
               LIMIT ${limit}`),
            count(Prisma.sql`SELECT count(*) AS n FROM "KbArticle" k WHERE ${where}`),
          ]);
          result.kb = { total, items };
        })(),
      );
    }

    if (analyst && wants('cases')) {
      const where = Prisma.sql`c."updatedAt" >= ${since} AND ${doc(caseText)} @@ ${tsq}`;
      tasks.push(
        (async () => {
          const [items, total] = await Promise.all([
            run(Prisma.sql`
              SELECT c."id", c."number", c."title", c."status", c."updatedAt",
                     ts_headline('portuguese', ${caseText}, ${hlq}, ${HEADLINE}) AS snippet
                FROM "Case" c WHERE ${where}
               ORDER BY ts_rank(${doc(caseText)}, ${tsq}) DESC, c."updatedAt" DESC
               LIMIT ${limit}`),
            count(Prisma.sql`SELECT count(*) AS n FROM "Case" c WHERE ${where}`),
          ]);
          result.cases = { total, items };
        })(),
      );
    }

    await Promise.all(tasks);
    return reply.send({ q, type, groups: result });
  });
}
