import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import type { Prisma, ReportStatus, Verdict } from '../generated/prisma/client';
import { findTechnique, normalizeTechniques, TECHNIQUE_ID } from '../lib/attack';
import { isAnalyst, requireUser } from '../lib/auth';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { syncReportIocs } from '../lib/iocs';
import { scanLookalikesQuietly } from '../lib/lookalike';
import { excerpt, notify } from '../lib/notifications';
import type { Tx } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const VerdictSchema = z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']);
const StatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED']);

const ReportSchema = z.object({
  summary: z.string().min(3).max(4000),
  findings: z.string().max(20000).optional(),
  iocs: z.string().max(20000).optional(),
  verdict: VerdictSchema.default('UNKNOWN'),
  /** Tecnicas MITRE ATT&CK (lista embutida). */
  attackTechniques: z
    .array(z.string().trim().toUpperCase())
    .max(30, 'no máximo 30 técnicas')
    .superRefine((ids, ctx) => {
      const unknown = ids.filter((id) => !TECHNIQUE_ID.test(id) || !findTechnique(id));
      if (unknown.length) {
        ctx.addIssue({
          code: 'custom',
          message: `técnica desconhecida: ${unknown.slice(0, 3).join(', ')}`,
        });
      }
    })
    .transform(normalizeTechniques)
    .optional(),
  /** Artigos da base de conhecimento citados (item 63). */
  kbArticleIds: z
    .array(z.string().min(1).max(40))
    .max(10, 'no máximo 10 artigos')
    .transform((ids) => [...new Set(ids)])
    .optional(),
  /** Ao salvar: rascunho, enviar para revisao ou publicar direto. */
  status: StatusSchema.default('DRAFT'),
});
/**
 * Edicao: so o que veio. No zod 4 o `.partial()` mantem os `.default()`, e um
 * PATCH so com o resumo voltaria o veredito a "Desconhecido" e despublicaria.
 */
const ReportPatchSchema = ReportSchema.partial().extend({
  verdict: VerdictSchema.optional(),
  status: StatusSchema.optional(),
});
const ReturnSchema = z.object({ note: z.string().trim().min(3).max(2000) });

/** Revisao obrigatoria (quatro olhos): ninguem publica direto. */
export const reviewRequired = () => env.REPORT_REVIEW_REQUIRED === 'true';

const reportInclude = {
  analyst: { select: { id: true, displayName: true, role: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  kbArticles: { select: { id: true, title: true }, orderBy: { title: 'asc' } },
  _count: { select: { revisions: true } },
  // Imagens de evidencia (item 76), na ordem em que entraram.
  evidence: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      caption: true,
      mimeType: true,
      width: true,
      height: true,
      size: true,
      createdAt: true,
      uploadedBy: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.ReportInclude;

/** Artigos citados que nao existem (400 no campo "Artigos da base"). */
async function missingKbArticles(ids: string[] | undefined): Promise<boolean> {
  if (!ids?.length) return false;
  return (await prisma.kbArticle.count({ where: { id: { in: ids } } })) !== ids.length;
}

const kbNotFound = {
  error: 'Dados invalidos.',
  details: { kbArticleIds: ['artigo da base não encontrado'] },
};

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
    const { summary, findings, iocs, verdict, status, attackTechniques, kbArticleIds } =
      parsed.data;
    if (await missingKbArticles(kbArticleIds)) return reply.code(400).send(kbNotFound);
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
          attackTechniques: attackTechniques ?? [],
          kbArticles: { connect: (kbArticleIds ?? []).map((kbId) => ({ id: kbId })) },
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

    const parsed = ReportPatchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;
    if (await missingKbArticles(data.kbArticleIds)) return reply.code(400).send(kbNotFound);
    if (reviewRequired() && (report.status === 'PUBLISHED' || data.status === 'PUBLISHED')) {
      return reply
        .code(400)
        .send({ error: 'Este servidor exige revisão: publique pela aprovação de outro analista.' });
    }

    // Versoes (item 75): mudou o conteudo, a versao anterior fica guardada.
    const changed =
      (data.summary !== undefined && data.summary !== report.summary) ||
      (data.findings !== undefined && (data.findings || null) !== report.findings) ||
      (data.iocs !== undefined && (data.iocs || null) !== report.iocs) ||
      (data.verdict !== undefined && data.verdict !== report.verdict) ||
      (data.attackTechniques !== undefined &&
        data.attackTechniques.join() !== report.attackTechniques.join());

    const updated = await prisma.$transaction(async (tx) => {
      if (changed) {
        await tx.reportRevision.create({
          data: {
            reportId: id,
            editorId: user.id,
            summary: report.summary,
            findings: report.findings,
            iocs: report.iocs,
            verdict: report.verdict,
            attackTechniques: report.attackTechniques,
            status: report.status,
          },
        });
      }
      await tx.report.update({
        where: { id },
        data: {
          summary: data.summary,
          findings: data.findings === undefined ? undefined : data.findings || null,
          iocs: data.iocs === undefined ? undefined : data.iocs || null,
          verdict: data.verdict,
          attackTechniques: data.attackTechniques,
          ...(data.kbArticleIds && {
            kbArticles: { set: data.kbArticleIds.map((kbId) => ({ id: kbId })) },
          }),
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
  // Versoes do relatorio (item 75), da 1a (do autor) a atual. So analistas:
  // versoes antigas podem ter texto de rascunho.
  app.get('/api/reports/:id/versions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });
    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        analyst: { select: { id: true, displayName: true } },
        revisions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { editor: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!report) return reply.code(404).send({ error: 'Relatorio nao encontrado.' });
    const content = (r: {
      summary: string;
      findings: string | null;
      iocs: string | null;
      verdict: Verdict;
      attackTechniques: string[];
      status: ReportStatus;
    }) => ({
      summary: r.summary,
      findings: r.findings,
      iocs: r.iocs,
      verdict: r.verdict,
      attackTechniques: r.attackTechniques,
      status: r.status,
    });
    const revs = report.revisions;
    // Autor e data de cada versao: a 1a e do analista na criacao; as seguintes,
    // de quem fez a edicao anterior, quando ela aconteceu.
    const versions = [...revs.map(content), content(report)].map((v, i) => ({
      number: i + 1,
      current: i === revs.length,
      author: i === 0 ? report.analyst : revs[i - 1].editor,
      at: i === 0 ? report.createdAt : revs[i - 1].createdAt,
      ...v,
    }));
    return reply.send({ versions });
  });

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
    // Indicadores do relatorio saem dos dominios parecidos (item 92).
    await scanLookalikesQuietly(report.entryId);
    return reply.send({ ok: true });
  });
}
