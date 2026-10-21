import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createSession, destroySession, loadUser } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { resolvePreferences } from '../lib/preferences';
import { prisma } from '../lib/prisma';

const RegisterSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(80),
  password: z.string().min(8).max(200),
  activationKey: z.string().min(6),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: Date;
  preferences: unknown;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    preferences: resolvePreferences(u.preferences),
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Cadastro somente via chave de ativacao gerada por um admin.
  app.post('/api/auth/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Dados invalidos.', details: parsed.error.flatten().fieldErrors });
    }
    const { email, displayName, password, activationKey } = parsed.data;

    const key = await prisma.activationKey.findUnique({
      where: { code: activationKey.trim().toUpperCase() },
    });

    if (!key) return reply.code(400).send({ error: 'Chave de ativacao invalida.' });
    if (key.revoked) return reply.code(400).send({ error: 'Chave de ativacao revogada.' });
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'Chave de ativacao expirada.' });
    }
    if (key.usesUsed >= key.maxUses) {
      return reply.code(400).send({ error: 'Chave de ativacao ja utilizada.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.code(409).send({ error: 'E-mail ja cadastrado.' });

    const passwordHash = await hashPassword(password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          displayName,
          passwordHash,
          role: key.role,
          status: 'ACTIVE',
        },
      });
      await tx.activationKey.update({
        where: { id: key.id },
        data: {
          usesUsed: { increment: 1 },
          usedBy: { connect: { id: created.id } },
        },
      });
      return created;
    });

    await createSession(reply, user.id);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) return reply.code(401).send({ error: 'Credenciais invalidas.' });
    if (user.status !== 'ACTIVE') return reply.code(403).send({ error: 'Conta suspensa.' });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'Credenciais invalidas.' });

    await createSession(reply, user.id);
    return reply.send({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await loadUser(req);
    if (!user) return reply.code(401).send({ error: 'Nao autenticado.' });
    return reply.send({ user });
  });
}
