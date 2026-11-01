import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import type { PublicUser } from '../lib/auth';
import { isAnalyst, requireUser, visibleEntries } from '../lib/auth';
import { cleanEvidenceImage, EvidenceImageError } from '../lib/evidence-image';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';
import { sendValidationError } from '../lib/validation';
import { reviewRequired } from './reports';

/** Tamanho maximo de uma imagem de evidencia. */
export const EVIDENCE_MAX_MB = 10;
/** Imagens por relatorio. */
export const EVIDENCE_PER_REPORT = 20;

const CaptionSchema = z.object({ caption: z.string().trim().max(300) });

export const evidenceSelect = {
  id: true,
  caption: true,
  mimeType: true,
  width: true,
  height: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: { id: true, displayName: true } },
} as const;

/** Apaga as imagens de evidencia no MinIO (idempotente: objeto ausente nao e erro). */
export async function deleteEvidenceObjects(keys: string[]): Promise<void> {
  for (const Key of keys) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key }));
  }
}

/**
 * Evidencias do relatorio (item 76): imagens PNG/JPEG/WebP validadas pelo tipo
 * real e sem metadados, guardadas no MinIO. Quem edita o relatorio (autor ou
 * admin, fora de revisao) inclui, legenda e apaga; quem le o relatorio ve.
 */
export async function evidenceRoutes(app: FastifyInstance) {
  /** Relatorio que o usuario pode alterar; em erro ja responde e devolve null. */
  const editableReport = async (reply: FastifyReply, user: PublicUser, reportId: string) => {
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas alteram relatórios.' });
      return null;
    }
    const report = await prisma.report.findFirst({
      where: { id: reportId, entry: { deletedAt: null } },
      select: { id: true, analystId: true, status: true, _count: { select: { evidence: true } } },
    });
    if (!report) {
      reply.code(404).send({ error: 'Relatório não encontrado.' });
      return null;
    }
    if (report.analystId !== user.id && user.role !== 'ADMIN') {
      reply.code(403).send({ error: 'Acesso negado.' });
      return null;
    }
    if (report.status === 'IN_REVIEW') {
      reply.code(409).send({ error: 'Relatório em revisão não pode ser alterado.' });
      return null;
    }
    if (reviewRequired() && report.status === 'PUBLISHED') {
      reply
        .code(400)
        .send({ error: 'Este servidor exige revisão: relatório publicado não muda sem revisar.' });
      return null;
    }
    return report;
  };

  const evidenceOf = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const found = await prisma.reportEvidence.findFirst({
      where: { id, report: { entry: { deletedAt: null } } },
      include: {
        report: { select: { id: true, status: true, entry: { select: { ownerId: true } } } },
      },
    });
    if (!found) reply.code(404).send({ error: 'Evidência não encontrada.' });
    return found;
  };

  app.post('/api/reports/:id/evidence', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const report = await editableReport(reply, user, (req.params as { id: string }).id);
    if (!report) return;
    if (report._count.evidence >= EVIDENCE_PER_REPORT) {
      return reply
        .code(400)
        .send({ error: `O relatório já tem ${EVIDENCE_PER_REPORT} imagens (o máximo).` });
    }

    let buffer: Buffer | null = null;
    let caption = '';
    try {
      for await (const part of req.parts({ limits: { fileSize: EVIDENCE_MAX_MB * 1024 * 1024 } })) {
        if (part.type === 'file') buffer = await part.toBuffer();
        else if (part.fieldname === 'caption') caption = String(part.value);
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply
          .code(413)
          .send({ error: `Imagem maior que o limite de ${EVIDENCE_MAX_MB} MB.` });
      }
      req.log.error(err);
      return reply.code(400).send({ error: 'Falha ao processar o upload.' });
    }
    if (!buffer) return reply.code(400).send({ error: 'Nenhuma imagem enviada.' });
    const parsedCaption = CaptionSchema.safeParse({ caption });
    if (!parsedCaption.success) return sendValidationError(reply, parsedCaption.error);

    let image;
    try {
      image = cleanEvidenceImage(buffer);
    } catch (err) {
      if (err instanceof EvidenceImageError) {
        return reply.code(400).send({ error: err.message, details: { file: [err.message] } });
      }
      throw err;
    }

    const storageKey = `evidence/${report.id}/${randomUUID()}.${image.ext}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: image.data,
        ContentType: image.type,
      }),
    );
    const evidence = await prisma.reportEvidence.create({
      data: {
        reportId: report.id,
        uploadedById: user.id,
        storageKey,
        mimeType: image.type,
        width: image.width,
        height: image.height,
        size: image.data.length,
        caption: parsedCaption.data.caption || null,
      },
      select: evidenceSelect,
    });
    return reply.code(201).send({ evidence, metadataRemoved: image.removed });
  });

  app.patch('/api/evidence/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = CaptionSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const evidence = await evidenceOf(req, reply);
    if (!evidence) return;
    if (!(await editableReport(reply, user, evidence.reportId))) return;
    const updated = await prisma.reportEvidence.update({
      where: { id: evidence.id },
      data: { caption: parsed.data.caption || null },
      select: evidenceSelect,
    });
    return reply.send({ evidence: updated });
  });

  app.delete('/api/evidence/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const evidence = await evidenceOf(req, reply);
    if (!evidence) return;
    if (!(await editableReport(reply, user, evidence.reportId))) return;
    // Objeto primeiro: se o MinIO falhar, a evidencia continua para tentar de novo.
    try {
      await deleteEvidenceObjects([evidence.storageKey]);
    } catch (err) {
      req.log.error({ err }, 'Falha ao apagar a evidência no MinIO');
      return reply
        .code(502)
        .send({ error: 'Não foi possível apagar a imagem no armazenamento. Tente de novo.' });
    }
    await prisma.reportEvidence.delete({ where: { id: evidence.id } });
    return reply.send({ ok: true });
  });

  // A imagem (autenticada). Usuario comum so ve evidencia de relatorio publicado.
  app.get('/api/evidence/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const evidence = await evidenceOf(req, reply);
    if (!evidence) return;
    const { ownerId } = await visibleEntries(user);
    if (
      (!isAnalyst(user) && evidence.report.status !== 'PUBLISHED') ||
      (ownerId && evidence.report.entry.ownerId !== ownerId)
    ) {
      return reply.code(404).send({ error: 'Evidência não encontrada.' });
    }
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: evidence.storageKey }),
    );
    const ext = evidence.storageKey.split('.').pop();
    return reply
      .header('Content-Type', evidence.mimeType)
      .header('Content-Length', String(evidence.size))
      .header('Content-Disposition', `inline; filename="evidencia-${evidence.id}.${ext}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
      .header('Cache-Control', 'private, max-age=3600')
      .send(obj.Body as Readable);
  });
}
