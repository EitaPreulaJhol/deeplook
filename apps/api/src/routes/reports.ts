import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { isAnalyst, requireUser } from '../lib/auth';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { syncReportIocs } from '../lib/iocs';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const ReportSchema = z.object({
  summary: z.string().min(3).max(4000),
  findings: z.string().max(20000).optional(),
  iocs: z.string().max(20000).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).default('UNKNOWN'),
  published: z.boolean().default(false),
});

export async function reportRoutes(app: FastifyInstance) {
  // Lista de relatorios de uma amostra (qualquer usuario autenticado)
  app.get('/api/entries/:id/reports', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const reports = await prisma.report.findMany({
      where: { entryId: id },
      orderBy: { createdAt: 'desc' },
      include: { analyst: { select: { id: true, displayName: true, role: true } } },
    });
    return reply.send({ reports });
  });

  // Cria relatorio (somente analista/admin)
  app.post('/api/entries/:id/reports', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas podem criar relatorios.' });
    }

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });

    const parsed = ReportSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { summary, findings, iocs, verdict, published } = parsed.data;

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          entryId: id,
          analystId: user.id,
          summary,
          findings: findings || null,
          iocs: iocs || null,
          verdict,
          published,
        },
        include: { analyst: { select: { id: true, displayName: true, role: true } } },
      });
      await recordEvent(tx, {
        entryId: id,
        actorId: user.id,
        type: published ? 'REPORT_PUBLISHED' : 'REPORT_CREATED',
        toValue: verdict,
      });
      if (published) {
        await tx.entry.update({ where: { id }, data: { verdict, status: 'COMPLETED' } });
        await recordTriageChanges(tx, id, user.id, entry, { verdict, status: 'COMPLETED' });
      }
      // IOCs do relatorio publicado entram na aba Relacionadas.
      await syncReportIocs(tx, created.id);
      return created;
    });

    return reply.code(201).send({ report });
  });

  // Edita relatorio (autor ou admin)
  app.patch('/api/reports/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas podem editar relatorios.' });
    }

    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    if (report.analystId !== user.id && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Acesso negado.' });
    }

    const parsed = ReportSchema.partial().safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.report.update({
        where: { id },
        data: {
          summary: data.summary,
          findings: data.findings,
          iocs: data.iocs,
          verdict: data.verdict,
          published: data.published,
        },
        include: { analyst: { select: { id: true, displayName: true, role: true } } },
      });
      // Publicar um rascunho define status/veredito da amostra (e entra no historico).
      if (data.published === true && !report.published) {
        const before = await tx.entry.findUniqueOrThrow({ where: { id: report.entryId } });
        await tx.entry.update({
          where: { id: report.entryId },
          data: { verdict: r.verdict, status: 'COMPLETED' },
        });
        await recordEvent(tx, {
          entryId: report.entryId,
          actorId: user.id,
          type: 'REPORT_PUBLISHED',
          toValue: r.verdict,
        });
        await recordTriageChanges(tx, report.entryId, user.id, before, {
          verdict: r.verdict,
          status: 'COMPLETED',
        });
      } else if (data.published === true) {
        await tx.entry.update({
          where: { id: report.entryId },
          data: { verdict: r.verdict, status: 'COMPLETED' },
        });
      }
      await syncReportIocs(tx, r.id);
      return r;
    });

    return reply.send({ report: updated });
  });

  // Remove relatorio (autor ou admin)
  app.delete('/api/reports/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas podem remover relatorios.' });
    }

    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    if (report.analystId !== user.id && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Acesso negado.' });
    }

    await prisma.report.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}
