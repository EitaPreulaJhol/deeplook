import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAnalyst, requireAdmin, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const TemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  summary: z.string().trim().min(3).max(4000),
  findings: z.string().max(20000).optional(),
  iocs: z.string().max(20000).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).default('UNKNOWN'),
});

const templateSelect = {
  id: true,
  name: true,
  summary: true,
  findings: true,
  iocs: true,
  verdict: true,
  updatedAt: true,
} satisfies Prisma.ReportTemplateSelect;

const duplicateName = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Modelos de relatorio: analistas usam no "Novo relatorio" (preenche Resumo,
 * Achados, IOCs e veredito sugerido); so o admin cria, edita e exclui.
 */
export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/report-templates', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas usam modelos de relatorio.' });
    }
    const templates = await prisma.reportTemplate.findMany({
      orderBy: { name: 'asc' },
      select: templateSelect,
    });
    return reply.send({ templates });
  });

  app.post('/api/report-templates', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = TemplateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { findings, iocs, ...rest } = parsed.data;
    try {
      const template = await prisma.$transaction(async (tx) => {
        const created = await tx.reportTemplate.create({
          data: { ...rest, findings: findings || null, iocs: iocs || null, createdById: user.id },
          select: templateSelect,
        });
        await audit(tx, req, {
          action: 'TEMPLATE_CREATED',
          actorId: user.id,
          targetLabel: created.name,
        });
        return created;
      });
      return reply.code(201).send({ template });
    } catch (err) {
      if (duplicateName(err)) {
        return reply.code(409).send({
          error: 'Ja existe um modelo com este nome.',
          details: { name: ['nome em uso'] },
        });
      }
      throw err;
    }
  });

  app.patch('/api/report-templates/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = TemplateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const { findings, iocs, ...rest } = parsed.data;
    try {
      const template = await prisma.$transaction(async (tx) => {
        const updated = await tx.reportTemplate.update({
          where: { id },
          data: { ...rest, findings: findings || null, iocs: iocs || null },
          select: templateSelect,
        });
        await audit(tx, req, {
          action: 'TEMPLATE_UPDATED',
          actorId: user.id,
          targetLabel: updated.name,
        });
        return updated;
      });
      return reply.send({ template });
    } catch (err) {
      if (duplicateName(err)) {
        return reply.code(409).send({
          error: 'Ja existe um modelo com este nome.',
          details: { name: ['nome em uso'] },
        });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ error: 'Modelo nao encontrado.' });
      }
      throw err;
    }
  });

  app.delete('/api/report-templates/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.reportTemplate.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Modelo nao encontrado.' });
    await prisma.$transaction(async (tx) => {
      await tx.reportTemplate.delete({ where: { id } });
      await audit(tx, req, {
        action: 'TEMPLATE_DELETED',
        actorId: user.id,
        targetLabel: existing.name,
      });
    });
    return reply.send({ ok: true });
  });
}
