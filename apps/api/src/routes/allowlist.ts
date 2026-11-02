import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import {
  ALLOW_KINDS,
  allowedBy,
  invalidateAllowlist,
  loadAllowlist,
  normalizeAllowed,
} from '../lib/allowlist';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const CreateSchema = z.object({
  kind: z.enum(ALLOW_KINDS),
  value: z.string().trim().min(1).max(2048),
  reason: z.string().trim().min(3).max(300),
});
const FilterSchema = z.object({ values: z.array(z.string().max(2000)).max(500) });

/** Tipo de um indicador digitado/sugerido ("https://...", IP, e-mail, hash ou dominio). */
function guessKind(value: string): string {
  const v = value.trim().toLowerCase();
  if (/^https?:\/\//.test(v)) return 'URL';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'IPV4';
  if (/^\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?$/.test(v)) return 'IPV6';
  if (v.includes('@')) return 'EMAIL';
  if (/^[a-f0-9]{64}$/.test(v)) return 'SHA256';
  if (/^[a-f0-9]{40}$/.test(v)) return 'SHA1';
  if (/^[a-f0-9]{32}$/.test(v)) return 'MD5';
  return 'DOMAIN';
}

/**
 * Lista de permissoes de indicadores (item 69). Analistas incluem e removem;
 * cada mudanca vai para a auditoria.
 */
export async function allowlistRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas mantêm a lista de permissões.' });
      return null;
    }
    return user;
  };

  app.get('/api/allowlist', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const items = await prisma.allowedIndicator.findMany({
      orderBy: [{ kind: 'asc' }, { value: 'asc' }],
      select: {
        id: true,
        kind: true,
        value: true,
        reason: true,
        createdAt: true,
        createdBy: { select: { id: true, displayName: true } },
      },
    });
    return reply.send({ items });
  });

  app.post('/api/allowlist', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { kind, reason } = parsed.data;
    const value = normalizeAllowed(kind, parsed.data.value);
    if (!value) {
      const hint =
        kind === 'IPV4'
          ? 'use um IP ou uma faixa, ex.: 10.0.0.0/8'
          : kind === 'IPV6'
            ? 'use um IPv6 ou uma faixa, ex.: 2001:db8::/32'
            : kind === 'URL'
              ? 'use um link http:// ou https://'
              : 'valor inválido para o tipo';
      return reply.code(400).send({ error: 'Dados inválidos.', details: { value: [hint] } });
    }
    try {
      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.allowedIndicator.create({
          data: { kind, value, reason, createdById: user.id },
        });
        await audit(tx, req, {
          action: 'ALLOWLIST_ADDED',
          actorId: user.id,
          targetLabel: `${kind} ${value}`,
          detail: reason,
        });
        return created;
      });
      invalidateAllowlist();
      return reply.code(201).send({ item });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({
          error: 'Este indicador já está na lista de permissões.',
          details: { value: ['já está na lista'] },
        });
      }
      throw err;
    }
  });

  app.delete('/api/allowlist/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const item = await prisma.allowedIndicator.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: 'Indicador não encontrado na lista.' });
    await prisma.$transaction(async (tx) => {
      await tx.allowedIndicator.delete({ where: { id } });
      await audit(tx, req, {
        action: 'ALLOWLIST_REMOVED',
        actorId: user.id,
        targetLabel: `${item.kind} ${item.value}`,
      });
    });
    invalidateAllowlist();
    return reply.send({ ok: true });
  });

  // Quais destes indicadores (sugestoes do relatorio) estao na lista.
  app.post('/api/allowlist/filter', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = FilterSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const list = await loadAllowlist();
    const allowed = parsed.data.values.filter((v) => allowedBy(list, guessKind(v), v));
    return reply.send({ allowed });
  });
}
