import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

/** Limite de favoritos por usuario (a pasta precisa caber no navegador). */
export const MAX_FAVORITES = 30;

/** Caminho relativo do proprio app: uma unica "/" no inicio, sem host, "\" ou espacos. */
const AppPath = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/(?![/\\])[^\s\\]*$/, 'Use um endereco do proprio DeepLook.');
const Label = z.string().trim().min(1).max(60);

const CreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('VIEW'), label: Label, url: AppPath }),
  z.object({ kind: z.literal('ENTRY'), entryId: z.string().min(1), label: Label.optional() }),
]);
const RenameSchema = z.object({ label: Label });
const OrderSchema = z.object({ ids: z.array(z.string()).min(1).max(MAX_FAVORITES) });

const favoriteSelect = {
  id: true,
  kind: true,
  label: true,
  url: true,
  entryId: true,
  position: true,
  createdAt: true,
  entry: { select: { id: true, title: true, status: true, verdict: true } },
} satisfies Prisma.FavoriteSelect;

/**
 * Pasta "Favoritos" do Navegador do Sistema: visoes de lista salvas (Salvar visao
 * na barra de filtros) e amostras fixadas (Fixar na ficha), por usuario.
 */
export async function favoritesRoutes(app: FastifyInstance) {
  app.get('/api/me/favorites', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: favoriteSelect,
    });
    return reply.send({ favorites });
  });

  app.post('/api/me/favorites', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error, 'Favorito invalido.');
    }
    const input = parsed.data;

    const existing = await prisma.favorite.findMany({
      where: { userId: user.id },
      select: { url: true, entryId: true, label: true, position: true },
    });
    if (existing.length >= MAX_FAVORITES) {
      return reply.code(409).send({
        error: `Limite de ${MAX_FAVORITES} favoritos atingido. Remova algum para adicionar outro.`,
      });
    }

    let label: string;
    if (input.kind === 'VIEW') {
      const same = existing.find((f) => f.url === input.url);
      if (same) {
        return reply
          .code(409)
          .send({ error: `Esta visão já está nos Favoritos como "${same.label}".` });
      }
      label = input.label;
    } else {
      if (existing.some((f) => f.entryId === input.entryId)) {
        return reply.code(409).send({ error: 'Esta amostra já está nos Favoritos.' });
      }
      const entry = await prisma.entry.findUnique({
        where: { id: input.entryId },
        select: { title: true },
      });
      if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
      label = input.label ?? entry.title.slice(0, 60);
    }

    const position = existing.reduce((max, f) => Math.max(max, f.position), -1) + 1;
    try {
      const favorite = await prisma.favorite.create({
        data: {
          userId: user.id,
          kind: input.kind,
          label,
          url: input.kind === 'VIEW' ? input.url : null,
          entryId: input.kind === 'ENTRY' ? input.entryId : null,
          position,
        },
        select: favoriteSelect,
      });
      return reply.code(201).send({ favorite });
    } catch (err) {
      // Dois cliques simultaneos em "Fixar": o indice unico segura o segundo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'Esta amostra já está nos Favoritos.' });
      }
      throw err;
    }
  });

  // Nova ordem da pasta: a lista completa de ids do usuario, na ordem desejada.
  app.put('/api/me/favorites/order', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Ordem invalida.' });
    const { ids } = parsed.data;

    const mine = await prisma.favorite.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const sameSet =
      ids.length === mine.length &&
      new Set(ids).size === ids.length &&
      mine.every((f) => ids.includes(f.id));
    if (!sameSet) return reply.code(400).send({ error: 'Ordem invalida.' });

    await prisma.$transaction(
      ids.map((id, position) => prisma.favorite.update({ where: { id }, data: { position } })),
    );
    return reply.send({ ok: true });
  });

  app.patch('/api/me/favorites/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Nome invalido (1 a 60 caracteres).' });

    const { id } = req.params as { id: string };
    const result = await prisma.favorite.updateMany({
      where: { id, userId: user.id },
      data: { label: parsed.data.label },
    });
    if (result.count === 0) return reply.code(404).send({ error: 'Favorito nao encontrado.' });
    const favorite = await prisma.favorite.findUnique({ where: { id }, select: favoriteSelect });
    return reply.send({ favorite });
  });

  app.delete('/api/me/favorites/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const result = await prisma.favorite.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) return reply.code(404).send({ error: 'Favorito nao encontrado.' });
    return reply.send({ ok: true });
  });
}
