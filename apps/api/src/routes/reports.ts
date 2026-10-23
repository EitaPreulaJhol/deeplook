import type { Prisma, ReportStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { syncReportIocs } from '../lib/iocs';
import { excerpt, notify } from '../lib/notifications';
import type { Tx } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const ReportSchema = z.object({
  summary: z.string().min(3).max(4000),
  findings: z.string().max(20000).optional(),
  iocs: z.string().max(20000).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).default('UNKNOWN'),
  /** Ao salvar: rascunho, enviar para revisao ou publicar direto. */
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED']).default('DRAFT'),
});
const ReturnSchema = z.object({ note: z.string().trim().min(3).max(2000) });

/** Revisao obrigatoria (quatro olhos): ninguem publica direto. */
export const reviewRequired = () => env.REPORT_REVIEW_REQUIRED === 'true';

const reportInclude = {
  analyst: { select: { id: true, displayName: true, role: true } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.ReportInclude;

/**
 * Publica o relatorio (direto ou na aprovacao da revisao): conclui a amostra com
 * o veredito do relatorio, registra no historico e indexa os IOCs.
 */
async function publish(tx: Tx, reportId: string, actorId: string) {
  const report = await tx.report.update({
    where: { id: reportId },
    data: { status: 'PUBLISHED' },
  });
  const before = await tx.entry.findUniqueOrThrow({ where: { id: report.entryId } });
  await tx.entry.update({
    where: { id: report.entryId },
    data: { verdict: report.verdict, status: 'COMPLETED' },
  });
  await recordEvent(tx, {
    entryId: report.entryId,
    actorId,
    type: 'REPORT_PUBLISHED',
    toValue: report.verdict,
  });
  await recordTriageChanges(tx, report.entryId, actorId, before, {
    verdict: report.verdict,
    status: 'COMPLETED',
  });
  await syncReportIocs(tx, reportId, { actorId });
}

/** Envia para revisao: some do rascunho, entra na fila "Relatorios para revisar". */
async function submit(tx: Tx, reportId: string, actorId: string) {
  const report = await tx.report.update({
    where: { id: reportId },
    data: { status: 'IN_REVIEW', submittedAt: new Date(), reviewNote: null },
  });
  await recordEvent(tx, {
    entryId: report.entryId,
    actorId,
    type: 'REPORT_SUBMITTED',
    toValue: report.verdict,
  });
}

/**
 * Relatorios de analise. Fluxo: Rascunho -> (Em revisao ->) Publicado. Com
 * REPORT_REVIEW_REQUIRED=true, publicar so pela aprovacao de OUTRO analista
 * (quatro olhos); sem ela, a revisao e opcional. Usuarios comuns so veem os
 * publicados.
 */
export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/reports', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const reports = await prisma.report.findMany({
      where: { entryId: id, ...(isAnalyst(user) ? {} : { status: 'PUBLISHED' as const }) },
      orderBy: { createdAt: 'desc' },
      include: reportInclude,
    });
    return reply.send({ reports, reviewRequired: reviewRequired() });
  });

  // Fila "Relatorios para revisar": em revisao, de OUTROS analistas.
  app.get('/api/reports/review-queue', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });
    const reports = await prisma.report.findMany({
      where: { status: 'IN_REVIEW', analystId: { not: user.id }, entry: { deletedAt: null } },
      orderBy: { submittedAt: 'asc' },
      include: {
        ...reportInclude,
        entry: { select: { id: true, title: true, type: true } },
      },
    });
    return reply.send({ reports });
  });

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
    const { summary, findings, iocs, verdict, status } = parsed.data;
    if (status === 'PUBLISHED' && reviewRequired()) {
      return reply
        .code(400)
        .send({ error: 'Este servidor exige revisão: envie o relatório para revisão.' });
    }

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          entryId: id,
          analystId: user.id,
          summary,
          findings: findings || null,
          iocs: iocs || null,
          verdict,
        },
      });
      await recordEvent(tx, {
        entryId: id,
        actorId: user.id,
        type: 'REPORT_CREATED',
        toValue: verdict,
      });
      if (status === 'IN_REVIEW') await submit(tx, created.id, user.id);
      if (status === 'PUBLISHED') await publish(tx, created.id, user.id);
      return tx.report.findUniqueOrThrow({ where: { id: created.id }, include: reportInclude });
    });

    return reply.code(201).send({ report });
  });

  // Edita (autor ou admin). Em revisao fica travado: o revisor aprova o que leu.
  // Com revisao obrigatoria, publicado tambem nao muda (seria publicar sem revisar).
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
    if (report.status === 'IN_REVIEW') {
      return reply.code(409).send({ error: 'Relatório em revisão não pode ser alterado.' });
    }

    const parsed = ReportSchema.partial().safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;
    if (reviewRequired() && (report.status === 'PUBLISHED' || data.status === 'PUBLISHED')) {
      return reply
        .code(400)
        .send({ error: 'Este servidor exige revisão: publique pela aprovação de outro analista.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: {
          summary: data.summary,
          findings: data.findings,
          iocs: data.iocs,
          verdict: data.verdict,
          // Despublicar (sem revisao obrigatoria) volta a rascunho.
          ...(data.status === 'DRAFT' ? { status: 'DRAFT' as ReportStatus } : {}),
        },
      });
      if (data.status === 'IN_REVIEW' && report.status === 'DRAFT') await submit(tx, id, user.id);
      if (data.status === 'PUBLISHED' && report.status !== 'PUBLISHED') {
        await publish(tx, id, user.id);
      } else if (report.status === 'PUBLISHED' && data.status !== 'DRAFT' && data.verdict) {
        // Publicado editado: o veredito da amostra acompanha.
        await tx.entry.update({ where: { id: report.entryId }, data: { verdict: data.verdict } });
      }
      await syncReportIocs(tx, id, { actorId: user.id });
      return tx.report.findUniqueOrThrow({ where: { id }, include: reportInclude });
    });

    return reply.send({ report: updated });
  });

  // Enviar rascunho para revisao (autor ou admin).
  app.post('/api/reports/:id/submit', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    if (!isAnalyst(user) || (report.analystId !== user.id && user.role !== 'ADMIN')) {
      return reply.code(403).send({ error: 'Acesso negado.' });
    }
    if (report.status !== 'DRAFT') {
      return reply.code(409).send({ error: 'Só rascunhos podem ser enviados para revisão.' });
    }
    await prisma.$transaction((tx) => submit(tx, id, user.id));
    return reply.send({
      report: await prisma.report.findUniqueOrThrow({ where: { id }, include: reportInclude }),
    });
  });

  // Aprovar (outro analista): publica e conclui a amostra.
  app.post('/api/reports/:id/approve', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });
    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    if (report.analystId === user.id) {
      return reply.code(403).send({ error: 'O autor não revisa o próprio relatório.' });
    }
    if (report.status !== 'IN_REVIEW') {
      return reply.code(409).send({ error: 'O relatório não está em revisão.' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: { reviewedById: user.id, reviewedAt: new Date(), reviewNote: null },
      });
      await recordEvent(tx, {
        entryId: report.entryId,
        actorId: user.id,
        type: 'REPORT_APPROVED',
        toValue: report.verdict,
      });
      await publish(tx, id, user.id);
      await notify(tx, [
        {
          userId: report.analystId,
          type: 'REPORT_APPROVED',
          entryId: report.entryId,
          actorId: user.id,
        },
      ]);
    });
    return reply.send({
      report: await prisma.report.findUniqueOrThrow({ where: { id }, include: reportInclude }),
    });
  });

  // Devolver (outro analista) com comentario: volta a rascunho para o autor ajustar.
  app.post('/api/reports/:id/return', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });
    const parsed = ReturnSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    if (report.analystId === user.id) {
      return reply.code(403).send({ error: 'O autor não revisa o próprio relatório.' });
    }
    if (report.status !== 'IN_REVIEW') {
      return reply.code(409).send({ error: 'O relatório não está em revisão.' });
    }
    const { note } = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: { status: 'DRAFT', reviewedById: user.id, reviewedAt: new Date(), reviewNote: note },
      });
      await recordEvent(tx, {
        entryId: report.entryId,
        actorId: user.id,
        type: 'REPORT_RETURNED',
        detail: note,
      });
      await notify(tx, [
        {
          userId: report.analystId,
          type: 'REPORT_RETURNED',
          entryId: report.entryId,
          actorId: user.id,
          detail: excerpt(note),
        },
      ]);
    });
    return reply.send({
      report: await prisma.report.findUniqueOrThrow({ where: { id }, include: reportInclude }),
    });
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
