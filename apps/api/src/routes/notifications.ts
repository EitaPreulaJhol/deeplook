import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';
import { caseCode } from './cases';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  /** `1`: so as nao lidas. */
  unread: z.enum(['0', '1']).optional(),
});

const ReadSchema = z.object({
  /** Notificacoes a marcar como lidas; sem `ids`, marca todas. */
  ids: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * Caixa de entrada (sininho do masthead e pagina "Caixa de entrada") e a lista
 * de pessoas para o autocompletar de "@" nas atualizacoes.
 */
/**
 * Notificacoes de amostras na lixeira ficam escondidas (voltam se restaurada);
 * as de casos (item 89) nao tem amostra.
 */
const liveEntry: Prisma.NotificationWhereInput = {
  OR: [{ entryId: null }, { entry: { deletedAt: null } }],
};

export async function notificationRoutes(app: FastifyInstance) {
  const unreadCount = (userId: string) =>
    prisma.notification.count({ where: { userId, readAt: null, ...liveEntry } });

  app.get('/api/me/notifications', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parametros invalidos.');
    const { limit, unread } = parsed.data;

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id, ...liveEntry, ...(unread === '1' ? { readAt: null } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          type: true,
          detail: true,
          readAt: true,
          createdAt: true,
          entry: { select: { id: true, title: true, resolution: true } },
          case: { select: { id: true, number: true, title: true } },
          actor: { select: { id: true, displayName: true } },
        },
      }),
      unreadCount(user.id),
    ]);
    return reply.send({
      items: items.map((n) => ({
        ...n,
        case: n.case ? { ...n.case, code: caseCode(n.case.number) } : null,
      })),
      unread: total,
    });
  });

  // Contador do sininho (consultado a cada minuto).
  app.get('/api/me/notifications/count', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return reply.send({ unread: await unreadCount(user.id) });
  });

  app.post('/api/me/notifications/read', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = ReadSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { ids } = parsed.data;
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return reply.send({ unread: await unreadCount(user.id) });
  });

  // Autocompletar de "@": usuarios ativos pelo nome (sem e-mail), ate 8.
  app.get('/api/users/mentionable', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const q = String((req.query as { q?: string }).q ?? '')
      .trim()
      .slice(0, 60);
    // `analysts=1`: comentarios de casos (item 89), que so analistas abrem.
    const analystsOnly = (req.query as { analysts?: string }).analysts === '1';
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        id: { not: user.id },
        ...(analystsOnly ? { role: { not: 'USER' as const } } : {}),
        ...(q ? { displayName: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { displayName: 'asc' },
      take: 8,
      select: { id: true, displayName: true },
    });
    return reply.send({ users });
  });
}
