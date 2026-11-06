import crypto from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { audit } from '../lib/audit';
import { requireUser, sessionIdFrom } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { describeUserAgent } from '../lib/user-agent';

/**
 * Identificador exibivel da sessao: um hash curto do id (que ja e o SHA-256 do cookie), para
 * a tela nunca levar nada que sirva de cookie.
 */
export function sessionHandle(sessionId: string): string {
  return crypto.createHash('sha256').update(`session:${sessionId}`).digest('hex').slice(0, 16);
}

const currentId = (req: FastifyRequest) => sessionIdFrom(req);

/** Minha Conta > Sessoes (item 61): onde a conta esta logada e encerrar sessoes. */
export async function sessionRoutes(app: FastifyInstance) {
  app.get('/api/me/sessions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const current = currentId(req);
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return reply.send({
      sessions: sessions.map((s) => ({
        handle: sessionHandle(s.id),
        device: describeUserAgent(s.userAgent),
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        current: s.id === current,
      })),
    });
  });

  // Encerra uma sessao (outro navegador). A atual sai pelo "Sair".
  app.delete('/api/me/sessions/:handle', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { handle } = req.params as { handle: string };
    const current = currentId(req);
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    const target = sessions.find((s) => sessionHandle(s.id) === handle);
    if (!target) return reply.code(404).send({ error: 'Sessão não encontrada.' });
    if (target.id === current) {
      return reply.code(400).send({ error: 'Esta é a sessão atual: use "Sair" para encerrá-la.' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: target.id } });
      await audit(tx, req, {
        action: 'SESSION_REVOKED',
        actorId: user.id,
        targetUserId: user.id,
        targetLabel: user.email,
        detail: `${describeUserAgent(target.userAgent)}${target.ip ? ` · ${target.ip}` : ''}`,
      });
    });
    return reply.send({ ok: true });
  });

  app.post('/api/me/sessions/revoke-others', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const current = currentId(req);
    const count = await prisma.$transaction(async (tx) => {
      const { count: removed } = await tx.session.deleteMany({
        where: { userId: user.id, ...(current ? { id: { not: current } } : {}) },
      });
      if (removed) {
        await audit(tx, req, {
          action: 'SESSION_REVOKED',
          actorId: user.id,
          targetUserId: user.id,
          targetLabel: user.email,
          detail: `${removed} outra(s) sessão(ões) encerrada(s)`,
        });
      }
      return removed;
    });
    return reply.send({ revoked: count });
  });
}
