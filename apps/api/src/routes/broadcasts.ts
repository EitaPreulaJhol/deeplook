import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { advisoryLock, prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';
import { caseCode } from './cases';

/** Avisos ativos ao mesmo tempo (no maximo). */
export const BROADCAST_MAX_ACTIVE = 3;
const BROADCAST_LOCK = 880_001;

const CreateSchema = z
  .object({
    text: z.string().trim().min(5).max(300),
    level: z.enum(['INFO', 'WARNING']).default('INFO'),
    /** Validade em horas (1 hora a 30 dias). */
    hours: z.coerce.number().int().min(1).max(720),
    caseId: z.string().min(1).max(40).nullable().default(null),
  })
  .strict();

const select = {
  id: true,
  text: true,
  level: true,
  startsAt: true,
  expiresAt: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
  case: { select: { id: true, number: true, title: true } },
} as const;

type Row = {
  case: { id: string; number: number; title: string } | null;
} & Record<string, unknown>;
const withCode = <T extends Row>(b: T) => ({
  ...b,
  case: b.case ? { ...b.case, code: caseCode(b.case.number) } : null,
});

/**
 * Mensagens do sistema (item 88): avisos gerais dos analistas para todos
 * ("Campanha do boleto vencido em andamento"), com nivel, validade e caso
 * opcional. Aparecem numa faixa no topo ate vencer ou a pessoa dispensar.
 */
export async function broadcastRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas publicam avisos.' });
      return null;
    }
    return user;
  };

  // Ativos e ainda nao dispensados pela pessoa (faixa do topo e Pagina Inicial).
  app.get('/api/broadcasts/active', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const now = new Date();
    const items = await prisma.broadcast.findMany({
      where: {
        startsAt: { lte: now },
        expiresAt: { gt: now },
        dismissals: { none: { userId: user.id } },
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      select,
    });
    // Casos sao so dos analistas: usuario comum recebe o aviso sem o caso (item 100).
    const analyst = isAnalyst(user);
    return reply.send({
      items: items.map(withCode).map((b) => (analyst ? b : { ...b, case: null })),
    });
  });

  app.post('/api/broadcasts/:id/dismiss', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!(await prisma.broadcast.count({ where: { id } }))) {
      return reply.code(404).send({ error: 'Aviso não encontrado.' });
    }
    await prisma.broadcastDismissal.upsert({
      where: { broadcastId_userId: { broadcastId: id, userId: user.id } },
      create: { broadcastId: id, userId: user.id },
      update: {},
    });
    return reply.send({ ok: true });
  });

  // Gestao: ativos e os encerrados nos ultimos 30 dias.
  app.get('/api/broadcasts', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const items = await prisma.broadcast.findMany({
      where: { expiresAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      select: { ...select, _count: { select: { dismissals: true } } },
    });
    const now = Date.now();
    return reply.send({
      items: items.map((b) => ({ ...withCode(b), active: b.expiresAt.getTime() > now })),
    });
  });

  app.post('/api/broadcasts', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { text, level, hours, caseId } = parsed.data;
    if (caseId && !(await prisma.case.count({ where: { id: caseId } }))) {
      return reply
        .code(400)
        .send({ error: 'Dados invalidos.', details: { caseId: ['caso não encontrado'] } });
    }
    const now = new Date();
    const item = await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, BROADCAST_LOCK);
      if (
        (await tx.broadcast.count({ where: { expiresAt: { gt: now } } })) >= BROADCAST_MAX_ACTIVE
      ) {
        return null;
      }
      return tx.broadcast.create({
        data: {
          text,
          level,
          caseId,
          startsAt: now,
          expiresAt: new Date(now.getTime() + hours * 3600 * 1000),
          createdById: user.id,
        },
        select,
      });
    });
    if (!item) {
      return reply.code(409).send({
        error: `Já há ${BROADCAST_MAX_ACTIVE} avisos ativos. Encerre um antes de publicar outro.`,
      });
    }
    await audit(prisma, req, {
      action: 'BROADCAST_PUBLISHED',
      actorId: user.id,
      targetLabel: text,
      detail: `${level} · ${hours} h`,
    });
    return reply.code(201).send({ item: withCode(item) });
  });

  // Encerrar agora (o historico fica).
  app.post('/api/broadcasts/:id/end', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const now = new Date();
    const { count } = await prisma.broadcast.updateMany({
      where: { id, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    if (!count) return reply.code(404).send({ error: 'Aviso não encontrado ou já encerrado.' });
    const ended = await prisma.broadcast.findUnique({ where: { id }, select: { text: true } });
    await audit(prisma, req, {
      action: 'BROADCAST_ENDED',
      actorId: user.id,
      targetLabel: ended?.text ?? id,
    });
    return reply.send({ ok: true });
  });
}
