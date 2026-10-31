import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { isAnalyst, type PublicUser, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const CATEGORIES = ['MALWARE_FAMILY', 'SCAM', 'TECHNIQUE', 'PROCEDURE'] as const;

const ArticleSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(500),
  category: z.enum(CATEGORIES),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(30))
    .max(10)
    .default([])
    .transform((tags) => [...new Set(tags)]),
  body: z.string().trim().min(1).max(100_000),
});

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const person = { select: { id: true, displayName: true } } as const;

const listSelect = {
  id: true,
  title: true,
  summary: true,
  category: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: person,
} satisfies Prisma.KbArticleSelect;

const duplicateTitle = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const titleTaken = (reply: FastifyReply) =>
  reply.code(409).send({
    error: 'Já existe um artigo com este título.',
    details: { title: ['título em uso'] },
  });

/**
 * Base de conhecimento (item 63): artigos em Markdown sobre familias de malware,
 * golpes, tecnicas e procedimentos. Todos leem; analistas e admins escrevem;
 * quem criou (ou um admin) exclui. Relatorios citam artigos (Report.kbArticles).
 */
export async function kbRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas escrevem na base de conhecimento.' });
      return null;
    }
    return user;
  };

  app.get('/api/kb', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { q, category, limit, offset } = parsed.data;
    const where: Prisma.KbArticleWhereInput = {};
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.kbArticle.count({ where }),
      prisma.kbArticle.findMany({
        where,
        // Na busca, o titulo que bate vem primeiro; sem busca, os mais recentes.
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          ...listSelect,
          _count: { select: { reports: { where: { status: 'PUBLISHED' } } } },
        },
      }),
    ]);
    const ranked = q
      ? [...items].sort(
          (a, b) =>
            Number(b.title.toLowerCase().includes(q.toLowerCase())) -
            Number(a.title.toLowerCase().includes(q.toLowerCase())),
        )
      : items;
    return reply.send({
      total,
      items: ranked.map(({ _count, ...a }) => ({ ...a, citations: _count.reports })),
    });
  });

  app.get('/api/kb/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const article = await prisma.kbArticle.findUnique({
      where: { id },
      select: {
        ...listSelect,
        body: true,
        createdBy: person,
        revisions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, createdAt: true, editor: person },
        },
        // So relatorios publicados (e amostras fora da lixeira) aparecem como citacao.
        reports: {
          where: { status: 'PUBLISHED', entry: { deletedAt: null } },
          orderBy: { updatedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            updatedAt: true,
            analyst: person,
            entry: { select: { id: true, title: true, verdict: true } },
          },
        },
      },
    });
    if (!article) return reply.code(404).send({ error: 'Artigo não encontrado.' });
    return reply.send({ article: { ...article, canDelete: canDelete(user, article) } });
  });

  app.post('/api/kb', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = ArticleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      const article = await prisma.kbArticle.create({
        data: { ...parsed.data, createdById: user.id, updatedById: user.id },
        select: listSelect,
      });
      return reply.code(201).send({ article });
    } catch (err) {
      if (duplicateTitle(err)) return titleTaken(reply);
      throw err;
    }
  });

  app.patch('/api/kb/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const parsed = ArticleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const before = await prisma.kbArticle.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: 'Artigo não encontrado.' });
    try {
      const article = await prisma.$transaction(async (tx) => {
        // A versao anterior fica guardada (quem alterou e quando aparecem no artigo).
        await tx.kbArticleRevision.create({
          data: {
            articleId: id,
            editorId: user.id,
            title: before.title,
            summary: before.summary,
            body: before.body,
          },
        });
        return tx.kbArticle.update({
          where: { id },
          data: { ...parsed.data, updatedById: user.id },
          select: listSelect,
        });
      });
      return reply.send({ article });
    } catch (err) {
      if (duplicateTitle(err)) return titleTaken(reply);
      throw err;
    }
  });

  app.delete('/api/kb/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const article = await prisma.kbArticle.findUnique({
      where: { id },
      select: { createdBy: person },
    });
    if (!article) return reply.code(404).send({ error: 'Artigo não encontrado.' });
    if (!canDelete(user, article)) {
      return reply.code(403).send({ error: 'Só quem criou (ou um admin) exclui o artigo.' });
    }
    await prisma.kbArticle.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}

function canDelete(user: PublicUser, article: { createdBy: { id: string } | null }): boolean {
  return user.role === 'ADMIN' || (isAnalyst(user) && article.createdBy?.id === user.id);
}
