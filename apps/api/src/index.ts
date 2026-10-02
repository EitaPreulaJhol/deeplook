import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { env } from './env';
import { prisma } from './lib/prisma';
import { ensureBucket } from './lib/s3';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { entryRoutes } from './routes/entries';
import { reportRoutes } from './routes/reports';

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'deeplook-api',
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(entryRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Rota nao encontrada.' });
  });

  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, 'Erro na requisicao');
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message ?? 'Erro na requisicao.' });
    }
    return reply.code(500).send({ error: 'Erro interno do servidor.' });
  });

  // Garante o bucket do MinIO (com tentativas, pois pode demorar a subir).
  try {
    await ensureBucket();
  } catch (err) {
    app.log.error({ err }, 'Falha ao garantir bucket do MinIO');
  }

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`DeepLook API ouvindo em http://0.0.0.0:${env.PORT}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
