import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { hashToken, newTokenSecret, TOKEN_MAX_ACTIVE, TOKEN_MAX_DAYS } from '../lib/api-tokens';
import { audit } from '../lib/audit';
import { requireAdmin, requireUser } from '../lib/auth';
import { advisoryLock, prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  expiresInDays: z.coerce.number().int().min(1).max(TOKEN_MAX_DAYS),
  /**
   * SAMPLES (padrao): envio e consulta de amostras. STATUS: leitura do status. FEED: TAXII 2.1 e
   * feed MISP dos indicadores (item 5.3). STATUS e FEED, so admin cria.
   */
  scope: z.enum(['SAMPLES', 'STATUS', 'FEED']).default('SAMPLES'),
});

const AdminQuery = z.object({ status: z.enum(['active', 'all']).default('active') });

/** O que o front ve de um token (nunca o hash). */
const tokenSelect = {
  id: true,
  name: true,
  prefix: true,
  scope: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  revokedAt: true,
} as const;

const activeWhere = () => ({ revokedAt: null, expiresAt: { gt: new Date() } });

/** Conferir o teto e inserir fora de uma transacao deixava passar pedidos paralelos. */
class TokenLimit extends Error {}

const tokenLockKey = (userId: string) =>
  createHash('sha256').update(`api-token:${userId}`).digest().readUIntBE(0, 6);

/**
 * Tokens de API pessoais. So quem tem "Acesso por API" (liberado por um admin
 * na aba Usuarios) gera tokens; o token aparece uma unica vez. As rotas daqui
 * so aceitam a sessao do navegador (nao estao na lista do token).
 */
export async function apiTokenRoutes(app: FastifyInstance) {
  app.get('/api/me/api-tokens', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const tokens = await prisma.apiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: tokenSelect,
    });
    return reply.send({ apiAccess: user.apiAccess, maxDays: TOKEN_MAX_DAYS, tokens });
  });

  app.post('/api/me/api-tokens', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!user.apiAccess) {
      return reply
        .code(403)
        .send({ error: 'O acesso por API desta conta não foi liberado por um administrador.' });
    }
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const secret = newTokenSecret();
    const { name, expiresInDays, scope } = parsed.data;
    // O status traz enderecos, versoes e latencias: o mesmo que a tela de Status do admin.
    if (scope === 'STATUS' && user.role !== 'ADMIN') {
      return reply
        .code(403)
        .send({ error: 'Só administradores criam token de monitoramento (status).' });
    }
    // O feed leva os indicadores de todas as amostras, inclusive as de quem so ve as proprias.
    if (scope === 'FEED' && user.role !== 'ADMIN') {
      return reply
        .code(403)
        .send({ error: 'Só administradores criam token do feed de indicadores (TAXII/MISP).' });
    }
    // Trava por usuario e conta DENTRO da transacao (como a cota de envio), senao
    // pedidos paralelos passam todos no count e furam o teto (item: corrida de tokens).
    const token = await prisma
      .$transaction(async (tx) => {
        await advisoryLock(tx, tokenLockKey(user.id));
        const active = await tx.apiToken.count({ where: { userId: user.id, ...activeWhere() } });
        if (active >= TOKEN_MAX_ACTIVE) throw new TokenLimit();
        const created = await tx.apiToken.create({
          data: {
            userId: user.id,
            name,
            prefix: secret.slice(0, 12),
            tokenHash: hashToken(secret),
            scope,
            expiresAt: new Date(Date.now() + expiresInDays * 86400000),
          },
          select: tokenSelect,
        });
        await audit(tx, req, {
          action: 'API_TOKEN_CREATED',
          actorId: user.id,
          targetUserId: user.id,
          targetLabel: `${name} (${created.prefix}…)`,
          detail:
            `validade de ${expiresInDays} dia(s)` +
            (scope === 'STATUS'
              ? '; escopo: somente leitura do status'
              : scope === 'FEED'
                ? '; escopo: feed de indicadores (TAXII/MISP)'
                : ''),
        });
        return created;
      })
      .catch((err: unknown) => {
        if (err instanceof TokenLimit) return err;
        throw err;
      });
    if (token instanceof TokenLimit) {
      return reply.code(409).send({
        error: `Limite de ${TOKEN_MAX_ACTIVE} tokens ativos. Revogue um antes de gerar outro.`,
      });
    }
    return reply.code(201).send({ token, secret });
  });

  app.delete('/api/me/api-tokens/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const token = await prisma.apiToken.findFirst({ where: { id, userId: user.id } });
    if (!token) return reply.code(404).send({ error: 'Token não encontrado.' });
    if (!token.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
        await audit(tx, req, {
          action: 'API_TOKEN_REVOKED',
          actorId: user.id,
          targetUserId: user.id,
          targetLabel: `${token.name} (${token.prefix}…)`,
        });
      });
    }
    return reply.send({ ok: true });
  });

  // Administracao: todos os tokens (ativos por padrao) e revogacao de um token.
  app.get('/api/admin/api-tokens', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const parsed = AdminQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const tokens = await prisma.apiToken.findMany({
      where: parsed.data.status === 'active' ? activeWhere() : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        ...tokenSelect,
        user: { select: { id: true, displayName: true, email: true, apiAccess: true } },
      },
    });
    return reply.send({ tokens });
  });

  app.delete('/api/admin/api-tokens/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const token = await prisma.apiToken.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    if (!token) return reply.code(404).send({ error: 'Token não encontrado.' });
    if (!token.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
        await audit(tx, req, {
          action: 'API_TOKEN_REVOKED',
          actorId: admin.id,
          targetUserId: token.userId,
          targetLabel: `${token.name} (${token.prefix}…)`,
          detail: `de ${token.user.email}`,
        });
      });
    }
    return reply.send({ ok: true });
  });
}
