import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { isAnalyst, type PublicUser, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';
import { ListQuery, listWhere } from './entries';

/** Limite de visoes da equipe (a pasta precisa caber no navegador). */
export const MAX_TEAM_VIEWS = 30;

/** So visoes do Historico Global (as outras listas dependem de quem abre). */
const ViewUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/history(\?[^\s\\]*)?$/, 'Compartilhe uma visão do Histórico Global.');
const Label = z.string().trim().min(1).max(60);
const CreateSchema = z.object({ label: Label, url: ViewUrl });
const RenameSchema = z.object({ label: Label });

const viewSelect = {
  id: true,
  label: true,
  url: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TeamViewSelect;

/**
 * Quantas amostras a visao mostra agora, para quem esta vendo ("Atribuidas a
 * mim" conta as de cada um). Endereco que nao vale mais (filtro removido) = null.
 */
async function countFor(url: string, userId: string): Promise<number | null> {
  const search = new URLSearchParams(url.split('?')[1] ?? '');
  const parsed = ListQuery.safeParse({ ...Object.fromEntries(search), scope: 'all' });
  if (!parsed.success) return null;
  return prisma.entry.count({ where: listWhere(parsed.data, userId) });
}

const canEdit = (user: PublicUser, view: { createdBy: { id: string } | null }) =>
  user.role === 'ADMIN' || view.createdBy?.id === user.id;

/**
 * Visoes da equipe (item 62): visoes do Historico Global que um analista
 * compartilha; aparecem na pasta "Visoes da equipe" do navegador de todos os
 * analistas, com contador. So quem criou (ou um admin) renomeia ou remove.
 */
export async function teamViewRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas usam as visões da equipe.' });
      return null;
    }
    return user;
  };

  app.get('/api/team-views', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const views = await prisma.teamView.findMany({
      orderBy: [{ label: 'asc' }, { createdAt: 'asc' }],
      select: viewSelect,
    });
    const counts = await Promise.all(views.map((v) => countFor(v.url, user.id)));
    return reply.send({
      views: views.map((v, i) => ({ ...v, count: counts[i], canEdit: canEdit(user, v) })),
    });
  });

  app.post('/api/team-views', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Visão inválida.');
    const { label, url } = parsed.data;
    const [total, same] = await Promise.all([
      prisma.teamView.count(),
      prisma.teamView.findUnique({ where: { url }, select: { label: true } }),
    ]);
    if (same) {
      return reply
        .code(409)
        .send({ error: `Esta visão já está nas Visões da equipe como "${same.label}".` });
    }
    if (total >= MAX_TEAM_VIEWS) {
      return reply.code(409).send({
        error: `Limite de ${MAX_TEAM_VIEWS} visões da equipe atingido. Remova alguma para compartilhar outra.`,
      });
    }
    try {
      const view = await prisma.teamView.create({
        data: { label, url, createdById: user.id },
        select: viewSelect,
      });
      return reply.code(201).send({ view });
    } catch (err) {
      // Dois compartilhamentos simultaneos da mesma visao: o indice unico segura.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'Esta visão já está nas Visões da equipe.' });
      }
      throw err;
    }
  });

  const findEditable = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ user: PublicUser; id: string } | null> => {
    const user = await requireAnalyst(req, reply);
    if (!user) return null;
    const { id } = req.params as { id: string };
    const view = await prisma.teamView.findUnique({ where: { id }, select: viewSelect });
    if (!view) {
      reply.code(404).send({ error: 'Visão não encontrada.' });
      return null;
    }
    if (!canEdit(user, view)) {
      reply.code(403).send({ error: 'Só quem compartilhou (ou um admin) altera esta visão.' });
      return null;
    }
    return { user, id };
  };

  app.patch('/api/team-views/:id', async (req, reply) => {
    const found = await findEditable(req, reply);
    if (!found) return;
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Nome inválido.');
    const view = await prisma.teamView.update({
      where: { id: found.id },
      data: { label: parsed.data.label },
      select: viewSelect,
    });
    return reply.send({ view });
  });

  app.delete('/api/team-views/:id', async (req, reply) => {
    const found = await findEditable(req, reply);
    if (!found) return;
    await prisma.teamView.delete({ where: { id: found.id } });
    return reply.send({ ok: true });
  });
}
