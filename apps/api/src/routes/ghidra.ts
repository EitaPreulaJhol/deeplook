import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { enqueueGhidra, ghidraEnabled, ghidraIneligible } from '../lib/ghidra';
import { prisma } from '../lib/prisma';
import { isMissingObject, MISSING_OBJECT_MESSAGE, s3 } from '../lib/s3';

const analysisSelect = {
  status: true,
  summary: true,
  gzfKey: true,
  gzfSize: true,
  gzfError: true,
  error: true,
  version: true,
  ms: true,
  attempts: true,
  nextAttemptAt: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: { select: { id: true, displayName: true } },
} as const;

const entrySelect = {
  type: true,
  fileSize: true,
  filePurgedAt: true,
  staticInfo: true,
  ownerId: true,
  title: true,
  originalFilename: true,
} as const;

/**
 * Analise com o Ghidra (item 7.3), sob demanda: analistas pedem; quem ve a amostra ve o resumo e o
 * pseudo-C (o requireUser ja barra a amostra de outro dono). O projeto .gzf tem os bytes da
 * amostra: baixa-lo segue a regra de baixar a amostra (quem enviou e os analistas) e fica na
 * Auditoria.
 */
export async function ghidraRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/ghidra', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const analysis = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: analysisSelect,
    });
    const ahead =
      analysis?.status === 'PENDING'
        ? await prisma.ghidraAnalysis.count({
            where: {
              status: { in: ['PENDING', 'RUNNING'] },
              createdAt: { lt: analysis.createdAt },
            },
          })
        : null;
    const reason = ghidraIneligible(entry);
    // Motivos no idioma de quem pede (plano pos-revisao, item 1.4).
    const lang = requestLang(req);
    const { gzfKey, ...rest } = analysis ?? { gzfKey: null };
    const kind = (entry.staticInfo as { detectedType?: { id?: string } | null } | null)
      ?.detectedType?.id;
    return reply.send({
      enabled: ghidraEnabled(),
      // Executavel (a secao aparece); eligible diz se da para pedir agora (.NET, teto, expurgo).
      applicable: entry.type === 'FILE' && (kind === 'pe' || kind === 'elf'),
      eligible: reason === null,
      reason: localizeText(reason, lang),
      maxMb: env.GHIDRA_MAX_MB,
      // Baixar o projeto: quem enviou e os analistas (como a amostra).
      canDownload: entry.ownerId === user.id || isAnalyst(user),
      analysis: analysis
        ? {
            ...rest,
            error: localizeText(analysis.error, lang),
            gzfError: localizeText(analysis.gzfError, lang),
            hasProject: Boolean(gzfKey),
            ahead,
          }
        : null,
    });
  });

  app.post('/api/entries/:id/ghidra', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem a análise com o Ghidra.' });
    }
    if (!ghidraEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A análise com o Ghidra está desligada (GHIDRA_URL / GHIDRA_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const reason = ghidraIneligible(entry);
    if (reason) return reply.code(400).send({ error: reason });
    const current = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A análise com o Ghidra já está na fila.' });
    }
    await enqueueGhidra(id, user.id);
    return reply.code(202).send({ ok: true });
  });

  app.get('/api/entries/:id/ghidra/project', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    // So quem enviou e os analistas (como "Baixar amostra", item 122): o .gzf tem os bytes dela.
    if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
      return reply
        .code(403)
        .send({ error: 'Somente quem enviou e os analistas baixam o projeto do Ghidra.' });
    }
    if (entry?.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    const analysis = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: { gzfKey: true },
    });
    if (!entry || !analysis?.gzfKey) {
      return reply.code(404).send({ error: 'Projeto do Ghidra não encontrado.' });
    }
    const obj = await s3
      .send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: analysis.gzfKey }))
      .catch((err: unknown) => {
        if (isMissingObject(err)) return null;
        throw err;
      });
    if (!obj) return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: user.id,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: 'projeto do Ghidra (.gzf)',
    });
    const safeName = (entry.originalFilename || 'amostra').replace(/[^\w.-]+/g, '_');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `attachment; filename="${safeName}.gzf"`);
    if (obj.ContentLength) reply.header('Content-Length', String(obj.ContentLength));
    return reply.send(obj.Body as Readable);
  });
}
