import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { isAnalyst, requireUser } from '../lib/auth';
import { ruleLabel } from '../lib/auto-assign';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const GroupSchema = z.object({ name: z.string().trim().min(2).max(60) });
const MembersSchema = z.object({
  memberIds: z
    .array(z.string().min(1).max(40))
    .max(100)
    .transform((ids) => [...new Set(ids)]),
});
const RuleSchema = z
  .object({
    groupId: z.string().min(1).max(40),
    entryType: z.enum(['FILE', 'URL']).nullable().default(null),
    tag: z
      .string()
      .trim()
      .toLowerCase()
      .max(50)
      .nullable()
      .default(null)
      .transform((t) => t || null),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).nullable().default(null),
  })
  .strict();
const RulePatchSchema = z.object({ enabled: z.boolean() }).strict();
const MoveSchema = z.object({ direction: z.enum(['up', 'down']) });
const AwaySchema = z.object({ away: z.boolean() });

/**
 * Atribuicao automatica (item 72): grupos de analistas e regras em ordem
 * (tipo/tag/prioridade -> grupo), mantidos por analistas e admins. O rodizio
 * fica em lib/auto-assign.ts.
 */
export async function assignmentRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas configuram a atribuição automática.' });
      return null;
    }
    return user;
  };

  /** Analistas/admins ativos que podem entrar num grupo. */
  const eligible = (ids: string[]) =>
    prisma.user.count({
      where: { id: { in: ids }, status: 'ACTIVE', role: { in: ['ANALYST', 'ADMIN'] } },
    });

  app.get('/api/assignment', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const [groups, rules, analysts] = await Promise.all([
      prisma.assignmentGroup.findMany({
        orderBy: { name: 'asc' },
        include: {
          members: {
            orderBy: { user: { displayName: 'asc' } },
            select: {
              lastAssignedAt: true,
              user: {
                select: { id: true, displayName: true, away: true, status: true, role: true },
              },
            },
          },
          _count: { select: { rules: true } },
        },
      }),
      prisma.assignmentRule.findMany({
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { group: { select: { id: true, name: true } } },
      }),
      prisma.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['ANALYST', 'ADMIN'] } },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true, away: true },
      }),
    ]);
    return reply.send({
      groups: groups.map(({ members, _count, ...g }) => ({
        ...g,
        rules: _count.rules,
        members: members.map((m) => ({
          ...m.user,
          // Recebe do rodizio: ativo, analista/admin e presente.
          available: m.user.status === 'ACTIVE' && m.user.role !== 'USER' && !m.user.away,
          lastAssignedAt: m.lastAssignedAt,
        })),
      })),
      rules: rules.map((r) => ({ ...r, label: ruleLabel(r) })),
      analysts,
    });
  });

  app.post('/api/assignment/groups', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = GroupSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      const group = await prisma.assignmentGroup.create({ data: parsed.data });
      return reply.code(201).send({ group });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply
          .code(409)
          .send({ error: 'Já existe um grupo com esse nome.', details: { name: ['nome em uso'] } });
      }
      throw err;
    }
  });

  app.patch('/api/assignment/groups/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const group = await prisma.assignmentGroup.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'Grupo não encontrado.' });
    if ('name' in body) {
      const parsed = GroupSchema.safeParse(body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      try {
        await prisma.assignmentGroup.update({ where: { id }, data: parsed.data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply
            .code(409)
            .send({
              error: 'Já existe um grupo com esse nome.',
              details: { name: ['nome em uso'] },
            });
        }
        throw err;
      }
    }
    if ('memberIds' in body) {
      const parsed = MembersSchema.safeParse(body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const ids = parsed.data.memberIds;
      if ((await eligible(ids)) !== ids.length) {
        return reply.code(400).send({
          error: 'Dados invalidos.',
          details: { memberIds: ['só analistas e admins ativos entram em grupos'] },
        });
      }
      // Quem continua no grupo mantem a vez no rodizio.
      await prisma.$transaction([
        prisma.assignmentGroupMember.deleteMany({ where: { groupId: id, userId: { notIn: ids } } }),
        prisma.assignmentGroupMember.createMany({
          data: ids.map((userId) => ({ groupId: id, userId })),
          skipDuplicates: true,
        }),
      ]);
    }
    return reply.send({ ok: true });
  });

  // Excluir o grupo apaga as regras dele.
  app.delete('/api/assignment/groups/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { count } = await prisma.assignmentGroup.deleteMany({ where: { id } });
    if (!count) return reply.code(404).send({ error: 'Grupo não encontrado.' });
    return reply.send({ ok: true });
  });

  app.post('/api/assignment/rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const group = await prisma.assignmentGroup.findUnique({ where: { id: parsed.data.groupId } });
    if (!group) {
      return reply
        .code(400)
        .send({ error: 'Dados invalidos.', details: { groupId: ['grupo não encontrado'] } });
    }
    const last = await prisma.assignmentRule.aggregate({ _max: { position: true } });
    const rule = await prisma.assignmentRule.create({
      data: { ...parsed.data, position: (last._max.position ?? 0) + 1 },
    });
    return reply.code(201).send({ rule });
  });

  app.patch('/api/assignment/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = RulePatchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const { count } = await prisma.assignmentRule.updateMany({ where: { id }, data: parsed.data });
    if (!count) return reply.code(404).send({ error: 'Regra não encontrada.' });
    return reply.send({ ok: true });
  });

  // Sobe/desce uma posicao (troca com a vizinha).
  app.post('/api/assignment/rules/:id/move', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = MoveSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const rules = await prisma.assignmentRule.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const index = rules.findIndex((r) => r.id === id);
    if (index < 0) return reply.code(404).send({ error: 'Regra não encontrada.' });
    const target = parsed.data.direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= rules.length) return reply.send({ ok: true });
    [rules[index], rules[target]] = [rules[target], rules[index]];
    // Renumera tudo (1..n): a ordem fica estavel mesmo com posicoes repetidas.
    await prisma.$transaction(
      rules.map((r, i) =>
        prisma.assignmentRule.update({ where: { id: r.id }, data: { position: i + 1 } }),
      ),
    );
    return reply.send({ ok: true });
  });

  app.delete('/api/assignment/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { count } = await prisma.assignmentRule.deleteMany({ where: { id } });
    if (!count) return reply.code(404).send({ error: 'Regra não encontrada.' });
    return reply.send({ ok: true });
  });

  // Ausente: a propria pessoa (analista) ou um admin para qualquer analista.
  app.put('/api/assignment/away/:userId', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = AwaySchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { userId } = req.params as { userId: string };
    if (userId !== user.id && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Só um admin marca outra pessoa como ausente.' });
    }
    const { count } = await prisma.user.updateMany({
      where: { id: userId, role: { in: ['ANALYST', 'ADMIN'] } },
      data: { away: parsed.data.away },
    });
    if (!count) return reply.code(404).send({ error: 'Analista não encontrado.' });
    return reply.send({ away: parsed.data.away });
  });
}
