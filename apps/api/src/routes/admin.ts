import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../lib/auth';
import { generateActivationCode, generateTemporaryPassword, hashPassword } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const CreateKeySchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN']).default('USER'),
  maxUses: z.coerce.number().int().min(1).max(1000).default(1),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const PatchUserSchema = z.object({
  role: z.enum(['USER', 'ANALYST', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  // ---- Usuarios ----
  app.get('/api/admin/users', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
        _count: { select: { entries: true } },
      },
    });
    return reply.send({ users });
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const parsed = PatchUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });

    if (id === user.id && parsed.data.status === 'SUSPENDED') {
      return reply.code(400).send({ error: 'Voce nao pode suspender a propria conta.' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    return reply.send({ user: updated });
  });

  // Redefine a senha de um usuario: gera uma senha temporaria (devolvida uma
  // unica vez, para o admin repassar) e encerra todas as sessoes dele.
  app.post('/api/admin/users/:id/reset-password', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    if (id === admin.id) {
      return reply
        .code(400)
        .send({ error: 'Para trocar a propria senha, use Minha conta > Alterar senha.' });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) return reply.code(404).send({ error: 'Usuario nao encontrado.' });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: id } }),
    ]);

    return reply.send({ temporaryPassword });
  });

  // ---- Chaves de ativacao ----
  app.get('/api/admin/activation-keys', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const keys = await prisma.activationKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        usedBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    return reply.send({ keys });
  });

  app.post('/api/admin/activation-keys', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const parsed = CreateKeySchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { role, maxUses, expiresInDays } = parsed.data;

    let code = generateActivationCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.activationKey.findUnique({ where: { code } });
      if (!exists) break;
      code = generateActivationCode();
    }

    const key = await prisma.activationKey.create({
      data: {
        code,
        role,
        maxUses,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
        createdById: user.id,
      },
      include: { createdBy: { select: { id: true, displayName: true } } },
    });
    return reply.code(201).send({ key });
  });

  app.delete('/api/admin/activation-keys/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const key = await prisma.activationKey.findUnique({ where: { id } });
    if (!key) return reply.code(404).send({ error: 'Chave nao encontrada.' });

    await prisma.activationKey.update({ where: { id }, data: { revoked: true } });
    return reply.send({ ok: true });
  });
}
