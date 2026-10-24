import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { captureEnabled, runCapture } from '../lib/page-capture';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';

const captureSelect = {
  id: true,
  status: true,
  url: true,
  finalUrl: true,
  title: true,
  httpStatus: true,
  redirects: true,
  certificate: true,
  blocked: true,
  htmlTruncated: true,
  error: true,
  createdAt: true,
  finishedAt: true,
  requestedBy: { select: { id: true, displayName: true } },
} as const;

/**
 * Captura da pagina de um link (item 80), sob demanda: analistas pedem; todos
 * que veem a amostra veem as capturas. O print e servido como imagem; o HTML so
 * como download de texto (nunca e aberto no navegador).
 */
export async function captureRoutes(app: FastifyInstance) {
  app.post('/api/entries/:id/capture', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user))
      return reply.code(403).send({ error: 'Somente analistas capturam páginas.' });
    if (!captureEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A captura de páginas está desligada (CAPTURE_URL / CAPTURE_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { id: true, type: true, url: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (entry.type !== 'URL' || !entry.url) {
      return reply.code(400).send({ error: 'Só amostras do tipo link têm página para capturar.' });
    }
    const running = await prisma.pageCapture.count({ where: { entryId: id, status: 'PENDING' } });
    if (running) return reply.code(409).send({ error: 'Já há uma captura em andamento.' });
    const capture = await prisma.pageCapture.create({
      data: { entryId: id, requestedById: user.id, url: entry.url },
      select: captureSelect,
    });
    void runCapture(capture.id, req.log);
    return reply.code(202).send({ capture });
  });

  app.get('/api/entries/:id/captures', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: { id: true } });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const captures = await prisma.pageCapture.findMany({
      where: { entryId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: captureSelect,
    });
    return reply.send({ captures, enabled: captureEnabled() });
  });

  /** Captura concluida de uma amostra visivel; em erro ja responde. */
  const done = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    const { id } = req.params as { id: string };
    const capture = await prisma.pageCapture.findFirst({
      where: { id, status: 'DONE', entry: { deletedAt: null } },
      select: { id: true, screenshotKey: true, htmlKey: true },
    });
    if (!capture) reply.code(404).send({ error: 'Captura não encontrada.' });
    return capture;
  };

  app.get('/api/captures/:id/screenshot', async (req, reply) => {
    const capture = await done(req, reply);
    if (!capture?.screenshotKey)
      return capture ? reply.code(404).send({ error: 'Sem print.' }) : undefined;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: capture.screenshotKey }),
    );
    return reply
      .header('Content-Type', 'image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=3600')
      .send(obj.Body as Readable);
  });

  // HTML da pagina como TEXTO para baixar (pode ter script malicioso).
  app.get('/api/captures/:id/html', async (req, reply) => {
    const capture = await done(req, reply);
    if (!capture?.htmlKey)
      return capture ? reply.code(404).send({ error: 'Sem HTML.' }) : undefined;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: capture.htmlKey }),
    );
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="captura-${capture.id}.html.txt"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(obj.Body as Readable);
  });
}
