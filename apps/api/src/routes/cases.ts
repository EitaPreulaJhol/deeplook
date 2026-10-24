import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { isAnalyst, requireUser } from '../lib/auth';
import { recordEvent } from '../lib/events';
import type { Tx } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const;
const MAX_ENTRIES_PER_REQUEST = 100;

const EntryIds = z
  .array(z.string().min(1).max(40))
  .min(1, 'escolha ao menos uma amostra')
  .max(MAX_ENTRIES_PER_REQUEST)
  .transform((ids) => [...new Set(ids)]);

const CreateSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(4000).optional(),
  entryIds: EntryIds,
});
const PatchSchema = z
  .object({
    title: z.string().trim().min(3).max(150).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    assigneeId: z.string().min(1).nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nada para atualizar.');
const AddSchema = z.object({ entryIds: EntryIds });
const CommentSchema = z.object({ text: z.string().trim().min(1).max(4000) });
const ListQuery = z.object({
  status: z.enum([...STATUSES, 'active']).optional(),
  assignee: z.union([z.enum(['me', 'none']), z.string().regex(/^c[a-z0-9]{20,32}$/)]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const person = { select: { id: true, displayName: true } } as const;

const listSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  assignee: person,
  createdBy: person,
  _count: { select: { entries: true } },
} satisfies Prisma.CaseSelect;

/** "CASO-0007". */
export const caseCode = (n: number) => `CASO-${String(n).padStart(4, '0')}`;

/** Amostras que existem (fora da lixeira); devolve as que faltam. */
async function missingEntries(ids: string[]): Promise<string[]> {
  const found = await prisma.entry.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const ok = new Set(found.map((e) => e.id));
  return ids.filter((id) => !ok.has(id));
}

async function addEntries(
  tx: Tx,
  caseId: string,
  code: string,
  entryIds: string[],
  actorId: string,
) {
  const already = new Set(
    (
      await tx.caseEntry.findMany({
        where: { caseId, entryId: { in: entryIds } },
        select: { entryId: true },
      })
    ).map((c) => c.entryId),
  );
  const fresh = entryIds.filter((id) => !already.has(id));
  if (!fresh.length) return 0;
  await tx.caseEntry.createMany({
    data: fresh.map((entryId) => ({ caseId, entryId, addedById: actorId })),
  });
  for (const entryId of fresh) {
    await tx.caseEvent.create({ data: { caseId, actorId, type: 'ENTRY_ADDED', entryId } });
    await recordEvent(tx, { entryId, actorId, type: 'CASE_ADDED', detail: code });
  }
  return fresh.length;
}

/**
 * Casos (item 55): agrupam amostras da mesma campanha. So analistas e admins;
 * uma amostra pode estar em varios casos; o caso nao tem relatorio proprio (mostra
 * os relatorios publicados das amostras) e nunca fica vazio.
 */
export async function caseRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas trabalham com casos.' });
      return null;
    }
    return user;
  };

  const loadCase = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.case.findUnique({ where: { id } });
    if (!found) reply.code(404).send({ error: 'Caso não encontrado.' });
    return found;
  };

  app.get('/api/cases', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parametros invalidos.');
    const { status, assignee, q, limit, offset } = parsed.data;
    const where: Prisma.CaseWhereInput = {};
    if (status === 'active') where.status = { not: 'CLOSED' };
    else if (status) where.status = status;
    if (assignee === 'me') where.assigneeId = user.id;
    else if (assignee === 'none') where.assigneeId = null;
    else if (assignee) where.assigneeId = assignee;
    if (q) {
      const n = /^(?:caso-)?0*(\d{1,9})$/i.exec(q);
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        ...(n ? [{ number: Number(n[1]) }] : []),
      ];
    }
    const [total, items] = await Promise.all([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        select: listSelect,
      }),
    ]);
    return reply.send({
      total,
      items: items.map(({ _count, ...c }) => ({
        ...c,
        code: caseCode(c.number),
        entries: _count.entries,
      })),
    });
  });

  // Contadores da pasta Casos do navegador.
  app.get('/api/cases/counts', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const [active, mine] = await Promise.all([
      prisma.case.count({ where: { status: { not: 'CLOSED' } } }),
      prisma.case.count({ where: { status: { not: 'CLOSED' }, assigneeId: user.id } }),
    ]);
    return reply.send({ active, mine });
  });

  app.post('/api/cases', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { title, description, entryIds } = parsed.data;
    const missing = await missingEntries(entryIds);
    if (missing.length) {
      return reply
        .code(400)
        .send({
          error: 'Amostra não encontrada.',
          details: { entryIds: ['amostra não encontrada'] },
        });
    }
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          title,
          description: description || null,
          createdById: user.id,
          assigneeId: user.id,
        },
      });
      await tx.caseEvent.create({
        data: { caseId: c.id, actorId: user.id, type: 'CREATED', detail: title },
      });
      await addEntries(tx, c.id, caseCode(c.number), entryIds, user.id);
      return tx.case.findUniqueOrThrow({ where: { id: c.id }, select: listSelect });
    });
    const { _count, ...c } = created;
    return reply
      .code(201)
      .send({ case: { ...c, code: caseCode(c.number), entries: _count.entries } });
  });

  app.get('/api/cases/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const found = await prisma.case.findUnique({
      where: { id },
      select: {
        ...listSelect,
        description: true,
        entries: {
          // Incluidas juntas tem o mesmo horario: a data de envio desempata.
          orderBy: [{ addedAt: 'asc' }, { entry: { createdAt: 'asc' } }],
          where: { entry: { deletedAt: null } },
          select: {
            addedAt: true,
            addedBy: person,
            entry: {
              select: {
                id: true,
                title: true,
                type: true,
                status: true,
                verdict: true,
                priority: true,
                createdAt: true,
                reports: {
                  where: { status: 'PUBLISHED' },
                  orderBy: { updatedAt: 'desc' },
                  select: {
                    id: true,
                    summary: true,
                    verdict: true,
                    updatedAt: true,
                    analyst: person,
                    attackTechniques: true,
                  },
                },
              },
            },
          },
        },
        events: {
          // Eventos da mesma transacao tem o mesmo horario: o id (cuid) desempata.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            type: true,
            detail: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            actor: person,
            entry: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!found) return reply.code(404).send({ error: 'Caso não encontrado.' });
    const { _count, ...c } = found;
    return reply.send({ case: { ...c, code: caseCode(c.number) } });
  });

  app.patch('/api/cases/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const current = await loadCase(req, reply);
    if (!current) return;
    const data = parsed.data;
    if (data.assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: data.assigneeId },
        select: { role: true, status: true },
      });
      if (!assignee || assignee.role === 'USER' || assignee.status !== 'ACTIVE') {
        return reply
          .code(400)
          .send({
            error: 'Responsável inválido.',
            details: { assigneeId: ['escolha um analista ativo'] },
          });
      }
    }
    await prisma.$transaction(async (tx) => {
      const event = (
        type: 'STATUS_CHANGED' | 'ASSIGNED' | 'UPDATED',
        extra: Partial<Prisma.CaseEventUncheckedCreateInput> = {},
      ) => tx.caseEvent.create({ data: { caseId: current.id, actorId: user.id, type, ...extra } });
      if (data.status && data.status !== current.status) {
        await event('STATUS_CHANGED', { fromValue: current.status, toValue: data.status });
      }
      if (data.assigneeId !== undefined && data.assigneeId !== current.assigneeId) {
        await event('ASSIGNED', { fromValue: current.assigneeId, toValue: data.assigneeId });
      }
      const titleChanged = data.title !== undefined && data.title !== current.title;
      const descChanged =
        data.description !== undefined && (data.description || null) !== current.description;
      if (titleChanged || descChanged)
        await event('UPDATED', { detail: titleChanged ? data.title : null });
      await tx.case.update({
        where: { id: current.id },
        data: {
          title: data.title,
          description: data.description === undefined ? undefined : data.description || null,
          status: data.status,
          assigneeId: data.assigneeId,
          ...(data.status && data.status !== current.status
            ? { closedAt: data.status === 'CLOSED' ? new Date() : null }
            : {}),
        },
      });
    });
    const updated = await prisma.case.findUniqueOrThrow({
      where: { id: current.id },
      select: listSelect,
    });
    const { _count, ...c } = updated;
    return reply.send({ case: { ...c, code: caseCode(c.number), entries: _count.entries } });
  });

  app.post('/api/cases/:id/entries', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const current = await loadCase(req, reply);
    if (!current) return;
    if ((await missingEntries(parsed.data.entryIds)).length) {
      return reply
        .code(400)
        .send({
          error: 'Amostra não encontrada.',
          details: { entryIds: ['amostra não encontrada'] },
        });
    }
    const added = await prisma.$transaction(async (tx) => {
      const n = await addEntries(
        tx,
        current.id,
        caseCode(current.number),
        parsed.data.entryIds,
        user.id,
      );
      if (n) await tx.case.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
      return n;
    });
    return reply.send({ added });
  });

  app.delete('/api/cases/:id/entries/:entryId', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const current = await loadCase(req, reply);
    if (!current) return;
    const { entryId } = req.params as { entryId: string };
    const link = await prisma.caseEntry.findUnique({
      where: { caseId_entryId: { caseId: current.id, entryId } },
    });
    if (!link) return reply.code(404).send({ error: 'A amostra não está neste caso.' });
    // Caso nunca fica vazio: para desfazer, encerre o caso.
    if ((await prisma.caseEntry.count({ where: { caseId: current.id } })) <= 1) {
      return reply
        .code(409)
        .send({
          error: 'O caso precisa de ao menos uma amostra. Para desfazê-lo, encerre o caso.',
        });
    }
    await prisma.$transaction(async (tx) => {
      await tx.caseEntry.delete({ where: { caseId_entryId: { caseId: current.id, entryId } } });
      await tx.caseEvent.create({
        data: { caseId: current.id, actorId: user.id, type: 'ENTRY_REMOVED', entryId },
      });
      await recordEvent(tx, {
        entryId,
        actorId: user.id,
        type: 'CASE_REMOVED',
        detail: caseCode(current.number),
      });
      await tx.case.update({ where: { id: current.id }, data: { updatedAt: new Date() } });
    });
    return reply.send({ ok: true });
  });

  app.post('/api/cases/:id/comments', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CommentSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const current = await loadCase(req, reply);
    if (!current) return;
    await prisma.$transaction([
      prisma.caseEvent.create({
        data: { caseId: current.id, actorId: user.id, type: 'COMMENT', detail: parsed.data.text },
      }),
      prisma.case.update({ where: { id: current.id }, data: { updatedAt: new Date() } }),
    ]);
    return reply.code(201).send({ ok: true });
  });

  // Casos de uma amostra (ficha).
  app.get('/api/entries/:id/cases', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const links = await prisma.caseEntry.findMany({
      where: { entryId: id },
      orderBy: { addedAt: 'desc' },
      select: { case: { select: { id: true, number: true, title: true, status: true } } },
    });
    return reply.send({ cases: links.map((l) => ({ ...l.case, code: caseCode(l.case.number) })) });
  });
}
