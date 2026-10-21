import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser, SESSION_COOKIE } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { PreferencesPatchSchema, resolvePreferences } from '../lib/preferences';
import { prisma } from '../lib/prisma';

const PasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

/** Conta do proprio usuario: preferencias de uso e troca de senha. */
export async function meRoutes(app: FastifyInstance) {
  app.patch('/api/me/preferences', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = PreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Preferencias invalidas.' });

    const preferences = { ...user.preferences, ...parsed.data };
    await prisma.user.update({ where: { id: user.id }, data: { preferences } });
    return reply.send({ preferences: resolvePreferences(preferences) });
  });

  // Troca de senha: confere a atual e encerra TODAS as sessoes do usuario
  // (inclusive esta), obrigando um novo login com a senha nova.
  app.post('/api/me/password', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = PasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'A nova senha deve ter entre 8 e 200 caracteres.' });
    }
    const { currentPassword, newPassword } = parsed.data;

    const record = await prisma.user.findUnique({ where: { id: user.id } });
    if (!record) return reply.code(404).send({ error: 'Usuario nao encontrado.' });

    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      return reply.code(400).send({ error: 'Senha atual incorreta.' });
    }
    if (await verifyPassword(newPassword, record.passwordHash)) {
      return reply.code(400).send({ error: 'A nova senha deve ser diferente da atual.' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });
}
