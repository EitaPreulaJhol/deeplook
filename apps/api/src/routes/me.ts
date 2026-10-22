import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { requireUser, SESSION_COOKIE } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { PreferencesPatchSchema, resolvePreferences } from '../lib/preferences';
import { prisma } from '../lib/prisma';
import { attemptLimit, sessionKey } from '../lib/rate-limit';
import { sendValidationError } from '../lib/validation';

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

  // Novidades desde a visita anterior: amostras do usuario concluidas por outra
  // pessoa (evento STATUS_CHANGED -> COMPLETED). Usado na Pagina Inicial.
  app.get('/api/me/updates', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { previousSeenAt: true },
    });
    const since = record?.previousSeenAt ?? null;
    if (!since) return reply.send({ since: null, completed: [] });

    const events = await prisma.entryEvent.findMany({
      where: {
        type: 'STATUS_CHANGED',
        toValue: 'COMPLETED',
        createdAt: { gt: since },
        NOT: { actorId: user.id },
        entry: { ownerId: user.id, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: { entry: { select: { id: true, title: true, verdict: true } } },
    });

    // Uma linha por amostra (a conclusao mais recente).
    const seen = new Set<string>();
    const completed = events
      .filter((e) => !seen.has(e.entryId) && seen.add(e.entryId))
      .map((e) => ({
        entryId: e.entry.id,
        title: e.entry.title,
        verdict: e.entry.verdict,
        completedAt: e.createdAt,
      }));
    return reply.send({ since, completed });
  });

  // 5 tentativas a cada 5 min por sessao: impede adivinhar a senha atual.
  const passwordLimit = attemptLimit(sessionKey('password'));

  // Troca de senha: confere a atual e encerra TODAS as sessoes do usuario
  // (inclusive esta), obrigando um novo login com a senha nova.
  app.post('/api/me/password', { config: passwordLimit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = PasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
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
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await audit(tx, req, {
        action: 'USER_PASSWORD_CHANGED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: record.email,
        detail: 'sessões encerradas',
      });
    });

    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });
}
